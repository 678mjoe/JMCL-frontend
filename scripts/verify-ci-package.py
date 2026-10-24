#!/usr/bin/env python3
"""Inspect bundles; optionally smoke-test only the bundled Core with core.version."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import struct
import subprocess
import tempfile
import tarfile

ROOT = Path(__file__).resolve().parents[1]
CONFIG = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text())
# Match Cargo's optional target-dir override; CI uses the default workspace path.
TARGET_DIR = Path(os.environ.get('CARGO_TARGET_DIR', ROOT / 'src-tauri/target'))
BUNDLE = TARGET_DIR / 'debug/bundle'
SMOKE_CORE = False
PAYLOAD = {}


def run(*args):
    return subprocess.check_output([str(arg) for arg in args])


def require(condition, message):
    if not condition:
        raise ValueError(message)


def only(paths):
    paths = list(paths)
    require(len(paths) == 1, f'Expected exactly one match, got {paths}')
    return paths[0]


def digest(path):
    with path.open('rb') as source:
        result = hashlib.sha256()
        for block in iter(lambda: source.read(1024 * 1024), b''):
            result.update(block)
        return result.hexdigest()


def architecture(path, target):
    with path.open('rb') as source:
        header = source.read(64)
        if target.endswith('linux-gnu'):
            require(header[:6] == b'\x7fELF\x02\x01', f'Not ELF64 little-endian: {path}')
            machine = struct.unpack_from('<H', header, 18)[0]
            require(machine == 62, f'Not x86_64 ELF: {path}')
        elif target.endswith('windows-msvc'):
            require(header[:2] == b'MZ', f'Not PE: {path}')
            source.seek(struct.unpack_from('<I', header, 60)[0])
            pe = source.read(6)
            require(pe == b'PE\x00\x00\x64\x86', f'Not AMD64 PE: {path}')
        else:
            require(header[:4] == b'\xcf\xfa\xed\xfe', f'Not thin 64-bit Mach-O: {path}')
            cpu = struct.unpack_from('<I', header, 4)[0]
            expected = 0x0100000C if target.startswith('aarch64-') else 0x01000007
            require(cpu == expected, f'Mach-O CPU mismatch: {path}')


def payload(directory, target):
    suffix = '.exe' if target.endswith('windows-msvc') else ''
    core = only(directory.rglob('jmcl-core' + suffix))
    host = only(directory.rglob('jmcl' + suffix))
    staged = ROOT / f'src-tauri/binaries/jmcl-core-{target}{suffix}'
    require(digest(core) == digest(staged), 'Packaged sidecar differs from pinned staged Core')
    architecture(core, target)
    architecture(host, target)
    PAYLOAD.update(core_sha256=digest(core), desktop_sha256=digest(host))
    if SMOKE_CORE:
        with tempfile.TemporaryDirectory(prefix='jmcl-core-smoke-') as working:
            request = {'protocol': 1, 'id': 'package-smoke', 'method': 'core.version', 'params': {}}
            result = subprocess.run([str(core.resolve()), 'rpc'], input=json.dumps(request) + '\n',
                text=True, capture_output=True, cwd=working, timeout=15, check=True)
            replies = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
            reply = only(reply for reply in replies if reply.get('id') == 'package-smoke')
            require(reply.get('protocol') == 1 and reply.get('event') == 'result' and isinstance(reply.get('result'), dict) and reply['result'].get('name') == 'jmcl-core', 'Core version RPC failed')
            PAYLOAD['core_version_smoke'] = 'passed'
    print(f'Payload target={target}; sidecar sha256={digest(core)}')


def inspect_deb(directory, target):
    package = only((BUNDLE / 'deb').glob('*.deb'))
    for field, expected in [('Package', CONFIG['productName']), ('Version', CONFIG['version']), ('Architecture', 'amd64')]:
        value = run('dpkg-deb', '-f', package, field).decode().strip()
        require(value == expected, f'Debian {field}: {value!r} != {expected!r}')
    run('dpkg-deb', '-x', package, directory)  # extraction only; no dpkg installation
    payload(directory, target)
    require((directory / 'usr/share/applications/jmcl.desktop').is_file(), 'Missing desktop entry')
    return package


def inspect_dmg(directory, target):
    package = only((BUNDLE / 'dmg').glob('*.dmg'))
    mount = directory / 'mounted'
    mount.mkdir()
    # Read-only inspection, not installation/opening; do not bypass Gatekeeper.
    run('hdiutil', 'attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', mount, package)
    try:
        app = only(mount.glob('*.app'))
        with (app / 'Contents/Info.plist').open('rb') as source:
            info = plistlib.load(source)
        for key, expected in [('CFBundleIdentifier', CONFIG['identifier']), ('CFBundleShortVersionString', CONFIG['version']), ('CFBundleExecutable', CONFIG['productName'])]:
            require(info.get(key) == expected, f'Unexpected {key}: {info.get(key)!r}')
        payload(app / 'Contents/MacOS', target)
    finally:
        run('hdiutil', 'detach', mount)
    return package


def inspect_app(directory, target):
    app = only((BUNDLE / 'macos').glob('*.app'))
    with (app / 'Contents/Info.plist').open('rb') as source:
        info = plistlib.load(source)
    for key, expected in [('CFBundleIdentifier', CONFIG['identifier']), ('CFBundleShortVersionString', CONFIG['version']), ('CFBundleExecutable', CONFIG['productName'])]:
        require(info.get(key) == expected, f'Unexpected {key}: {info.get(key)!r}')
    package = directory / f"jmcl_{CONFIG['version']}_{target}.app.tar.gz"
    with tarfile.open(package, 'w:gz') as archive:
        archive.add(app, arcname=app.name)
    # Archive retains bundle symlinks and executable modes, unlike loose artifact upload.
    with tarfile.open(package, 'r:gz') as archive:
        for name in ['jmcl', 'jmcl-core']:
            member = archive.getmember(f'{app.name}/Contents/MacOS/{name}')
            require(member.isfile() and member.mode & 0o111, f'Missing executable mode: {name}')
    unpacked = directory / 'unpacked'
    with tarfile.open(package, 'r:gz') as archive:
        archive.extractall(unpacked, filter='data')
    payload(unpacked / app.name / 'Contents/MacOS', target)
    return package


def inspect_nsis(directory, target):
    package = only((BUNDLE / 'nsis').glob('*-setup.exe'))
    expected = f"{CONFIG['productName']}_{CONFIG['version']}_x64-setup.exe"
    require(package.name == expected, f'Unexpected NSIS package filename: {package.name}')
    sevenzip = shutil.which('7z') or str(Path(os.environ['ProgramFiles']) / '7-Zip/7z.exe')
    require(Path(sevenzip).is_file(), 'Runner-provided 7-Zip is required; no fallback download')
    run(sevenzip, 'x', '-y', f'-o{directory}', package)  # archive reader, never setup.exe
    payload(directory, target)
    escaped = str(package).replace("'", "''")
    info = json.loads(run('pwsh', '-NoProfile', '-NonInteractive', '-Command',
        f"(Get-Item -LiteralPath '{escaped}').VersionInfo | Select-Object ProductName,ProductVersion | ConvertTo-Json").decode('utf-8-sig'))
    require(info['ProductName'] == CONFIG['productName'], f'Unexpected NSIS product metadata: {info}')
    require(info['ProductVersion'] in (CONFIG['version'], CONFIG['version'] + '.0'), f'Unexpected NSIS version metadata: {info}')
    return package


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--macos-format', choices=['dmg', 'app'], default='dmg')
    parser.add_argument('--profile', choices=['debug', 'release'], default='debug')
    parser.add_argument('--output-dir', type=Path)
    parser.add_argument('--smoke-core', action='store_true')
    parser.add_argument('--target', required=True, choices=['x86_64-unknown-linux-gnu', 'aarch64-apple-darwin', 'x86_64-apple-darwin', 'x86_64-pc-windows-msvc'])
    args = parser.parse_args()
    global BUNDLE, SMOKE_CORE
    BUNDLE = TARGET_DIR / args.profile / 'bundle'
    SMOKE_CORE = args.smoke_core
    require(CONFIG['bundle']['createUpdaterArtifacts'] is False, 'Updater artifacts must stay disabled')
    with tempfile.TemporaryDirectory(prefix='jmcl-package-check-') as temporary:
        directory = Path(temporary)
        if args.target.endswith('linux-gnu'):
            package = inspect_deb(directory, args.target)
        elif args.target.endswith('apple-darwin'):
            package = (inspect_app if args.macos_format == 'app' else inspect_dmg)(directory, args.target)
        else:
            package = inspect_nsis(directory, args.target)
        package_hash = digest(package)
        print(f'Inspected {args.profile} package {package.name}; sha256={package_hash}')
        if args.output_dir:
            args.output_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(package, args.output_dir / package.name)
            manifest = {
                'frontend_revision': run('git', '-C', ROOT, 'rev-parse', 'HEAD').decode().strip(),
                'core_revision': run('git', '-C', ROOT / '.ci-core', 'rev-parse', 'HEAD').decode().strip(),
                'target': args.target, 'profile': args.profile,
                'package': package.name, 'package_sha256': package_hash,
                'signed': False, 'notarized': False, **PAYLOAD,
                'not_tested': ['native GUI', 'real login', 'Minecraft launch', 'installer execution'],
            }
            (args.output_dir / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            (args.output_dir / 'SHA256SUMS.txt').write_text(f'{package_hash}  {package.name}\n')
        print('No installation, GUI launch, real login or release-signature acceptance performed.')


if __name__ == '__main__':
    main()
