#!/usr/bin/env python3
"""Package the freshly built ARM64 app; inspect its restored bundle, never launch it."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = 'JMCL Rust GUI Test'
HOST = 'jmcl-rust-gui-test'
CORE = 'jmcl-core'
TARGET = 'aarch64-apple-darwin'
BASE = '83e3fa749c56af79d1760b9e85c277d84286ca19'
CORE_PIN = '0b937fb1e68067a76b4324f22fb7af9a2d9cbd18'
CORE_TREE = '78e666ffc7b42c3311a1ff8ddf3af5afed7e3880'
CODESIGN = '/usr/bin/codesign'


def require(ok, message):
    if not ok:
        raise SystemExit(message)


def run(*args):
    return subprocess.check_output([str(x) for x in args], cwd=ROOT, timeout=120)


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def mach_o(path):
    mode = path.lstat().st_mode
    require(stat.S_ISREG(mode) and (mode & stat.S_IXUSR), f'Not an ordinary executable: {path.name}')
    with path.open('rb') as f:
        header = f.read(16)
    require(len(header) == 16 and header[:4] == b'\xcf\xfa\xed\xfe',
            f'Not thin 64-bit little-endian Mach-O: {path.name}')
    cpu, _, kind = struct.unpack('<III', header[4:])
    require(cpu == 0x0100000C and kind == 2, f'Not native ARM64 MH_EXECUTE: {path.name}')


def payload(app):
    info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
    require(info.get('CFBundleIdentifier') == 'page.mjoe.jmcl.experimental-rust-preview'
            and info.get('CFBundleExecutable') == HOST
            and info.get('CFBundleShortVersionString') == '0.1.0'
            and info.get('CFBundlePackageType') == 'APPL'
            and info.get('LSMinimumSystemVersion') == '14.0', 'Unexpected app plist identity')
    host = app / 'Contents/MacOS' / HOST
    core = app / 'Contents/MacOS' / CORE
    require(len(list(app.rglob(CORE))) == 1, 'Ambiguous packaged Core')
    mach_o(host)
    mach_o(core)
    return host, core


def verify_signature(app):
    run(CODESIGN, '--verify', '--deep', '--strict', '--verbose=2', app)
    p = subprocess.run([CODESIGN, '--display', '--verbose=4', str(app)],
                       capture_output=True, text=True, timeout=60, check=True)
    require('Signature=adhoc' in p.stderr.splitlines(), 'Expected a local ad hoc signature only')


def inventory(app):
    result = {}
    for p in app.rglob('*'):
        mode = p.lstat().st_mode
        rel = p.relative_to(app).as_posix()
        if stat.S_ISLNK(mode):
            result[rel] = ('link', os.readlink(p))
        elif stat.S_ISREG(mode):
            result[rel] = ('file', mode & 0o111, digest(p))
        else:
            require(stat.S_ISDIR(mode), f'Unexpected special file: {rel}')
            result[rel] = ('directory',)
    require(0 < len(result) <= 512, 'Unexpected bundle size or empty bundle')
    return result


def main():
    require(sys.platform == 'darwin' and run('uname', '-m').decode().strip() == 'arm64',
            'Use only a native Apple Silicon build runner')
    core_repo = ROOT / '.ci-core'
    base = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text(encoding='utf-8'))
    config = json.loads((ROOT / 'src-tauri/tauri.rust-gui-test.conf.json').read_text(encoding='utf-8'))
    require(base['version'] == '0.1.0' and 'version' not in config, 'Unexpected frontend version')
    require(config['identifier'] == 'page.mjoe.jmcl.experimental-rust-preview'
            and config['productName'] == PRODUCT and config['mainBinaryName'] == HOST,
            'Unexpected test app identity')
    require(config['app']['windows'][0]['create'] is False
            and 'dataStoreIdentifier' not in config['app']['windows'][0], 'Unexpected window config')
    require(config['bundle']['createUpdaterArtifacts'] is False
            and config['plugins']['updater']['pubkey'] == '', 'Unexpected updater settings')
    require(run('git', 'rev-parse', 'HEAD^').decode().strip() == BASE, 'Unexpected frontend parent')
    require(run('git', '-C', core_repo, 'rev-parse', 'HEAD').decode().strip() == CORE_PIN, 'Wrong Core base')
    require(run('git', '-C', core_repo, 'write-tree').decode().strip() == CORE_TREE, 'Wrong versioned Core tree')
    source_binary = core_repo / 'rust/target/release/jmcl-core-rust'
    staged = ROOT / f'src-tauri/binaries/jmcl-core-{TARGET}'
    apps = list((ROOT / 'src-tauri/target/release/bundle/macos').glob('*.app'))
    require(len(apps) == 1 and apps[0].name == PRODUCT + '.app', 'Unexpected .app bundle')
    app = apps[0]
    host, core = payload(app)
    hashes = {'compiled': digest(source_binary), 'staged': digest(staged), 'before_ad_hoc': digest(core)}
    require(len(set(hashes.values())) == 1, 'Core bytes differ before app seal')
    host_before = digest(host)

    # Only seal the outer bundle, with no identity/private key or deep signing.
    # Never re-sign/modify its nested Core; if the outer seal touches it, stop.
    run(CODESIGN, '--force', '--sign', '-', '--timestamp=none', app)
    hashes['after_ad_hoc'] = digest(core)
    require(len(set(hashes.values())) == 1, 'Outer ad hoc signing mutated the bundled Core')
    verify_signature(app)
    host_after = digest(host)
    expected = inventory(app)

    deliver = ROOT / 'deliver'
    deliver.mkdir()  # fresh; cannot upload stale output
    package = deliver / 'jmcl-rust-gui-test_0.1.0_aarch64-apple-darwin.app.tar.gz'
    with tarfile.open(package, 'w:gz', compresslevel=6) as archive:
        archive.add(app, arcname=app.name)
    package_sha = digest(package)

    with tempfile.TemporaryDirectory(prefix='jmcl-mac-app-check-') as directory:
        unpacked = Path(directory)
        with tarfile.open(package, 'r:gz') as archive:
            members = archive.getmembers()
            require(len(members) == len(expected) + 1, 'Archive member count differs')
            names = {m.name for m in members}
            require(len(names) == len(members), 'Duplicate archive member')
            require(names == {app.name, *(app.name + '/' + rel for rel in expected)},
                    'Archive entry set differs from built app')
            for member in members:
                path = PurePosixPath(member.name)
                require(not path.is_absolute() and '..' not in path.parts
                        and path.parts[0] == app.name
                        and (member.isdir() or member.isfile() or member.issym()),
                        'Unexpected archive path or type')
            archive.extractall(unpacked, filter='data')
        restored = unpacked / app.name
        require(list(unpacked.iterdir()) == [restored], 'Unexpected archive root')
        require(inventory(restored) == expected, 'Restored bundle files, links or execute bits differ')
        restored_host, restored_core = payload(restored)
        require(digest(restored_host) == host_after, 'Archived host content changed')
        hashes['restored_from_archive'] = digest(restored_core)
        require(len(set(hashes.values())) == 1, 'Archived Core content changed')
        verify_signature(restored)
    require(digest(package) == package_sha, 'Archive digest changed during inspection')

    source = deliver / 'JMCLCore-0.1.0-rust-dev-corresponding-source.tar.gz'
    run('git', '-C', core_repo, 'archive', '--format=tar.gz', '--prefix=JMCLCore/',
        f'--output={source}', CORE_TREE)
    shutil.copy2(core_repo / 'LICENSE', deliver / 'JMCLCore-LICENSE.txt')
    shutil.copy2(ROOT / 'ci/rust-dev-version.patch', deliver / 'JMCLCore-version.patch')
    shutil.copy2(ROOT / 'LICENSE', deliver / 'JMCL-LICENSE.txt')
    shutil.copy2(ROOT / 'node_modules/@fontsource-variable/inter/LICENSE', deliver / 'Inter-LICENSE.txt')
    for name in ('jmcl-feature-andesite.png', 'jmcl-feature-andesite.LICENSE.txt'):
        require((ROOT / 'public' / name).read_bytes() == (ROOT / 'dist' / name).read_bytes(),
                f'Bundled asset changed or missing: {name}')
    shutil.copy2(ROOT / 'public/jmcl-feature-andesite.LICENSE.txt', deliver)
    notes = """JMCL Rust GUI Test for Apple Silicon (macOS 14+); app version 0.1.0.
