#!/usr/bin/env python3
"""Static inspection of a newly built Windows x64 GUI NSIS; never run app/Core/installer."""
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = 'JMCL Rust GUI Test'
HOST = 'jmcl-rust-gui-test.exe'
CORE = 'jmcl-core.exe'
TARGET = 'x86_64-pc-windows-msvc'
BASE = '83e3fa749c56af79d1760b9e85c277d84286ca19'
CORE_PIN = '0b937fb1e68067a76b4324f22fb7af9a2d9cbd18'
CORE_TREE = '78e666ffc7b42c3311a1ff8ddf3af5afed7e3880'


def require(ok, message):
    if not ok:
        raise SystemExit(message)


def run(*args):
    return subprocess.check_output([str(x) for x in args], cwd=ROOT, timeout=90)


def digest(path):
    with path.open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()


def one(paths):
    paths = list(paths)
    require(len(paths) == 1, f'Expected exactly one candidate, got {len(paths)}')
    return paths[0]


def pe(path):
    with path.open('rb') as f:
        header = f.read(64)
        require(len(header) == 64 and header[:2] == b'MZ', f'Not MZ: {path.name}')
        f.seek(struct.unpack_from('<I', header, 60)[0])
        header = f.read(24 + 70)
    require(len(header) == 94 and header[:6] == b'PE\x00\x00\x64\x86', f'Not AMD64 PE: {path.name}')
    require(header[24:26] == b'\x0b\x02', f'Not PE32+: {path.name}')
    return struct.unpack_from('<H', header, 24 + 68)[0]


