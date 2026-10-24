"""Prepare only the hash-pinned, previously built app; never compile or sign."""
import hashlib
import json
from pathlib import Path
import tarfile
import zipfile

root = Path(__file__).resolve().parents[1]
source = root / 'dmg-input'
with zipfile.ZipFile(source / 'artifact.zip') as archive:
    names = archive.namelist()
    expected = {'manifest.json', 'SHA256SUMS.txt', 'jmcl_0.1.0_aarch64-apple-darwin.app.tar.gz'}
    assert set(names) == expected, names
    archive.extractall(source)
manifest = json.loads((source / 'manifest.json').read_text())
assert manifest['frontend_revision'] == 'd1c75b94f46be963859552e3592cfd6117fdccdf'
assert manifest['core_revision'] == '5a4310debbcee26b3d2391bab2339f79cd6ec52e'
assert manifest['target'] == 'aarch64-apple-darwin'
package = source / manifest['package']
assert hashlib.sha256(package.read_bytes()).hexdigest() == manifest['package_sha256']
with tarfile.open(package, 'r:gz') as archive:
    archive.extractall(source / 'unpacked', filter='data')
for name, key in [('jmcl', 'desktop_sha256'), ('jmcl-core', 'core_sha256')]:
    binary = source / 'unpacked/jmcl.app/Contents/MacOS' / name
    assert binary.is_file() and binary.stat().st_mode & 0o111
    assert hashlib.sha256(binary.read_bytes()).hexdigest() == manifest[key]
print('Original app archive and both executable hashes verified; source', manifest['frontend_revision'])
