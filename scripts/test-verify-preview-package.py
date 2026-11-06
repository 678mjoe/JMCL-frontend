#!/usr/bin/env python3
"""Synthetic preview-inspector checks. Never execute a packaged binary."""
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import struct
import subprocess
import sys
import tarfile
import unittest
from unittest.mock import patch


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


baseline = load('baseline_tests', 'test-verify-ci-package.py')
verify = load('verify_preview', 'verify-preview-package.py')


class PreviewInspectorTests(baseline.PackageInspectorTests):
    def setUp(self):
        super().setUp()
        # Reuse all architecture/hash rejection cases against the preview module.
        for obj, name, value in [(baseline, 'verify', verify),
                                 (verify, 'ROOT', self.root),
                                 (verify, 'PAYLOAD', {}),
                                 (verify, 'SMOKE_CORE', False)]:
            replacement = patch.object(obj, name, value)
            replacement.start()
            self.addCleanup(replacement.stop)
        # A forgotten mock must fail rather than execute any fixture or command.
        for name in ['run', 'check_output']:
            guard = patch.object(subprocess, name, side_effect=AssertionError('No real subprocess allowed'))
            guard.start()
            self.addCleanup(guard.stop)

    def mac_payload(self, directory):
        directory.mkdir(parents=True)
        header = bytearray(64)
        header[:4] = b'\xcf\xfa\xed\xfe'
        struct.pack_into('<I', header, 4, 0x0100000C)
        for name in ['jmcl', 'jmcl-core']:
            path = directory / name
            path.write_bytes(header)
            path.chmod(0o755)
        staged = self.root / 'src-tauri/binaries/jmcl-core-aarch64-apple-darwin'
        staged.parent.mkdir(parents=True, exist_ok=True)
        staged.write_bytes(header)
        return directory / 'jmcl-core'

    def test_no_smoke_means_no_process(self):
        core = self.mac_payload(self.root / 'payload')
        verify.payload(core.parent, 'aarch64-apple-darwin')
        self.assertEqual(verify.PAYLOAD['core_sha256'], verify.digest(core))
        self.assertNotIn('core_version_smoke', verify.PAYLOAD)

    def test_smoke_invokes_only_packaged_core_version_in_temporary_directory(self):
        core = self.mac_payload(self.root / 'payload')
        reply = {'protocol': 1, 'id': 'package-smoke', 'event': 'result', 'result': {'name': 'jmcl-core'}}
        with patch.object(verify, 'SMOKE_CORE', True), patch.object(subprocess, 'run',
                return_value=subprocess.CompletedProcess([], 0, json.dumps(reply) + '\n', '')) as command:
            verify.payload(core.parent, 'aarch64-apple-darwin')
        command.assert_called_once()
        args, kwargs = command.call_args
        self.assertEqual(args, ([str(core.resolve()), 'rpc'],))
        self.assertEqual(json.loads(kwargs['input']),
                         {'protocol': 1, 'id': 'package-smoke', 'method': 'core.version', 'params': {}})
        self.assertEqual(kwargs['timeout'], 15)
        self.assertTrue(kwargs['check'])
        self.assertTrue(kwargs['capture_output'])
        self.assertFalse(Path(kwargs['cwd']).exists())
        self.assertEqual(verify.PAYLOAD['core_version_smoke'], 'passed')

    def test_smoke_rejects_invalid_version_reply(self):
        core = self.mac_payload(self.root / 'payload')
        reply = {'protocol': 1, 'id': 'package-smoke', 'event': 'result', 'result': {'name': 'not-core'}}
        with patch.object(verify, 'SMOKE_CORE', True), patch.object(subprocess, 'run',
                return_value=subprocess.CompletedProcess([], 0, json.dumps(reply), '')):
            with self.assertRaisesRegex(ValueError, 'Core version RPC failed'):
                verify.payload(core.parent, 'aarch64-apple-darwin')
        self.assertNotIn('core_version_smoke', verify.PAYLOAD)

    def test_hash_mismatch_prevents_smoke(self):
        with patch.object(verify, 'SMOKE_CORE', True):
            self.test_sidecar_hash_mismatch_rejected_before_architecture_check()

    @unittest.skipIf(os.name == 'nt', 'POSIX executable modes are checked on macOS runners')
    def test_app_archive_retains_executable_modes_and_exact_payload(self):
        bundle = self.root / 'bundle'
        app = bundle / 'macos/jmcl.app'
        core = self.mac_payload(app / 'Contents/MacOS')
        with (app / 'Contents/Info.plist').open('wb') as output:
            plistlib.dump({'CFBundleIdentifier': verify.CONFIG['identifier'],
                          'CFBundleShortVersionString': verify.CONFIG['version'],
                          'CFBundleExecutable': verify.CONFIG['productName']}, output)
        output = self.root / 'output'
        output.mkdir()
        with patch.object(verify, 'BUNDLE', bundle):
            package = verify.inspect_app(output, 'aarch64-apple-darwin')
        with tarfile.open(package, 'r:gz') as archive:
            for name in ['jmcl', 'jmcl-core']:
                self.assertEqual(archive.getmember(f'jmcl.app/Contents/MacOS/{name}').mode & 0o777, 0o755)
        self.assertEqual(verify.PAYLOAD['core_sha256'], verify.digest(core))

    def test_manifest_records_revisions_hashes_and_acceptance_limits(self):
        package = self.root / 'synthetic.app.tar.gz'
        package.write_bytes(b'synthetic package, never an executable')
        output = self.root / 'output'
        revisions = [b'frontend-fixture\n', b'core-fixture\n']
        provenance = {'core_sha256': 'core-hash-fixture', 'desktop_sha256': 'desktop-hash-fixture',
                      'core_version_smoke': 'passed'}
        argv = ['verify-preview-package.py', '--target', 'aarch64-apple-darwin', '--profile', 'release',
                '--macos-format', 'app', '--smoke-core', '--output-dir', str(output)]
        with patch.object(sys, 'argv', argv), patch.object(verify, 'inspect_app', return_value=package), \
                patch.object(verify, 'run', side_effect=revisions) as command, \
                patch.object(verify, 'PAYLOAD', provenance):
            verify.main()
        self.assertEqual([call.args for call in command.call_args_list],
                         [('git', '-C', self.root, 'rev-parse', 'HEAD'),
                          ('git', '-C', self.root / '.ci-core', 'rev-parse', 'HEAD')])
        manifest = json.loads((output / 'manifest.json').read_text())
        self.assertEqual(manifest, {
            'frontend_revision': 'frontend-fixture', 'core_revision': 'core-fixture',
            'target': 'aarch64-apple-darwin', 'profile': 'release',
            'package': package.name, 'package_sha256': verify.digest(package),
            'signed': False, 'notarized': False, **provenance,
            'not_tested': ['native GUI', 'real login', 'Minecraft launch', 'installer execution'],
        })
        self.assertEqual((output / package.name).read_bytes(), package.read_bytes())
        self.assertEqual((output / 'SHA256SUMS.txt').read_text(), f'{verify.digest(package)}  {package.name}\n')


if __name__ == '__main__':
    unittest.main()
