#!/usr/bin/env python3
"""Linux-only, bounded actual Tauri command/MockRuntime acceptance, not UI QA.
No downloads, package install, server, Java, browser, or remote writes.
The caller supplies a previously built RustCore binary and its expected hash.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import signal
import subprocess
import sys
import time
import tempfile

FRONTEND = "9c0fd81ce8109c1e35229560fee31308ca114ef5"
CORE = "bdd6cb3e55d69cb9e0e02037d251635e289207a8"
TEST = "tauri_rust_core_contract::actual_invoke_rust_core_lifecycle"
ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()




def verify_hash(path, expected):
    digest = sha(path)
    if digest != expected:
        raise RuntimeError('binary hash mismatch')
    return digest


def finalize(report, out, owned_temp):
    try:
        owned_temp.cleanup()
    except Exception as error:
        report.update(status='failed', cleanup_error=str(error))
        raise
    finally:
        report['raw_logs'] = {path.name: {'bytes': path.stat().st_size, 'sha256': sha(path)} for path in out.glob('*.log')}
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


def verify_elf(path):
    data = path.read_bytes()[:20]
    if len(data) != 20 or data[:6] != b'\x7fELF\x02\x01' or int.from_bytes(data[18:20], 'little') != 62:
        raise RuntimeError('expected native ELF64 x86_64 executable')


def verify_inventory(text):
    if text.splitlines().count(TEST + ': test') != 1 or text.splitlines().count('1 test, 0 benchmarks') != 1:
        raise RuntimeError('test inventory must be exactly one')
    if len([line for line in text.splitlines() if line.endswith(': test')]) != 1:
        raise RuntimeError('unexpected additional test')


def verify_result(text):
    if text.splitlines().count('TAURI_PRODUCTION_CONTEXT mode=development origin=http://localhost:1420/ release=false') != 1:
        raise RuntimeError('missing unique production development context marker')
    marker = 'TAURI_RUST_CORE_CONTRACT_OK sessions=2 dispatch=actual runtime=mock ui=false'
    summaries = re.findall(r'^test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored;', text, re.M)
    if summaries != [('1', '0', '0')] or text.splitlines().count(marker) != 1 or text.splitlines().count('TAURI_REMOTE_ORIGIN_REJECTED pool_empty=true') != 1:
        raise RuntimeError('missing exact pass count or unique completion marker')


def verify_sources(root):
    def original(path):
        return subprocess.check_output(['git', 'show', FRONTEND + ':' + path], cwd=root, timeout=10)
    additions = {
        'src-tauri/Cargo.toml': b'\n# Opt-in only: production defaults and dependency versions stay unchanged.\n[features]\ntauri-rust-core-contract = ["tauri/test"]\n\n[dev-dependencies]\ntempfile = "=3.27.0"\n',
        'src-tauri/src/lib.rs': b'\n#[cfg(all(test, feature = "tauri-rust-core-contract"))]\nmod tauri_rust_core_contract;\n',
    }
    names = subprocess.check_output(['git', 'ls-files', 'src-tauri'], cwd=root, timeout=10).decode().splitlines()
    for name in names:
        expected = original(name)
        if name in additions:
            expected += additions[name]
        elif name == 'src-tauri/Cargo.lock':
            start = expected.index(b'name = "jmcl"\n')
            end = expected.index(b'\n[[package]]', start)
            block = expected[start:end].replace(b' "thiserror 2.0.19",', b' "tempfile",\n "thiserror 2.0.19",')
            expected = expected[:start] + block + expected[end:]
        if (root / name).read_bytes() != expected:
            raise RuntimeError('unexpected production/source diff: ' + name)
    extras = subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', 'src-tauri'], cwd=root, timeout=10).decode().splitlines()
    if extras != ['src-tauri/src/tauri_rust_core_contract.rs']:
        raise RuntimeError('unexpected untracked Tauri input: ' + repr(extras))


def group_members(pgid):
    found = []
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit():
            continue
        try:
            fields = (entry / 'stat').read_text().rsplit(')', 1)[1].split()
            if int(fields[2]) == pgid:
                found.append(int(entry.name))
        except (FileNotFoundError, ProcessLookupError, PermissionError):
            pass
    return found


def bounded(args, log, env, seconds, cwd=ROOT):
    # No shell, fresh group, file output so a surviving grandchild cannot hold
    # communicate() open. Never kill unrelated processes or by executable name.
    with log.open('w') as output:
        process = subprocess.Popen(args, cwd=cwd, env=env, stdout=output,
                                   stderr=subprocess.STDOUT, start_new_session=True)
        timed_out = False
        leaked = []
        try:
            try:
                code = process.wait(timeout=seconds)
            except subprocess.TimeoutExpired:
                timed_out = True
                code = -1
        finally:
            leaked = group_members(process.pid)
            if leaked:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            process.wait(timeout=10)
            for _ in range(100):
                # Linux subreaper adopts only this runner's orphan descendants.
                # Reap the owned process group, including exited Core children.
                while True:
                    try:
                        reaped, _ = os.waitpid(-process.pid, os.WNOHANG)
                    except ChildProcessError:
                        break
                    if reaped == 0:
                        break
                if not group_members(process.pid):
                    break
                time.sleep(.05)
            if group_members(process.pid):
                raise RuntimeError(f'owned process group cleanup failed: {process.pid}')
        if timed_out or leaked or code:
            raise RuntimeError(f'{args[0]} failed: exit={code} timeout={timed_out} leftover={leaked}; see {log}')
    raw = log.read_bytes()
    return raw.decode('utf-8', errors='strict')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--core-binary', type=Path, required=True)
    p.add_argument('--expected-core-sha256', required=True)
    p.add_argument('--core-source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if sys.platform != 'linux' or platform.machine() != 'x86_64':
        p.error('this owned-process cleanup runner is Linux x86_64-only; other hosts need their own reviewed runner')
    libc = ctypes.CDLL(None, use_errno=True)
    libc.prctl.argtypes = [ctypes.c_int] + [ctypes.c_ulong] * 4
    libc.prctl.restype = ctypes.c_int
    if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER, this process only
        raise OSError(ctypes.get_errno(), 'cannot enable owned descendant reaping')
    out = a.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    env = {key: value for key, value in os.environ.items() if not key.startswith(('JMCL_', 'CARGO_TARGET_', 'CARGO_BUILD_', 'RUSTFLAGS', 'RUSTDOCFLAGS', 'CARGO_ENCODED_')) and key not in ('RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'RUSTC', 'RUSTDOC')}
    owned_temp = tempfile.TemporaryDirectory(prefix='owned-runtime-', dir=out)
    env['TMPDIR'] = owned_temp.name
    report = {'status': 'blocked', 'host': platform.platform(), 'machine': platform.machine(),
              'runtime': 'MockRuntime', 'context': 'production-development', 'release': False, 'real_ui': False, 'tests_executed': 0}
    try:
        for name, source, expected in [('frontend', ROOT, FRONTEND), ('core', a.core_source.resolve(), CORE)]:
            head = bounded(['git', 'rev-parse', 'HEAD'], out / f'{name}-head.log', env, 10, source).strip()
            tree = bounded(['git', 'rev-parse', 'HEAD^{tree}'], out / f'{name}-tree.log', env, 10, source).strip()
            if head != expected:
                raise RuntimeError(f'{name} source HEAD differs: {head}')
            report[name] = {'head': head, 'tree': tree}
        verify_sources(ROOT)
        core = a.core_binary.resolve(strict=True)
        verify_elf(core)
        digest = verify_hash(core, a.expected_core_sha256)
        report['core_binary'] = {'path': str(core), 'sha256': digest,
            'provenance': 'caller-supplied artifact; source HEAD recorded separately, not rebuilt by this runner'}
        report['fixture_hashes'] = {str(path.relative_to(ROOT)): sha(path) for path in [
            ROOT / 'src-tauri/Cargo.toml', ROOT / 'src-tauri/Cargo.lock',
            ROOT / 'src-tauri/src/lib.rs', ROOT / 'src-tauri/src/tauri_rust_core_contract.rs', Path(__file__).resolve()]}
        # Stop before Cargo if native link dependencies are absent. No install or
        # alternate environment fallback, and never disable production defaults.
        bounded(['pkg-config', '--modversion', 'gtk+-3.0', 'webkit2gtk-4.1',
                 'javascriptcoregtk-4.1', 'libsoup-3.0', 'dbus-1'], out / 'system-dependencies.log', env, 10)
        host = bounded(['rustc', '-vV'], out / 'rustc-host.log', env, 10)
        if 'host: x86_64-unknown-linux-gnu' not in host.splitlines():
            raise RuntimeError('native Linux x86_64 Rust toolchain required')
        env['CARGO_TARGET_DIR'] = str(out / 'target')
        # Production development context; preserve the already-reviewed build-only
        # externalBin exclusion. No production Zig sidecar is staged.
        env['TAURI_CONFIG'] = json.dumps({'bundle': {'externalBin': []}})
        report['stage'] = 'compile'
        build = bounded(['cargo', 'test', '--offline', '--locked', '--manifest-path',
            str(ROOT / 'src-tauri/Cargo.toml'), '--lib', '--features', 'tauri-rust-core-contract',
            '--no-run', '--message-format=json'], out / 'build.log', env, 900)
        artifacts = []
        for line in build.splitlines():
            try:
                obj = json.loads(line)
            except ValueError:
                continue
            if obj.get('reason') == 'compiler-artifact' and obj.get('profile', {}).get('test') and obj.get('target', {}).get('name') == 'jmcl_lib' and obj.get('executable'):
                artifacts.append(obj['executable'])
        if len(artifacts) != 1:
            raise RuntimeError(f'expected exactly one test executable, found {len(artifacts)}')
        exe = Path(artifacts[0]).resolve(strict=True)
        if not exe.is_relative_to(out / 'target'):
            raise RuntimeError('test artifact escaped owned target directory')
        verify_elf(exe)
        report['test_binary_sha256'] = sha(exe)
        listing = bounded([str(exe), TEST, '--exact', '--ignored', '--list'], out / 'inventory.log', env, 10)
        verify_inventory(listing)
        verify_sources(ROOT)
        if sha(core) != digest or sha(exe) != report['test_binary_sha256']:
            raise RuntimeError('binary changed before execution')
        if any(sha(ROOT / path) != digest for path, digest in report['fixture_hashes'].items()):
            raise RuntimeError('fixture changed before execution')
        env['JMCL_TAURI_CONTRACT_CORE'] = str(core)
        env['JMCL_TAURI_CONTRACT_BOUNDED'] = '1'
        report.update(status='failed', stage='execute', test_attempted=True, tests_executed=None)
        result = bounded([str(exe), TEST, '--exact', '--ignored', '--nocapture', '--test-threads=1'],
                         out / 'test.log', env, 60)
        verify_result(result)
        verify_sources(ROOT)
        if sha(core) != digest or sha(exe) != report['test_binary_sha256']:
            raise RuntimeError('binary changed during execution')
        if any(sha(ROOT / path) != digest for path, digest in report['fixture_hashes'].items()):
            raise RuntimeError('fixture changed during execution')
        report.update(status='passed', tests_executed=1)
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        finalize(report, out, owned_temp)

if __name__ == '__main__':
    main()
