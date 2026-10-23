# Linux handoff verification — 2026-10-23

## Scope and pinned revisions

This is a historical record of the original local cloud verification session,
before the subsequent publication described below. No real Minecraft installation/launch,
SSH host/account access, host-key acceptance, security configuration changes,
GitHub publication, or roadmap/stage-gate changes were authorized or performed.

Live Git refs were checked before checkout:

- JMCLCore main: `97b65186d7882c415220969d8dcd264b6c3353bd`.
- JMCL-frontend main: `6ec5d2f7e5f5c7a658bb773b3d0e1d3fe69f05c5`.
- Frontend PR #4 head: `cd74db122a134b0a9effb3c4f3b58bdf75d15f2f`.

Each was checked out separately/detached. A fourth comparison worktree contains
main production code plus **only** PR #4's test/fixture changes (2 files, 76 added
lines); that comparison is not pristine main.

## Environment

Debian GNU/Linux 13.6, Linux x86_64; Git 2.52.0, Node 24.19.0, Bun 1.4.4,
Rust/Cargo 1.99.1 (`x86_64-unknown-linux-gnu`), Zig 0.16.0.

Toolchains/caches were installed in the writable workspace. Zig's archive SHA256
matched the official download index:
`70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00`.
Bun came from the npm registry and Rust from the official rustup distribution.
Project JavaScript and Rust lockfiles were retained unchanged.

The initial native `cargo check` failed because `glib-2.0.pc` was absent.
Recovery extracted 436 official Debian trixie packages into a workspace sysroot:
InRelease signatures, Packages SHA256 and individual archive SHA256 values were
verified. No global package installation or maintainer scripts ran. The sysroot
provides GTK 3.24.49, WebKitGTK 2.52.6 and GLib 2.84.4. A symbol-linked C
smoke test called GTK/WebKit version functions and verified the actual shared
library closure without initializing a GUI. Session-specific environment
files and package provenance were retained with the workspace logs; they are not
portable machine provisioning instructions.

## Completed checks

| Check | Result |
| --- | --- |
| Core `zig build -Doptimize=ReleaseSafe` | Pass |
| Core `zig build test --summary all` | 312 passed, 1 skipped, 0 failed |
| Local RPC `ping`, `core.version` | Pass; protocol 1, core 0.1.0-dev |
| Sidecar staging in main/PR/comparison worktrees | Pass; native Linux target, matching binary SHA256 |
| Main `bun install --frozen-lockfile`, `bun run test` | Pass; 212 tests, 0 failures |
| PR #4 same frontend checks | Pass; 212 tests, 0 failures |
| Main and PR #4 `bun run build` | Pass (TypeScript + Vite) |
| Main `cargo check --locked --manifest-path src-tauri/Cargo.toml` (workspace sysroot) | Pass |
| Main and PR #4 `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | Pass |

Core's one skip is `server methods reject non-Linux hosts`, explicitly skipped
on Linux; loopback tests were not skipped. Tests were inspected before execution:
Core uses temporary fixtures, fake authentication, shell stand-ins and loopback
services; SSH tests use a fake shell executable, not a real endpoint. Fixture
EULA serialization does not accept a real service agreement.

Core/staged sidecar SHA256:
`0b75cecd0f7749967f8dd1c842e8afae89467450e1871dfc9d0a13e7a58e2cb5`.

Frontend tests emit existing React `act(...)` warnings. Vite emits an advisory
for a minified chunk over 500 kB; builds still pass. No lint script is defined.

## Native Rust verification

Main passed with the workspace native environment:

```sh
cargo check --locked --manifest-path src-tauri/Cargo.toml
cargo test --locked --manifest-path src-tauri/Cargo.toml \
  --lib --test ssh_transport --test rpc_smoke
```

All 57 main Rust tests passed: 28 library, 7 local real-Core RPC fixture tests,
22 fake-SSH transport tests (no ignored tests).

PR #4 passed the same native check and suite: 28 library, 7 RPC, 25 fake-SSH
transport tests (60 total, no ignored tests). This includes the three new
inherited-stderr regressions for failure classification, graceful close and
abort. Each checks an 800 ms upper bound, cleared diagnostics, reaped direct
child and a still-live inherited-stderr holder. The production change bounds
the diagnostic drain to 100 ms before aborting the reader.

Before/after evidence:

- **Main production + only PR regression tests/fixture:** all 3 tests fail at
  their 800 ms bounds (`Elapsed(())`); test batch 0.81 s, Cargo exit 101. This is
  the intentional negative control, not a failure of the original main suite.
- **PR #4:** the same 3 tests pass in 5 additional runs (15/15 passes), each
  three-test batch 0.12 s. Main and comparison production SSH source are
  byte-identical; the PR checkout remains clean.
- Scoped post-test cleanup found no remaining matching fixture PID files or
  matching fake-SSH holder processes.

Reproduce the focused comparison in each appropriate checkout:

```sh
cargo test --locked --manifest-path src-tauri/Cargo.toml \
  --test ssh_transport inherited_stderr -- --nocapture
```

A missing `/usr/bin/time` initially prevented execution of a timing wrapper
(exit 127); shell `time` replaced it, and only the subsequent actual test runs
are counted. The initial broad temporary-directory scan encountered a permission
restriction; cleanup was checked only within the known fixture scope afterward.
No restricted directory was read or permission bypass attempted.

## Boundaries

No browser/manual UI acceptance, full Tauri package build, keychain/credential
store interaction, real system SSH connection, real server/game workload,
macOS or Windows verification was performed. Linux unit/integration checks do
not establish those results. Existing historical records and acceptance gates
remain unchanged.

At the end of that session, raw logs, pinned checkouts, toolchains, sysroot metadata,
the exact regression overlay and session-specific reproduction commands were retained in the separate
`jmcl-handoff` workspace directory. Generated binaries/dependencies remained
untracked. Environment documentation changes were local-only, not committed or
published at that time.

## Subsequent publication context

PR #4 was squash-merged into `main` as
[`3d5cbbdec2dfe333039de624cdf7720d1a38e2ce`](https://github.com/678mjoe/JMCL-frontend/commit/3d5cbbdec2dfe333039de624cdf7720d1a38e2ce)
on 2026-10-23. This documentation patch is based on that merged revision under
separate publication authorization. The results above still refer to the exact
pinned revisions, not a new verification run of the merged commit. The original
ephemeral workspace is no longer available; its retained-path descriptions are
historical, not a promise that those local artifacts can still be accessed.
