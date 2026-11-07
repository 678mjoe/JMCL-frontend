#!/usr/bin/env python3
"""Pure/fake runner controls only: never launches Tauri, Core, Java or a browser."""
import ctypes
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('runner', Path(__file__).with_name('test-tauri-rust-core.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class Guards(unittest.TestCase):
    def test_inventory(self):
        runner.verify_inventory(runner.TEST + ': test\n\n1 test, 0 benchmarks\n')
        for value in ['0 tests, 0 benchmarks\n', runner.TEST + ': test\nother: test\n1 test, 0 benchmarks\n', (runner.TEST + ': test\n') * 2 + '1 test, 0 benchmarks\n']:
            with self.assertRaises(RuntimeError):
                runner.verify_inventory(value)

    def test_result(self):
        marker = 'TAURI_REMOTE_ORIGIN_REJECTED pool_empty=true\nTAURI_RUST_CORE_CONTRACT_OK sessions=2 dispatch=actual runtime=mock ui=false\n'
        summary = 'test result: ok. 1 passed; 0 failed; 0 ignored; 3 filtered out; finished in 0.1s\n'
        runner.verify_result(marker + summary)
        for value in [summary, marker + marker + summary, marker + summary.replace('1 passed', '0 passed'), marker + summary.replace('0 failed', '1 failed')]:
            with self.assertRaises(RuntimeError):
                runner.verify_result(value)

    def test_wrong_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'binary'
            path.write_bytes(b'fixture')
            with self.assertRaises(RuntimeError):
                runner.verify_hash(path, '0' * 64)

    def test_cleanup_error_still_writes_report(self):
        from unittest.mock import Mock
        import json
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'raw.log').write_bytes(b'raw\xff')
            owned = Mock()
            owned.cleanup.side_effect = OSError('synthetic cleanup failure')
            with self.assertRaises(OSError):
                runner.finalize({'status': 'passed'}, out, owned)
            report = json.loads((out / 'report.json').read_text())
            self.assertEqual(report['status'], 'failed')
            self.assertEqual(report['raw_logs']['raw.log']['bytes'], 4)

    @unittest.skipUnless(sys.platform == 'linux', 'Linux cleanup contract')
    def test_successful_parent_with_leftover_fails_and_reaps(self):
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl.argtypes = [ctypes.c_int] + [ctypes.c_ulong] * 4
        self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)
        with tempfile.TemporaryDirectory() as tmp:
            code = "import os,time; child=os.fork(); os._exit(0) if child else time.sleep(30)"
            with self.assertRaisesRegex(RuntimeError, 'leftover='):
                runner.bounded([sys.executable, '-c', code], Path(tmp) / 'leftover.log', os.environ.copy(), 3)

    def test_fake_elf(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'fake'
            path.write_bytes(b'not an ELF')
            with self.assertRaises(RuntimeError):
                runner.verify_elf(path)

    def test_source_diff_rejected(self):
        # Mock only Git reads; no real subprocess or production fixture execution.
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'src-tauri').mkdir()
            (root / 'src-tauri/build.rs').write_bytes(b'changed')
            with patch.object(runner.subprocess, 'check_output', side_effect=[b'src-tauri/build.rs\n', b'original']):
                with self.assertRaises(RuntimeError):
                    runner.verify_sources(root)

    @unittest.skipUnless(sys.platform == 'linux', 'Linux cleanup contract')
    def test_timeout_keeps_raw_bytes_and_reaps_owned_child(self):
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl.argtypes = [ctypes.c_int] + [ctypes.c_ulong] * 4
        self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / 'timeout.log'
            code = "import os,time; os.write(1,b'raw\\xff\\r\\n'); child=os.fork(); time.sleep(30)"
            with self.assertRaisesRegex(RuntimeError, 'timeout=True'):
                runner.bounded([sys.executable, '-c', code], log, os.environ.copy(), .5)
            self.assertEqual(log.read_bytes(), b'raw\xff\r\n')

    @unittest.skipUnless(sys.platform == 'linux', 'Linux cleanup contract')
    def test_nonzero_and_strict_decode(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / 'failure.log'
            with self.assertRaisesRegex(RuntimeError, 'exit=3'):
                runner.bounded([sys.executable, '-c', 'raise SystemExit(3)'], log, os.environ.copy(), 3)
            with self.assertRaises(UnicodeDecodeError):
                runner.bounded([sys.executable, '-c', "import os; os.write(1,b'\\xff')"], log, os.environ.copy(), 3)
            self.assertEqual(log.read_bytes(), b'\xff')


if __name__ == '__main__':
    unittest.main()
