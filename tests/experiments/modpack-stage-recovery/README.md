# Synthetic Modpack stage recovery experiment

This test-only experiment joins the original `ModpackImportController` and `CoreSession` typed methods to a real Rust Core RPC subprocess through the existing `createForTesting` request seam. The lifecycle seam closes the subprocess; an unmodified controller owns state and mutation leases.

It is **not** NativeSession, Tauri IPC, WebView/rendered UI, packaged-app, Java, game, or application-restart acceptance. The same controller remains alive while Core subprocess sessions are replaced.

## Recorded result and source identity

The accompanying three stdout JSONL files are unchanged raw bytes from a successful prior local execution. They contain only synthetic fixture data. `evidence/summary.json` records their SHA-256 hashes and the verified result. Requests and local filesystem/PID diagnostics are intentionally not included in this public record.

- Frontend source: `678mjoe/JMCL-frontend` at `9c0fd81ce8109c1e35229560fee31308ca114ef5`.
- Core source: `678mjoe/JMCLCore` at `bdd6cb3e55d69cb9e0e02037d251635e289207a8`.
- Tested Rust/Cargo: 1.99.1; Bun: 1.4.4; installed Tauri API dependency: 2.12.4.
- Tested recovery harness SHA-256 before changing only its repository-relative imports: `ab1d3b025f130d7981bb26015d3557e40492f9c6f43a18dccb9bed1bea8b7133`.
- The prior execution checked 259 preflight entries plus a separate Bun pin: all 260 before/after entries matched.
- The exact tested Core binary hash is recorded in the summary. No binary is distributed here; locally rebuilding can produce a different binary hash.

**The portable `run.py` in this directory is a subsequent source-only adaptation and has not been used to claim a new successful business run.** Its explicit offline-build entrypoint and path handling differ from the prior local launcher. The recovery assertions are retained, with imports now pointing at this repository's original source. No production source or CI workflow is changed.

## What the prior run established

1. First Core session: `instance.list` → `modpack.install` → `instance.get` → `install.execute` → `install.prepare`. The real execute result was cached=1, downloaded=0, hard_linked=1, transferred=0.
2. A test-owned regular file at `.minecraft/.jmcl/runtime` made real prepare return `PREPARE_FAILED`. The controller reached error, resumable=true, busy=false, with its mutation lease released.
3. The receipt, exact 40-byte inert artifact, readonly CAS hardlink and override remained intact. The artifact is text, not executable Java or a real game JAR.
4. Removing only the owned blocker and rerunning the same controller opened a fresh Core session and called only `instance.get` → `install.prepare`, reaching success.
5. A third Core session read installed=true from disk. Totals: archive=1, execute=1, prepare=2, instance.get=3. All three sessions exited zero. Real cached/progress events reached controller state.

Private pure fixtures also checked byte-for-byte relay output, nonzero exit, signal propagation, output drain, and a 60-second timeout. A fstat probe verified child FD 0/1/2 are actual FIFOs. Each supervisor reached ECHILD and no owned process group remained.

## Isolation and failure behavior

Only Core and its descendants run under the fixed Linux x86_64 seccomp guard from the pinned Core checkout. Bun, the Python byte relay, and the build tools are **not** kernel-network-confined. Their trusted execution path is limited to local compilation, files and owned IPC; this is not hostile-code or filesystem confinement.

The guard is not copied or changed here. Its SHA-256 is `2790712aaf757536329cc1ac87c73931f04bf1a1f6dc3f375f782db08423e719`. The spawn fixture SHA-256 is `77b2f1569434d5e0a7779e32f8dd6a66a7badddf9040dfccb9a5436679273767`. Bun's pipe API can create sockets, so the reviewed Python relay creates fresh subprocess pipes before the guard. The guard still independently rejects socket stdio.

The seed contains only a no-loader mrpack, a fresh local metadata cache, an inert SHA-1 CAS object, and an owned override. No real provider/account, asset download, Java probe or game is used. Cache misses must fail; the runner never fetches dependencies or sources and never falls back to an unguarded Core.

The supervisor owns a new process group, uses a subreaper, and has a 90-second per-stage limit. An outer timeout is explicitly recorded as unknown cleanup and prevents later stages. Any failure stops the sequence. Core signals/nonzero exits are not converted to success. Output must drain before session closure; an early nonzero exit does not claim complete stdin delivery. Logs identify relay PIDs, not directly observed Core PIDs.

## Reproduction prerequisites

Provide the pinned Core checkout and this frontend checkout, the already installed frontend dependencies matching `source-lock.json`, and a populated local Cargo cache. Obtain/install these separately through your normal trusted development workflow. This runner performs no clone, package installation or dependency download.

Use Linux x86_64 and Python 3. Supply **real toolchain executables**, not rustup proxy executables that require a separate home/configuration. The matching versions above are recommended. The runner verifies all locked frontend/Core blobs, the fixed Core HEAD, guard/fixture hashes and installed Tauri runtime bytes before compilation. It records actual tool/source hashes and the newly built binary hashes.

Run explicitly, substituting your own paths:

```sh
python3 tests/experiments/modpack-stage-recovery/run.py \
  --build-core \
  --core-checkout /path/to/pinned/JMCLCore \
  --cargo /path/to/toolchain/bin/cargo \
  --rustc /path/to/toolchain/bin/rustc \
  --bun /path/to/bun \
  --cargo-home /path/to/populated/cargo-cache \
  --output-directory /path/to/existing/private-output
```

`--build-core` explicitly opts into `cargo build --offline --locked` in a fresh output directory; it is not an implicit build or an assertion about a caller-supplied binary. Source and tool hashes must remain unchanged through execution. The helper is compiled using the supplied Rust compiler. All generated target files, fixtures and logs are under a newly created child of the supplied output directory; existing evidence is not overwritten.

The remaining sequence is pure relay fixtures → relay fstat → full fixed-guard selftest → compiled spawn success/missing controls → seed → recovery. No CI job, remote upload, external service or repository write is part of the runner. A PASS file is written only after the assertions, child cleanup and final hash checks succeed. Compilation or any stage exceeding the local limit stops; there is no automatic retry.
