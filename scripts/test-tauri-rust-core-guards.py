#!/usr/bin/env python3
"""Pure/fake runner controls only: never launches Tauri, Core, Java or a browser."""
from unittest.mock import Mock, patch
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
        marker = 'TAURI_REMOTE_ORIGIN_REJECTED pool_empty=true\nTAURI_CHANNEL_EGRESS_OK tests=1 cached=1 dispatch=actual runtime=mock js=false\n'
        summary = 'test result: ok. 1 passed; 0 failed; 0 ignored; 3 filtered out; finished in 0.1s\n'
        runner.verify_result(marker + summary)
        for value in [summary, marker + summary + summary, marker + marker + summary, marker + summary.replace('1 passed', '0 passed'), marker + summary.replace('0 failed', '1 failed')]:
            with self.assertRaises(RuntimeError):
                runner.verify_result(value)

    def test_runtime_wrapping_and_gate_order(self):
        # Inspect syntax only: this must not call main, prctl, or any executable.
        import ast
        tree = ast.parse(Path(runner.__file__).read_text())
        main = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'main')
        calls = [node for node in ast.walk(main) if isinstance(node, ast.Call)
                 and isinstance(node.func, ast.Name) and node.func.id == 'bounded']
        runtime_calls = []
        for call in calls:
            first = call.args[0]
            strings = [node.value for node in ast.walk(first)
                       if isinstance(node, ast.Constant) and isinstance(node.value, str)]
            if '--list' in strings or '--test-threads=1' in strings:
                self.assertIsInstance(first, ast.Call)
                self.assertIsInstance(first.func, ast.Name)
                self.assertEqual(first.func.id, 'guard_command')
                self.assertEqual(first.args[0].value, '--exec')
                runtime_calls.append(call)
        self.assertEqual(len(runtime_calls), 2)
        stage_updates = {}
        for node in ast.walk(main):
            if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == 'update':
                values = {kw.arg: kw.value.value for kw in node.keywords if isinstance(kw.value, ast.Constant)}
                if 'stage' in values:
                    self.assertEqual(values.get('status'), 'failed')
                    stage_updates[values['stage']] = node.lineno
        for stage, argument in [('spawn-build', 'rustc'), ('compile', 'cargo')]:
            call = next(call for call in calls if isinstance(call.args[0], ast.List)
                        and isinstance(call.args[0].elts[0], ast.Constant)
                        and call.args[0].elts[0].value == argument
                        and any(isinstance(item, ast.Constant) and item.value in ('--edition=2021', 'test') for item in call.args[0].elts))
            self.assertLess(stage_updates[stage], call.lineno)
        self.assertLess(stage_updates['guarded-inventory'], min(call.lineno for call in runtime_calls))

        loop = next(node for node in main.body[-1].body if isinstance(node, ast.For)
                    and isinstance(node.target, ast.Tuple) and len(node.target.elts) == 4)
        labels = [item.elts[0].value for item in loop.iter.elts]
        self.assertEqual(labels, ['guard-selftest', 'spawn-missing', 'spawn-success'])
        self.assertLess(loop.lineno, min(call.lineno for call in runtime_calls))
        gate_call = next(node for node in ast.walk(loop) if isinstance(node, ast.Call)
                         and isinstance(node.func, ast.Name) and node.func.id == 'bounded')
        self.assertEqual(gate_call.args[0].func.id, 'guard_command')
        assignments = [node for node in ast.walk(main) if isinstance(node, ast.Assign)
                       and isinstance(node.value, ast.Constant) and node.value.value == 'failed']
        self.assertTrue(any(node.lineno < loop.lineno for node in assignments))

    def test_wrong_hash(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'binary'
            path.write_bytes(b'fixture')
            with self.assertRaises(RuntimeError):
                runner.verify_hash(path, '0' * 64)

    def test_failed_fixture_is_retained(self):
        import json
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            owned = out / 'owned'
            owned.mkdir()
            (out / 'raw.log').write_bytes(b'raw\xff')
            runner.finalize({'status': 'failed'}, out, owned)
            self.assertTrue(owned.exists())
            report = json.loads((out / 'report.json').read_text())
            self.assertEqual(report['raw_logs']['raw.log']['bytes'], 4)

    def test_fixture_hash_and_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / 'fixture'
            hashes = runner.prepare_fixture(root)
            runner.verify_fixture(root, hashes)
            with self.assertRaises(RuntimeError):
                runner.verify_fixture(root, hashes, installed=True)
            dest = root / 'instances/owned/mods/owned-fixture.txt'
            dest.parent.mkdir(parents=True)
            dest.write_bytes(runner.PAYLOAD)
            runner.verify_fixture(root, hashes, installed=True)
            (root / 'manifest.json').write_bytes(b'changed')
            with self.assertRaises(RuntimeError):
                runner.verify_fixture(root, hashes)

    def test_fixed_guard_and_exact_gate(self):
        command = runner.guard_command('--selftest')
        self.assertTrue(Path(command[0]).is_absolute())
        self.assertEqual(command[1:3], ['-I', '-S'])
        runner.verify_hash(runner.SPAWN, runner.SPAWN_SHA)
        runner.verify_gate('ok\n', b'', 'ok\n')
        for stdout, stderr in [('ok\nok\n', b''), ('ok\n', b'warning'), ('', b'')]:
            with self.assertRaises(RuntimeError):
                runner.verify_gate(stdout, stderr, 'ok\n')

    def test_mock_timeout_cleanup(self):
        import subprocess
        import json
        with tempfile.TemporaryDirectory() as tmp:
            process = Mock(pid=1234, returncode=-9)
            process.wait.side_effect = [subprocess.TimeoutExpired('fake', 1), -9]
            stdout = b'out\r\n\x00\xff'
            stderr = b'err\r\n\x00\xff'
            def fake_popen(*args, **kwargs):
                kwargs['stdout'].write(stdout)
                kwargs['stderr'].write(stderr)
                return process
            with patch.object(runner.subprocess, 'Popen', side_effect=fake_popen) as popen, \
                 patch.object(runner, 'group_members', side_effect=[[1234], [], []]), \
                 patch.object(runner.os, 'killpg') as kill, \
                 patch.object(runner.os, 'waitpid', side_effect=ChildProcessError):
                with self.assertRaisesRegex(RuntimeError, 'timeout=True'):
                    runner.bounded(['fake'], Path(tmp) / 'timeout.log', {}, 1)
                kill.assert_called_once_with(1234, runner.signal.SIGKILL)
                self.assertTrue(popen.call_args.kwargs['close_fds'])
                self.assertEqual(popen.call_args.kwargs['stdin'], subprocess.DEVNULL)
            evidence = json.loads((Path(tmp) / 'timeout.phase.json').read_text())
            for name, raw in [('timeout.log', stdout), ('timeout.stderr.log', stderr)]:
                path = Path(tmp) / name
                self.assertEqual(path.read_bytes(), raw)
                self.assertEqual(evidence['logs'][name]['sha256'], runner.sha(path))
                self.assertEqual(evidence['logs'][name]['bytes'], len(raw))
            self.assertEqual(evidence['signal'], 9)
            self.assertEqual(evidence['group_after_cleanup'], [])

    def test_mock_cleanup_errors_keep_unknown_group_and_raw_logs(self):
        import json
        for failure in ('kill', 'wait', 'waitpid'):
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as tmp:
                process = Mock(pid=1234, returncode=0)
                process.wait.side_effect = [0, OSError('wait failed')] if failure == 'wait' else [0, 0]
                def fake_popen(*args, **kwargs):
                    kwargs['stdout'].write(b'out\r\n\x00\xff')
                    kwargs['stderr'].write(b'err\r\n\x00\xff')
                    return process
                with patch.object(runner.subprocess, 'Popen', side_effect=fake_popen), \
                     patch.object(runner, 'group_members', return_value=[1234]), \
                     patch.object(runner.os, 'killpg', side_effect=OSError('kill failed') if failure == 'kill' else None), \
                     patch.object(runner.os, 'waitpid', side_effect=OSError('waitpid failed')):
                    with self.assertRaisesRegex(OSError, failure + ' failed'):
                        runner.bounded(['fake'], Path(tmp) / 'failed.log', {}, 1)
                evidence = json.loads((Path(tmp) / 'failed.phase.json').read_text())
                self.assertIsNone(evidence['group_after_cleanup'])
                self.assertEqual(evidence['status'], 'failed')
                self.assertIn(failure + ' failed', evidence['cleanup_error'])
                for name, raw in [('failed.log', b'out\r\n\x00\xff'), ('failed.stderr.log', b'err\r\n\x00\xff')]:
                    path = Path(tmp) / name
                    self.assertEqual(path.read_bytes(), raw)
                    self.assertEqual(evidence['logs'][name]['sha256'], runner.sha(path))

    def test_posthash_error_still_finalizes_and_retains_fixture(self):
        import json
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            owned = out / 'owned'
            owned.mkdir()
            binary = owned / 'binary'
            binary.write_bytes(b'fake')
            (out / 'raw.log').write_bytes(b'raw\xff')
            report = {'status': 'passed'}
            with patch.object(runner, 'sha', side_effect=OSError('post hash failed')):
                with self.assertRaisesRegex(OSError, 'post hash failed'):
                    runner.finish_evidence(report, out, owned, {'binary': binary})
            self.assertTrue(owned.exists())
            saved = json.loads((out / 'report.json').read_text())
            self.assertEqual(saved['status'], 'failed')
            self.assertEqual(saved['post_hash_error'], 'post hash failed')

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



if __name__ == '__main__':
    unittest.main()
