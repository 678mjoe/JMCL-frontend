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
import zipfile
import shutil

FRONTEND = "9c0fd81ce8109c1e35229560fee31308ca114ef5"
CORE = "bdd6cb3e55d69cb9e0e02037d251635e289207a8"
TEST = "tauri_rust_core_contract::actual_invoke_rust_core_channel"
ROOT = Path(__file__).resolve().parents[1]
GUARD = ROOT / 'scripts/launch_network_guard.py'
SPAWN = ROOT / 'scripts/fixtures/launch_spawn_gate.rs'
GUARD_SHA = '2790712aaf757536329cc1ac87c73931f04bf1a1f6dc3f375f782db08423e719'
SPAWN_SHA = '77b2f1569434d5e0a7779e32f8dd6a66a7badddf9040dfccb9a5436679273767'
PAYLOAD = b'owned tauri channel cached fixture\n'
SELFTEST = ('Launch guard self-tests passed: 18 denied syscalls; exact local recvfrom; six nonzero argument halves; '
            'five forbidden pair domains; x32 bit and bare512-547; architecture; two exec boundaries; '
            'thread inheritance/single-thread install; socket stdio/extra-fd hygiene\n')


def prepare_fixture(root):
    digest = hashlib.sha1(PAYLOAD).hexdigest()
    manifest = {'formatVersion': 1, 'game': 'minecraft', 'versionId': 'owned', 'name': 'Owned',
                'dependencies': {'minecraft': '1.20.1'}, 'files': [{'path': 'mods/owned-fixture.txt',
                'hashes': {'sha1': digest}, 'fileSize': len(PAYLOAD),
                'downloads': ['https://127.0.0.1:9/owned-fixture.txt']}]}
    root.mkdir()
    encoded = json.dumps(manifest).encode()
    (root / 'manifest.json').write_bytes(encoded)
    with zipfile.ZipFile(root / 'owned.mrpack', 'w', compression=zipfile.ZIP_STORED) as archive:
        archive.writestr('modrinth.index.json', encoded)
    obj = root / 'store/objects/sha1' / digest[:2] / digest
    obj.parent.mkdir(parents=True)
    obj.write_bytes(PAYLOAD)
    return {str(p.relative_to(root)): sha(p) for p in root.rglob('*') if p.is_file()}


def verify_fixture(root, hashes, installed=False):
    for name, digest in hashes.items():
        verify_hash(root / name, digest)
    if installed:
        targets = list((root / 'instances').rglob('mods/owned-fixture.txt'))
        if len(targets) != 1 or targets[0].read_bytes() != PAYLOAD:
            raise RuntimeError('expected exactly one installed owned payload')


def guard_command(*args):
    verify_hash(GUARD.resolve(strict=True), GUARD_SHA)
    return [str(Path(sys.executable).resolve(strict=True)), '-I', '-S', str(GUARD.resolve(strict=True)), *args]


def verify_gate(stdout, stderr, expected):
    if stdout != expected or stderr != b'':
        raise RuntimeError('guard gate stdout/stderr mismatch')



def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()




def verify_hash(path, expected):
    digest = sha(path)
    if digest != expected:
        raise RuntimeError('binary hash mismatch')
    return digest


