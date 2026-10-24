"""Inspect the generated DMG read-only; no GUI, accounts, or installation."""
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
output = root / 'dmg-output'
package = output / 'jmcl_0.1.0_aarch64.dmg'
manifest = json.loads((root / 'dmg-input/manifest.json').read_text())
with tempfile.TemporaryDirectory(prefix='jmcl-dmg-verify-') as temporary:
    mount = Path(temporary) / 'mounted'
    mount.mkdir()
    subprocess.run(['hdiutil', 'attach', '-readonly', '-nobrowse', '-noautoopen', '-mountpoint', str(mount), str(package)], check=True)
    try:
        app = mount / 'jmcl.app'
        info = plistlib.loads((app / 'Contents/Info.plist').read_bytes())
        assert info['CFBundleIdentifier'] == 'page.mjoe.jmcl'
        assert info['CFBundleShortVersionString'] == '0.1.0'
        for name, key in [('jmcl', 'desktop_sha256'), ('jmcl-core', 'core_sha256')]:
            binary = app / 'Contents/MacOS' / name
            assert hashlib.sha256(binary.read_bytes()).hexdigest() == manifest[key]
            assert binary.stat().st_mode & 0o111
        core = app / 'Contents/MacOS/jmcl-core'
        request = {'protocol': 1, 'id': 'dmg-smoke', 'method': 'core.version', 'params': {}}
        response = subprocess.run([str(core), 'rpc'], input=json.dumps(request) + '\n', text=True, capture_output=True, timeout=15, check=True, cwd=temporary)
        replies = [json.loads(line) for line in response.stdout.splitlines() if line.strip()]
        reply = next(item for item in replies if item.get('id') == 'dmg-smoke')
        assert reply.get('event') == 'result' and reply['result']['name'] == 'jmcl-core'
    finally:
        subprocess.run(['hdiutil', 'detach', str(mount)], check=True)
manifest['source_package'] = manifest['package']
manifest['source_package_sha256'] = manifest['package_sha256']
manifest['package'] = package.name
manifest['package_sha256'] = hashlib.sha256(package.read_bytes()).hexdigest()
manifest['packaging_revision'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
manifest['dmg_core_version_smoke'] = 'passed'
(output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
(output / 'SHA256SUMS.txt').write_text(f"{manifest['package_sha256']}  {package.name}\n")
print('Mounted DMG contains byte-identical original desktop/Core; core.version passed.')
