#!/usr/bin/env python3
"""Explicit offline build and guarded synthetic recovery experiment. No fetching."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import tempfile
import time

BASE = Path(__file__).resolve().parent
FRONTEND = BASE.parents[2]


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def blob_sha(path):
    data = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def require(condition, message):
    if not condition:
        raise RuntimeError(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--build-core", action="store_true", required=True,
                        help="Explicitly build the pinned Core offline; never download dependencies")
    for name in ("core-checkout", "cargo", "rustc", "bun", "cargo-home", "output-directory"):
        parser.add_argument("--" + name, required=True, type=Path)
    args = parser.parse_args()
    require(sys.platform == "linux" and platform.machine() == "x86_64", "Linux x86_64 required")
    core_root = args.core_checkout.resolve(strict=True)
    cargo, rustc, bun = (getattr(args, name).resolve(strict=True) for name in ("cargo", "rustc", "bun"))
    cargo_home = args.cargo_home.resolve(strict=True)
    output = args.output_directory.resolve(strict=True)
    python = Path(sys.executable).resolve(strict=True)
    lock = json.loads((BASE / "source-lock.json").read_text())
    head = subprocess.check_output(["git", "-C", str(core_root), "rev-parse", "HEAD"], text=True).strip()
    require(head == lock["core_commit"], "Core checkout must have the exact pinned commit")
    tracked = [BASE / "source-lock.json", python, cargo, rustc, bun]
    for root, entries in ((FRONTEND, lock["frontend_git_blobs"]), (core_root, lock["core_git_blobs"])):
        for relative, expected in entries.items():
            path = root / relative
            require(blob_sha(path) == expected, "Source blob mismatch: " + relative)
            tracked.append(path)
    for root, entries in ((FRONTEND / "node_modules", lock["tauri_runtime_sha256"]), (BASE, lock["harness_sha256"])):
        for relative, expected in entries.items():
            path = root / relative
            require(sha256(path) == expected, "Runtime/harness hash mismatch: " + relative)
            tracked.append(path)
    guard = core_root / "rust/compat/frontend_bridge/launch_network_guard.py"
    spawn_source = core_root / "rust/compat/frontend_bridge/tests/fixtures/launch_spawn_gate.rs"
    require(sha256(guard) == lock["core_guard_sha256"], "Guard changed")
    require(sha256(spawn_source) == lock["core_spawn_fixture_sha256"], "Spawn fixture changed")
    evidence = Path(tempfile.mkdtemp(prefix="modpack-recovery-", dir=output))
    print(evidence, flush=True)
    expected = {str(path): sha256(path) for path in tracked}
    (evidence / "hashes-before.json").write_text(json.dumps(expected, indent=2))
    env = {"PATH": "/usr/bin:/bin", "HOME": str(evidence), "LANG": "C.UTF-8",
           "CARGO_HOME": str(cargo_home), "RUSTC": str(rustc), "CARGO_INCREMENTAL": "0",
           "CARGO_PROFILE_DEV_DEBUG": "0", "CARGO_PROFILE_TEST_DEBUG": "0"}
    steps = []

    def gate(name, command):
        full = [str(python), str(BASE / "run_owned.py"), str(evidence / name), *map(str, command)]
        started = time.time()
        try:
            result = subprocess.run(full, env=env, cwd=evidence, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=110)
        except subprocess.TimeoutExpired:
            (evidence / "UNCERTAIN-CLEANUP.json").write_text(json.dumps({
                "gate": name, "command": full, "reason": "Supervisor timeout; cleanup unknown. No later gate started."}))
            raise
        (evidence / (name + ".supervisor.stdout.raw")).write_bytes(result.stdout)
        (evidence / (name + ".supervisor.stderr.raw")).write_bytes(result.stderr)
        steps.append({"name": name, "command": full, "returncode": result.returncode,
                      "started": started, "finished": time.time()})
        (evidence / "steps.json").write_text(json.dumps(steps, indent=2))
        require(result.returncode == 0, "Gate failed; stop without fallback: " + name)

    try:
        gate("build-core", [cargo, "build", "--offline", "--locked", "--manifest-path",
                            core_root / "rust/Cargo.toml", "--target-dir", evidence / "target", "--bin", "jmcl-core-rust"])
        core = evidence / "target/debug/jmcl-core-rust"
        gate("build-spawn-fixture", [rustc, "--edition=2024", spawn_source, "-o", evidence / "spawn-gate"])
        probe = evidence / "spawn-gate"
        generated = {str(path): sha256(path) for path in (core, probe)}
        (evidence / "built-binaries.json").write_text(json.dumps(generated, indent=2))
        gate("relay-pure-fixtures", [python, "-I", "-S", BASE / "test_relay.py"])
        gate("relay-fstat", [bun, BASE / "stdio_relay_probe.ts", python, BASE / "stdio_relay.py", BASE / "relay_fixtures.py"])
        gate("guard-selftest", [python, "-I", "-S", guard, "--selftest"])
        for mode in ("success", "missing"):
            gate("spawn-" + mode, [python, "-I", "-S", guard, "--exec", probe, mode])
        owned = evidence / "owned-fixture"
        gate("seed", [python, "-I", "-S", BASE / "seed.py", owned])
        gate("recovery", [bun, BASE / "recovery.ts", owned, core, guard, python, BASE / "stdio_relay.py"])
        require(json.loads((owned / "result.json").read_text())["sessions"] == 3, "Missing recovery result")
        require(all(sha256(Path(path)) == digest for path, digest in generated.items()), "Built binary changed")
    finally:
        after = {str(path): sha256(path) for path in tracked}
        (evidence / "hashes-after.json").write_text(json.dumps(after, indent=2))
        require(after == expected, "Source or tool changed during execution")
    (evidence / "PASS").write_text("Guarded controller recovery assertions passed. See README scope limits.\n")


if __name__ == "__main__":
    main()