def main():
    require(os.name == 'nt', 'Only run on the native Windows build runner')
    core = ROOT / '.ci-core'
    base = json.loads((ROOT / 'src-tauri/tauri.conf.json').read_text(encoding='utf-8'))
    config = json.loads((ROOT / 'src-tauri/tauri.rust-gui-test.conf.json').read_text(encoding='utf-8'))
    require(base['version'] == '0.1.0' and 'version' not in config, 'Unexpected frontend version')
    require(config['identifier'] == 'page.mjoe.jmcl.experimental-rust-preview'
            and config['productName'] == PRODUCT and config['mainBinaryName'] + '.exe' == HOST,
            'Unexpected test app identity')
    require(config['bundle']['createUpdaterArtifacts'] is False
            and config['plugins']['updater']['pubkey'] == '', 'Unexpected updater settings')
    require(config['bundle']['windows']['nsis']['installMode'] == 'currentUser', 'Unexpected NSIS scope')
    require(config['app']['windows'][0]['create'] is False
            and config['app']['windows'][0]['dataDirectory'] == 'jmcl-rust-gui-test-profile-v1',
            'Unexpected test WebView configuration')
    require(run('git', 'rev-parse', 'HEAD^').decode().strip() == BASE, 'Unexpected frontend parent')
    require(run('git', '-C', core, 'rev-parse', 'HEAD').decode().strip() == CORE_PIN, 'Wrong Core base')
    require(run('git', '-C', core, 'write-tree').decode().strip() == CORE_TREE, 'Wrong versioned Core tree')
    source_binary = core / 'rust/target/release/jmcl-core-rust.exe'
    staged = ROOT / f'src-tauri/binaries/jmcl-core-{TARGET}.exe'
    nsis = ROOT / 'src-tauri/target/release/bundle/nsis'
    package = one(nsis.glob('*-setup.exe'))
    require(package.name == f'{PRODUCT}_0.1.0_x64-setup.exe', f'Unexpected filename: {package.name}')
    escaped = str(package).replace("'", "''")
    metadata = json.loads(run(
        'pwsh', '-NoProfile', '-NonInteractive', '-Command',
        f"(Get-Item -LiteralPath '{escaped}').VersionInfo | "
        "Select-Object ProductName,ProductVersion | ConvertTo-Json",
    ).decode('utf-8-sig'))
    require(metadata['ProductName'] == PRODUCT and metadata['ProductVersion'] in ('0.1.0', '0.1.0.0'),
            f'Unexpected NSIS string metadata: {metadata}')

    with tempfile.TemporaryDirectory(prefix='jmcl-gui-nsis-check-') as directory:
        unpacked = Path(directory)
        seven = shutil.which('7z') or str(Path(os.environ['ProgramFiles']) / '7-Zip/7z.exe')
        require(Path(seven).is_file(), 'Runner-provided 7-Zip required')
        run(seven, 'x', '-y', f'-o{unpacked}', package)  # extract only, never launch NSIS
        host = one(unpacked.rglob(HOST))
        packaged_core = one(unpacked.rglob(CORE))
        require(host.parent == packaged_core.parent, 'Payload does not have adjacent Core')
        require(all(p.is_file() and not p.is_symlink() for p in (host, packaged_core)),
                'Expected ordinary packaged executable files')
        require(pe(host) == 2, 'Packaged host does not declare Windows GUI subsystem')
        pe(packaged_core)
        hashes = {name: digest(path) for name, path in
                  (('compiled', source_binary), ('staged', staged), ('packaged', packaged_core))}
        require(len(set(hashes.values())) == 1, 'Bundled Core bytes differ from compiled and staged Core')

        deliver = ROOT / 'deliver'
        deliver.mkdir()  # must be fresh, never upload stale or unrelated files
        shutil.copy2(package, deliver / package.name)
        source = deliver / 'JMCLCore-0.1.0-rust-dev-corresponding-source.tar.gz'
        run('git', '-C', core, 'archive', '--format=tar.gz', '--prefix=JMCLCore/',
            f'--output={source}', CORE_TREE)
        shutil.copy2(core / 'LICENSE', deliver / 'JMCLCore-LICENSE.txt')
        shutil.copy2(ROOT / 'ci/rust-dev-version.patch', deliver / 'JMCLCore-version.patch')
        shutil.copy2(ROOT / 'LICENSE', deliver / 'JMCL-LICENSE.txt')
        shutil.copy2(ROOT / 'node_modules/@fontsource-variable/inter/LICENSE', deliver / 'Inter-LICENSE.txt')
        for name in ('jmcl-feature-andesite.png', 'jmcl-feature-andesite.LICENSE.txt'):
            require((ROOT / 'public' / name).read_bytes() == (ROOT / 'dist' / name).read_bytes(),
                    f'Bundled asset changed or missing: {name}')
        shutil.copy2(ROOT / 'public/jmcl-feature-andesite.LICENSE.txt', deliver)
        notes = """JMCL Rust GUI Test; Windows x64; frontend and NSIS 0.1.0.
Experimental Rust Core source version: 0.1.0-rust-dev; wire protocol 1.
Unsigned, static build and package inspection only. Neither app nor installer
nor game was run. Existing Java, WebView2, data isolation and actual game launch
require separate native acceptance. Managed Java, large modpacks, real accounts,
CurseForge, SSH and updater behavior are not accepted here. Do not override Windows
or browser security warnings. The attached archive is the exact versioned Core
source tree, and patch/manifest identify inputs and output hashes.
"""
        (deliver / 'TEST-SCOPE.txt').write_text(notes, encoding='utf-8')
        manifest = {
            'variant': 'experimental-rust-gui', 'target': TARGET, 'app_version': '0.1.0',
            'core_source_version': '0.1.0-rust-dev', 'frontend_base': BASE,
            'frontend_revision': run('git', 'rev-parse', 'HEAD').decode().strip(),
            'frontend_tree': run('git', 'rev-parse', 'HEAD^{tree}').decode().strip(),
            'core_base': CORE_PIN, 'core_tree': CORE_TREE,
            'core_lock_sha256': digest(core / 'rust/Cargo.lock'),
            'core_version_patch_sha256': digest(ROOT / 'ci/rust-dev-version.patch'),
            'core_payload_sha256': hashes, 'core_source_archive_sha256': digest(source),
            'package': package.name, 'package_sha256': digest(package), 'host_sha256': digest(host),
            'host_subsystem': 'Windows GUI (static PE header only)', 'signed': False,
            'rustc': run('rustc', '-vV').decode().strip(),
            'github_run': os.environ['GITHUB_RUN_ID'], 'runner_image': os.getenv('ImageVersion', 'see job setup log'),
            'not_tested': ['installer', 'real GUI/WebView', 'bundled runtime handshake',
                           'visible console', 'Java', 'game', 'accounts/providers', 'security reputation'],
        }
        (deliver / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        sums = ''.join(f'{digest(p)}  {p.name}\n' for p in sorted(deliver.iterdir()))
        (deliver / 'SHA256SUMS.txt').write_text(sums, encoding='utf-8')
        require(len(list(deliver.iterdir())) == 10, 'Unexpected delivery file count')
        print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
