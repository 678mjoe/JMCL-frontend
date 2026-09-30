# Stage 2E platform handoff

**Date:** 2026-09-30

**Status:** Partial verification; macOS and Windows desktop acceptance remains **PENDING**. Stage 2 is not marked complete, and the Stage 3 gate is not open.

## Evidence recorded on Raspberry Pi

- `bun run test`: 212 passed, 0 failed; `bun run build`: passed; `bun run sidecar:prepare`: staged the aarch64 sidecar.
- `cargo test --lib`: 24/24 passed; `cargo test --test ssh_transport`: 19/19 passed; `cargo fmt --all -- --check`: passed.
- `cargo test --test rpc_smoke`: 6 passed, 1 failed (`java_detect_returns_object`: `JAVA_NOT_FOUND`, no Java executable candidates). With `-- --skip java_detect_returns_object`: 6 passed, 1 filtered.
- Direct local core check: protocol v1, version `0.1.0-dev`, `ping` returned `{"pong":true}`, and `server.list` against a temporary empty directory returned `{"stage":"server.list","servers":[]}` with exit 0. This exercised the local core only, not SSH.
- Prior Vite mock acceptance covered the browser mock. A Camoufox narrow screenshot was a crop while CSS `innerWidth` remained desktop-sized; it does not establish a true mobile CSS viewport result.
- No credentials were entered or saved during these checks. No real host details belong in this repository.

These results support the Pi-side TypeScript, Rust, fake-SSH, and local-core checks only. They do not verify a native desktop GUI, the operating system's SSH executable/agent integration, real host-key behavior, or native child-process cleanup.

## Human acceptance procedure

Complete the checklist independently on macOS and Windows. A desktop development run and a packaged sidecar build are separate checks: `bun run tauri dev` uses the development config and core lookup; a package built with the default Tauri config declares `binaries/jmcl-core` as an external sidecar. Packaging therefore needs a compatible local core binary staged first. Do not assume either binary is present.

The relevant scripts defined by this repository are:

```bash
bun run tauri dev
bun run sidecar:prepare
bun run tauri build
bun run tauri:build:sidecar
```

`bun run tauri:build:sidecar` runs `scripts/prepare-sidecar.sh` and then `tauri build --config src-tauri/tauri.sidecar.json`. On Windows, that script requires a Bash-compatible shell plus `uname`, `sed`, `install`, and `rustc` on `PATH`; its target detection recognizes MINGW, MSYS, CYGWIN, and `Windows_NT`. Use the Windows-native Tauri build prerequisites for the app itself. Record whether each acceptance result came from `tauri dev` or the packaged app.

Before any real SSH attempt, the tester must decide to proceed and arrange a preconfigured trusted test host with a compatible `jmcl-core` available through that host's remote `PATH`. Do not invent or assume a working host or core binary. Use a disposable test host/configuration for unknown-key and changed-key refusal checks. Configure trust through the tester's normal OpenSSH workflow; the app must not accept keys. Do not put hostnames, usernames, addresses, fingerprints, credentials, or other secrets in this document or repository.

For each platform, record OS version and architecture, local core version if used, OpenSSH version, tester, date, run type (`tauri dev` or packaged), and evidence location. Mark each item `PASS`, `FAIL`, or `BLOCKED`, with a short note and evidence reference. All entries below begin **PENDING**.

### macOS

Record: OS/version ______; architecture ______; core/version ______; OpenSSH/version ______; tester/date ______; run type ______; evidence ______.

| Check | Result | Notes / evidence |
|---|---|---|
| Native Tauri app builds with the matching platform core/sidecar | PENDING | |
| Native Tauri app launches and exits | PENDING | |
| App resolves system `ssh` from inherited `PATH`; inherited SSH environment and agent are usable | PENDING | |
| Disposable unknown-host-key attempt is refused; no automatic trust is added | PENDING | |
| Disposable changed-host-key attempt is refused | PENDING | |
| Key or agent authentication succeeds against the trusted test host | PENDING | |
| Interactive password/passphrase authentication fails promptly; no askpass prompt or hang | PENDING | |
| Remote `core.version`, `ping`, and `server.list` succeed | PENDING | |
| Switching back to Local returns to local server state | PENDING | |
| Exiting the app cleans up its SSH child process | PENDING | |

### Windows

Record: Windows version/build ______; architecture ______; core/version ______; OpenSSH/version ______; tester/date ______; run type ______; evidence ______.

| Check | Result | Notes / evidence |
|---|---|---|
| Native Tauri app builds with the matching platform core/sidecar | PENDING | |
| Native Tauri app launches and exits | PENDING | |
| App resolves system `ssh.exe` from inherited `PATH`; inherited SSH environment and agent are usable | PENDING | |
| Disposable unknown-host-key attempt is refused; no automatic trust is added | PENDING | |
| Disposable changed-host-key attempt is refused | PENDING | |
| Key or agent authentication succeeds against the trusted test host | PENDING | |
| Interactive password/passphrase authentication fails promptly; no askpass prompt or hang | PENDING | |
| Remote `core.version`, `ping`, and `server.list` succeed | PENDING | |
| Switching back to Local returns to local server state | PENDING | |
| Exiting the app cleans up its SSH child process, including the WebView/app lifetime case | PENDING | |

## Gate

Keep every macOS and Windows item pending until a human records evidence. Do not mark Stage 2 finished or begin the Stage 3 real server lifecycle acceptance on the strength of Pi fake-SSH/local-core results. Stage 3 remains gated on successful target-desktop verification of Stage 2 transport and endpoint isolation.