Experimental Rust Core source version: 0.1.0-rust-dev; wire protocol 1.
The .app archive preserves the original bundle contents, executable modes and
relative symlinks. The app has an ad hoc signature, not Developer ID signing
or Apple notarization. Static build and package checks only; nothing launched.
Native GUI and WebView isolation, existing Java, and actual game launch require
separate acceptance. Managed Java and large modpacks were not tested. Do not
override macOS or browser security warnings.
"""
    (deliver / 'TEST-SCOPE.txt').write_text(notes, encoding='utf-8')
    manifest = {
        'variant': 'experimental-rust-gui', 'target': TARGET, 'app_version': '0.1.0',
        'core_source_version': '0.1.0-rust-dev', 'frontend_base': BASE,
        'frontend_revision': run('git', 'rev-parse', 'HEAD').decode().strip(),
        'frontend_tree': run('git', 'rev-parse', 'HEAD^{tree}').decode().strip(),
        'core_base': CORE_PIN, 'core_tree': CORE_TREE,
        'core_lock_sha256': digest(core_repo / 'rust/Cargo.lock'),
        'core_version_patch_sha256': digest(ROOT / 'ci/rust-dev-version.patch'),
        'core_payload_sha256': hashes, 'core_source_archive_sha256': digest(source),
        'package': package.name, 'package_sha256': package_sha,
        'host_before_adhoc_sha256': host_before, 'host_after_adhoc_sha256': host_after,
        'bundle_archive_entries': len(expected) + 1,
        'signature': 'ad-hoc only; strict verification passed before and after archive',
        'developer_id_signed': False, 'apple_notarized': False,
        'rustc': run('rustc', '-vV').decode().strip(),
        'github_run': os.environ['GITHUB_RUN_ID'], 'runner_image': os.getenv('ImageVersion', 'see job setup log'),
        'not_tested': ['native GUI/WebView', 'bundled runtime handshake', 'Java', 'game',
                       'accounts/providers', 'Gatekeeper or browser download acceptance'],
    }
    (deliver / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    sums = ''.join(f'{digest(p)}  {p.name}\n' for p in sorted(deliver.iterdir()))
    (deliver / 'SHA256SUMS.txt').write_text(sums, encoding='utf-8')
    require(len(list(deliver.iterdir())) == 10, 'Unexpected delivery file count')
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
