#!/usr/bin/env python3
"""Portable synthetic checks for the non-executing package inspector."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('verify_package', Path(__file__).with_name('verify-ci-package.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class PackageInspectorTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)

    def binary(self, content):
        path = self.root / 'binary'
        path.write_bytes(content)
        return path

    def test_elf_target_and_rejection(self):
        data = bytearray(64)
        data[:6] = b'\x7fELF\x02\x01'
        struct.pack_into('<H', data, 18, 62)
        verify.architecture(self.binary(data), 'x86_64-unknown-linux-gnu')
        struct.pack_into('<H', data, 18, 183)
        with self.assertRaises(ValueError):
            verify.architecture(self.binary(data), 'x86_64-unknown-linux-gnu')

    def test_pe_target_and_rejection(self):
        data = bytearray(70)
        data[:2] = b'MZ'
        struct.pack_into('<I', data, 60, 64)
        data[64:] = b'PE\x00\x00\x64\x86'
        verify.architecture(self.binary(data), 'x86_64-pc-windows-msvc')
        data[68:] = b'\x4c\x01'
        with self.assertRaises(ValueError):
            verify.architecture(self.binary(data), 'x86_64-pc-windows-msvc')

    def test_macho_targets_and_rejection(self):
        for cpu, target in [(0x0100000C, 'aarch64-apple-darwin'), (0x01000007, 'x86_64-apple-darwin')]:
            data = bytearray(64)
            data[:4] = b'\xcf\xfa\xed\xfe'
            struct.pack_into('<I', data, 4, cpu)
            verify.architecture(self.binary(data), target)
        with self.assertRaises(ValueError):
            verify.architecture(self.binary(data), 'aarch64-apple-darwin')

    def test_missing_or_duplicate_payload_rejected(self):
        for paths in [[], [Path('first'), Path('second')]]:
            with self.assertRaises(ValueError):
                verify.only(paths)

    def test_sidecar_hash_mismatch_rejected_before_architecture_check(self):
        directory = self.root / 'payload'
        directory.mkdir()
        (directory / 'jmcl').write_bytes(b'host')
        (directory / 'jmcl-core').write_bytes(b'wrong core')
        staged = self.root / 'src-tauri/binaries'
        staged.mkdir(parents=True)
        (staged / 'jmcl-core-x86_64-unknown-linux-gnu').write_bytes(b'pinned core')
        with patch.object(verify, 'ROOT', self.root):
            with self.assertRaisesRegex(ValueError, 'differs from pinned'):
                verify.payload(directory, 'x86_64-unknown-linux-gnu')


if __name__ == '__main__':
    unittest.main()