def finalize(report, out, owned_temp):
    try:
        report['raw_logs'] = {}
        for path in out.glob('*.log'):
            report['raw_logs'][path.name] = {'bytes': path.stat().st_size, 'sha256': sha(path)}
        if report.get('status') == 'passed':
            shutil.rmtree(owned_temp)
    except Exception as error:
        report.update(status='failed', finalization_error=str(error))
        report.setdefault('error', 'evidence finalization failed: ' + str(error))
        raise
    finally:
        if report.get('status') != 'passed':
            report['retained_fixture'] = str(owned_temp)
        (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')


def finish_evidence(report, out, owned_temp, binaries, fixture=None):
    try:
        report['post_hashes'] = {}
        paths = {name: ROOT / name for name in report.get('fixture_hashes', {})}
        paths.update({name: path for name, path in binaries.items() if path is not None})
        for name, path in paths.items():
            report['post_hashes'][name] = sha(path) if path.is_file() else None
        if fixture is not None:
            report['owned_fixture_post_hashes'] = {str(path.relative_to(fixture)): sha(path)
                for path in fixture.rglob('*') if path.is_file()}
    except Exception as error:
        report.update(status='failed', post_hash_error=str(error))
        report.setdefault('error', 'post-execution evidence failed: ' + str(error))
        raise
    finally:
        finalize(report, out, owned_temp)


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
    marker = 'TAURI_CHANNEL_EGRESS_OK tests=1 cached=1 dispatch=actual runtime=mock js=false'
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
    stderr_log = log.with_name(log.stem + '.stderr.log')
    evidence = {'args': args, 'deadline_seconds': seconds, 'timed_out': False,
                'group_before_cleanup': None, 'group_after_cleanup': None, 'exit': None, 'signal': None, 'status': 'failed'}
    process = None
    try:
        with log.open('wb') as output, stderr_log.open('wb') as errors:
            process = subprocess.Popen(args, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                stdout=output, stderr=errors, start_new_session=True, close_fds=True)
            evidence['pid'] = evidence['pgid'] = process.pid
            try:
                process.wait(timeout=seconds)
            except subprocess.TimeoutExpired:
                evidence['timed_out'] = True
            finally:
                try:
                    evidence['group_before_cleanup'] = group_members(process.pid)
                    if evidence['group_before_cleanup']:
                        try:
                            os.killpg(process.pid, signal.SIGKILL)
                        except ProcessLookupError:
                            pass
                    process.wait(timeout=10)
                    for _ in range(100):
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
                    evidence['group_after_cleanup'] = group_members(process.pid)
                    evidence['exit'] = process.returncode
                    evidence['signal'] = -process.returncode if process.returncode < 0 else None
                    if evidence['group_after_cleanup']:
                        raise RuntimeError('owned process group cleanup failed')
                except Exception as error:
                    evidence['cleanup_error'] = str(error)
                    raise
            if evidence['timed_out'] or evidence['group_before_cleanup'] or process.returncode:
                raise RuntimeError(f"phase failed: exit={process.returncode} timeout={evidence['timed_out']} leftover={evidence['group_before_cleanup']}; see {log}")
        text = log.read_bytes().decode('utf-8', errors='strict')
        evidence['status'] = 'passed'
        return text
    except Exception as error:
        evidence['error'] = str(error)
        raise
    finally:
        evidence['logs'] = {p.name: {'bytes': p.stat().st_size, 'sha256': sha(p)}
                            for p in (log, stderr_log) if p.exists()}
        log.with_suffix('.phase.json').write_text(json.dumps(evidence, indent=2) + '\n')


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--core-binary', type=Path, required=True)
    p.add_argument('--expected-core-sha256', required=True)
    p.add_argument('--core-source', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    a = p.parse_args()
    if sys.platform != 'linux' or platform.machine() != 'x86_64' or ctypes.sizeof(ctypes.c_void_p) != 8 or ctypes.sizeof(ctypes.c_long) != 8:
        p.error('this owned-process cleanup runner is Linux x86_64-only; other hosts need their own reviewed runner')
    out = a.output.resolve()
    out.mkdir(parents=True, exist_ok=False)
    env = {key: value for key, value in os.environ.items() if not key.startswith(('JMCL_', 'CARGO_TARGET_', 'CARGO_BUILD_', 'RUSTFLAGS', 'RUSTDOCFLAGS', 'CARGO_ENCODED_')) and not key.lower().endswith('proxy') and key not in ('RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'RUSTC', 'RUSTDOC')}
    owned_temp = Path(tempfile.mkdtemp(prefix='owned-runtime-', dir=out))
    env['TMPDIR'] = str(owned_temp)
    report = {'status': 'blocked', 'host': platform.platform(), 'machine': platform.machine(),
              'runtime': 'MockRuntime', 'real_ui': False, 'tests_executed': 0}
    try:
        libc = ctypes.CDLL(None, use_errno=True)
        libc.prctl.argtypes = [ctypes.c_int] + [ctypes.c_ulong] * 4
        libc.prctl.restype = ctypes.c_int
        if libc.prctl(36, 1, 0, 0, 0) != 0:  # PR_SET_CHILD_SUBREAPER, this process only
            raise OSError(ctypes.get_errno(), 'cannot enable owned descendant reaping')
        report['subreaper'] = True
        for name, source, expected in [('frontend', ROOT, FRONTEND), ('core', a.core_source.resolve(), CORE)]:
            head = bounded(['git', 'rev-parse', 'HEAD'], out / f'{name}-head.log', env, 10, source).strip()
            tree = bounded(['git', 'rev-parse', 'HEAD^{tree}'], out / f'{name}-tree.log', env, 10, source).strip()
            if head != expected:
                raise RuntimeError(f'{name} source HEAD differs: {head}')
            report[name] = {'head': head, 'tree': tree}
        verify_sources(ROOT)
        verify_hash(GUARD, GUARD_SHA)
        verify_hash(SPAWN, SPAWN_SHA)
        core = a.core_binary.resolve(strict=True)
        verify_elf(core)
        digest = verify_hash(core, a.expected_core_sha256)
        report['core_binary'] = {'path': str(core), 'sha256': digest,
            'provenance': 'caller-supplied artifact; source HEAD recorded separately, not rebuilt by this runner'}
        report['fixture_hashes'] = {str(path.relative_to(ROOT)): sha(path) for path in [
            ROOT / 'src-tauri/Cargo.toml', ROOT / 'src-tauri/Cargo.lock',
            GUARD, SPAWN, ROOT / 'src-tauri/src/lib.rs', ROOT / 'src-tauri/src/tauri_rust_core_contract.rs', Path(__file__).resolve()]}
        # Stop before Cargo if native link dependencies are absent. No install or
        # alternate environment fallback, and never disable production defaults.
        bounded(['pkg-config', '--modversion', 'gtk+-3.0', 'webkit2gtk-4.1',
                 'javascriptcoregtk-4.1', 'libsoup-3.0', 'dbus-1'], out / 'system-dependencies.log', env, 10)
        host = bounded(['rustc', '-vV'], out / 'rustc-host.log', env, 10)
        if 'host: x86_64-unknown-linux-gnu' not in host.splitlines():
            raise RuntimeError('native Linux x86_64 Rust toolchain required')
        gate = owned_temp / 'launch-spawn-gate'
        report.update(status='failed', stage='spawn-build')
        bounded(['rustc', '--edition=2021', str(SPAWN), '-o', str(gate)], out / 'spawn-build.log', env, 60)
        verify_elf(gate)
        report['spawn_binary_sha256'] = sha(gate)
        env['CARGO_TARGET_DIR'] = str(out / 'target')
        # Test app uses noop_assets. Do not require/stage a production Zig sidecar.
        env['TAURI_CONFIG'] = json.dumps({'bundle': {'externalBin': []}})
        report.update(status='failed', stage='compile')
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
        fixture = owned_temp / 'fixture'
        report['owned_fixture_hashes'] = prepare_fixture(fixture)
        verify_fixture(fixture, report['owned_fixture_hashes'])
        env['JMCL_TAURI_CHANNEL_FIXTURE'] = str(fixture)
        # After preparation, every gate/runtime anomaly is a failed candidate.
        # Installation denials retain their raw stderr and stage; no SIGSYS is
        # reclassified as an expected negative outside the fixed selftest.
        report['status'] = 'failed'
        for label, args, expected, deadline in [
            ('guard-selftest', ['--selftest'], SELFTEST, 180),
            ('spawn-missing', ['--exec', str(gate), 'missing'], 'missing spawn returned NotFound\n', 30),
            ('spawn-success', ['--exec', str(gate), 'success'], 'benign child started\nsuccessful spawn returned exit 0\n', 30),
        ]:
            verify_hash(SPAWN, SPAWN_SHA)
            verify_hash(gate, report['spawn_binary_sha256'])
            report.update(status='failed', stage=label)
            log = out / (label + '.log')
            result = bounded(guard_command(*args), log, env, deadline)
            verify_gate(result, log.with_name(log.stem + '.stderr.log').read_bytes(), expected)
        verify_sources(ROOT)
        verify_hash(core, digest)
        verify_hash(exe, report['test_binary_sha256'])
        if any(sha(ROOT / path) != expected for path, expected in report['fixture_hashes'].items()):
            raise RuntimeError('source changed before guarded inventory')
        report.update(status='failed', stage='guarded-inventory')
        verify_fixture(fixture, report['owned_fixture_hashes'])
        listing = bounded(guard_command('--exec', str(exe), TEST, '--exact', '--ignored', '--list'), out / 'inventory.log', env, 10)
        verify_inventory(listing)
        verify_sources(ROOT)
        if sha(core) != digest or sha(exe) != report['test_binary_sha256']:
            raise RuntimeError('binary changed before execution')
        if any(sha(ROOT / path) != digest for path, digest in report['fixture_hashes'].items()):
            raise RuntimeError('fixture changed before execution')
        verify_fixture(fixture, report['owned_fixture_hashes'])
        env['JMCL_TAURI_CONTRACT_CORE'] = str(core)
        env['JMCL_TAURI_CONTRACT_BOUNDED'] = '1'
        report.update(status='failed', stage='execute', test_attempted=True, tests_executed=None)
        result = bounded(guard_command('--exec', str(exe), TEST, '--exact', '--ignored', '--nocapture', '--test-threads=1'),
                         out / 'test.log', env, 60)
        verify_result(result)
        verify_sources(ROOT)
        if sha(core) != digest or sha(exe) != report['test_binary_sha256']:
            raise RuntimeError('binary changed during execution')
        if any(sha(ROOT / path) != digest for path, digest in report['fixture_hashes'].items()):
            raise RuntimeError('fixture changed during execution')
        verify_fixture(fixture, report['owned_fixture_hashes'], installed=True)
        verify_hash(gate, report['spawn_binary_sha256'])
        report.update(status='passed', tests_executed=1)
    except Exception as error:
        report['error'] = str(error)
        raise
    finally:
        finish_evidence(report, out, owned_temp, {'core_binary': locals().get('core'),
            'test_binary': locals().get('exe'), 'spawn_binary': locals().get('gate')}, locals().get('fixture'))


if __name__ == '__main__':
    main()
