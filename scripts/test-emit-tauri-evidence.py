#!/usr/bin/env python3
import base64
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('emitter', Path(__file__).with_name('emit-tauri-evidence.py'))
emitter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(emitter)


class Evidence(unittest.TestCase):
    def test_roundtrip_priorities_and_empty(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            data = b'raw\xff\r\n' * 10000
            (root / 'build.log').write_bytes(data)
            (root / 'report.json').write_bytes(b'{}')
            (root / 'empty.log').write_bytes(b'')
            records = list(emitter.records(root))
            self.assertEqual(records[0]['file'], 'report.json')
            metadata = [r for r in records if r['file'] == 'build.log' and r['type'] == 'file'][0]
            chunks = [r for r in records if r['file'] == 'build.log' and r['type'] == 'chunk']
            self.assertEqual([r['index'] for r in chunks], list(range(metadata['chunks'])))
            raw = b''.join(base64.b64decode(r['base64'], validate=True) for r in chunks)
            self.assertEqual(raw, data)
            self.assertEqual(len(raw), metadata['bytes'])
            self.assertEqual(hashlib.sha256(raw).hexdigest(), metadata['sha256'])
            self.assertTrue(all(r['bytes'] <= emitter.CHUNK for r in chunks))
            for record in chunks:
                part = base64.b64decode(record['base64'], validate=True)
                self.assertEqual(len(part), record['bytes'])
                self.assertEqual(hashlib.sha256(part).hexdigest(), record['sha256'])
            self.assertEqual([r for r in records if r['file'] == 'empty.log'][0]['chunks'], 0)

    def test_symlink_is_not_followed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'link').symlink_to('/etc/passwd')
            with self.assertRaises(ValueError):
                list(emitter.records(root))

    def test_root_symlink_is_not_followed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'real').mkdir()
            (root / 'real' / 'data').write_bytes(b'data')
            (root / 'link').symlink_to(root / 'real', target_is_directory=True)
            with self.assertRaises(ValueError):
                list(emitter.records(root / 'link'))

    def test_oversized_fails(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'data').write_bytes(b'oversize')
            with patch.object(emitter, 'MAX_FILE', 1):
                with self.assertRaises(ValueError):
                    list(emitter.records(root))

    def test_missing_group_is_reported_and_available_group_emitted(self):
        from contextlib import redirect_stdout
        from unittest.mock import patch
        import io
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'report.json').write_bytes(b'{}')
            captured = io.StringIO()
            with patch.object(emitter.sys, 'argv', ['emit', str(root / 'missing'), str(root)]), redirect_stdout(captured):
                with self.assertRaises(SystemExit):
                    emitter.main()
            self.assertIn('missing_or_invalid_group', captured.getvalue())
            self.assertIn('report.json', captured.getvalue())


if __name__ == '__main__':
    unittest.main()
