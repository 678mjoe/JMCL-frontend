# Guarded release context candidate (Linux only)

Status: this revision has not been compiled or executed. Only source review and pure controls have passed. Everything below describes the acceptance requirements, not a runtime result.

Frozen frontend: `9c0fd81ce8109c1e35229560fee31308ca114ef5`, tree `48ea91981bdb7b375bca8e9bc47738b6c3dde4d1`.
Frozen RustCore: `bdd6cb3e55d69cb9e0e02037d251635e289207a8`, tree `0e8e901bc587cf3c6d7dc1ba78821c4701785e20`.

## Scope

The isolated public standard Ubuntu 24.04 lane builds real frontend dist with Bun 1.4.4 and the frozen lockfile, compiles the fixed Core with `cargo build --offline --locked --release --manifest-path core/rust/Cargo.toml --bin jmcl-core-rust`, and stages it using the original `scripts/prepare-sidecar.sh` with an explicit absolute binary path. Official toolchain / distribution dependencies and locked package preparation occur outside the runtime guard. The frozen Bun lock includes npm mirror URLs, not exclusively official registry URLs; no registry or integrity rewrites are permitted.

A test-only overlay enables `tauri/test`; the actual library test is compiled with Rust 1.99.1, `--release --offline --locked --features tauri-rust-core-contract,tauri/custom-protocol`. Original `tauri.conf.json`, capabilities, build script, production dependency features, sidecar name and Zig pin remain unchanged. No TAURI_CONFIG externalBin exemption is used.

Exactly one ignored test is selected explicitly. It reads generated-context embedded index and verifies referenced non-HTML assets byte-for-byte against this build’s real dist, checks `!tauri::is_dev()` and `!debug_assertions`, obtains the actual Linux window URL (`tauri://localhost`), preserves the `http://tauri.localhost` ACL rejection, and invokes the real `core_open`, `core_request`, `core_close` handlers against two explicitly selected release RustCore subprocesses. Ping, unknown-method recovery, session isolation, idempotent close, and empty SessionPool are asserted.

## Guard and evidence

Fixed launch guard SHA256: `2790712aaf757536329cc1ac87c73931f04bf1a1f6dc3f375f782db08423e719`; spawn-control source: `77b2f1569434d5e0a7779e32f8dd6a66a7badddf9040dfccb9a5436679273767`. The current full selftest and missing/success spawn controls must pass before guarded inventory and execution. Runtime processes use closed inherited descriptors, regular-file stdout/stderr, cleared proxy/JMCL/TAURI/VITE/compiler override environment, owned process groups, subreaping, deadlines and fail-closed cleanup. Any actual guard or environment denial stops execution, never causes an unguarded rerun. Expected SIGSYS cases exist only inside the fixed selftest.

When run, lossless chunked evidence must be emitted even on failure, with a two-minute output step. Acceptance requires exactly 1 passed / 0 failed / 0 ignored. Source/binary/staged hashes, all dist file hashes and sizes, 207 frozen frontend build-input hashes (including bun.lock) before/after preparation and execution, rejected extra .env and Cargo configuration inputs, command lines, stdout/stderr, phase cleanup state, and pre/post comparisons must be retained. Missing evidence or unknown cleanup cannot be reported as success.

## Exclusions

This is not JavaScript execution, a real WebView, Chromium, GUI/visual QA, full production setup/plugin initialization, a package build or package automatic sidecar selection. Explicitly choosing a release RustCore does not prove the shipping package selects it. Cargo test panic/unwind semantics do not prove shipping panic-abort behavior. No Java, accounts, provider/service interaction, production downloads, main changes, existing workflow changes, pin switch, Rust replacement distribution, or release publication is performed. No B deb build is included.

## Source lineage

Production-context lifecycle overlay derives from the reviewed development context candidate; guard ownership and evidence runner derive from the successful guarded Channel candidate. The branch contains only listed public repository baseline files plus generated acceptance fixture/workflow/docs, never private worktree or personal files. Only the dedicated new branch/path lane may trigger; docs-only results must not cause extra CI.
