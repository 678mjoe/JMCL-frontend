# Local diagnostic logging verification — 2026-10-24

## Scope and revisions

Frontend baseline: `d6e4a7532af5b48af6a028e8fbd1cff1962091f4`.
Local executable source checkpoint: `e5867a7` (subsequent changes in this
record/user guide are documentation only). Core remains pinned to
`97b65186d7882c415220969d8dcd264b6c3353bd`; no Core source, RPC contract,
credential storage, session/transport implementation, dependency lockfile or CI
workflow changes are included.

Linux x86_64 cloud workspace, Bun 1.4.4, Rust 1.99.1, Zig 0.16.0. Native checks
used the existing workspace-local Linux development sysroot and an isolated
Cargo target with debug information/incremental compilation disabled. The pinned
Core was freshly built with `zig build -j1 -Doptimize=ReleaseSafe`; its staged
binary SHA-256 is
`d784ab86647cff90b528f8f0c73c87a5792578952af5c7c8969546bae7e9b996`.
An earlier concurrent build was killed by the environment; the sequential build
completed. This is not a change to the Core pin or protocol.

## Local automated checks

- Locked dependency install succeeded.
- `bun run test`: 492 passed across 67 files.
- `bun run build`: TypeScript and Vite passed; existing large-bundle warning remains.
- `python scripts/test-verify-ci-package.py`: 5 passed.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: passed.
- `cargo check --locked --manifest-path src-tauri/Cargo.toml`: passed.
- `cargo test --locked --manifest-path src-tauri/Cargo.toml`: 71 unit tests,
  7 pinned-Core RPC smoke tests and 25 isolated fake-SSH transport tests passed.

Tests use temporary synthetic data, not real accounts, keychains or servers.
Added coverage checks opt-in persistence/restart, bounded rotation, corrupt and
oversized records, closed-enum secret sentinels, validated export serialization,
clear preservation, concurrent queue use, interrupted operation metadata, native
control exclusion and transient-storage recovery. Frontend tests cover filtering,
confirmation/cancel, repeated actions, navigation during pending export, stale
responses, failed reads, safe disable and refresh recovery.

## Boundaries

Local Chromium failed before browser scenarios could run: its process-singleton
socket creation was denied. One supported escalation also failed during sandbox
setup; it was not retried or bypassed. No local screenshot or native WebView/save
dialog acceptance is claimed. The added browser scenario checks the unavailable
browser-preview state; it is not a native filesystem/export test. Refer to the
exact PR/merge commit's GitHub checks for CI browser, native and package results.

Native GUI behavior, real OS save-dialog interaction, real accounts/keychains,
SSH hosts, games, installer execution and upgrade/uninstall acceptance remain
outside this verification. No release or signing operation was performed.

Logging is best-effort, not a complete audit trail or crash-durable journal.
Closed enums and generated numbers enter persistence; raw RPC payloads, arbitrary
errors/stacks and console lines do not. Malformed stored lines are not exported.
These checks do not establish protection against a hostile process concurrently
replacing ancestor directories. Native disk initialization failure requires
repair and app restart; subsequent transient I/O failures can recover by refresh.
