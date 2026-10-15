# Stage 2E platform handoff

**Date:** 2026-09-30

**Last evidence update:** 2026-10-15

**Status:** Partial verification; macOS and Windows desktop acceptance remains **PENDING**. Stage 2 is not marked complete, and the Stage 3 gate is not open.

## Evidence recorded on Raspberry Pi

- `bun run test`: 212 passed, 0 failed; `bun run build`: passed; `bun run sidecar:prepare`: staged the aarch64 sidecar.
- `cargo test --lib`: 24/24 passed; `cargo test --test ssh_transport`: 19/19 passed; `cargo fmt --all -- --check`: passed.
- `cargo test --test rpc_smoke`: 6 passed, 1 failed (`java_detect_returns_object`: `JAVA_NOT_FOUND`, no Java executable candidates). With `-- --skip java_detect_returns_object`: 6 passed, 1 filtered.
- Direct local core check: protocol v1, version `0.1.0-dev`, `ping` returned `{"pong":true}`, and `server.list` against a temporary empty directory returned `{"stage":"server.list","servers":[]}` with exit 0. This exercised the local core only, not SSH.
- Prior Vite mock acceptance covered the browser mock. A Camoufox narrow screenshot was a crop while CSS `innerWidth` remained desktop-sized; it does not establish a true mobile CSS viewport result.
- No credentials were entered or saved during these checks. No real host details belong in this repository.

These results support the Pi-side TypeScript, Rust, fake-SSH, and local-core checks only. They do not verify a native desktop GUI, the operating system's SSH executable/agent integration, real host-key behavior, or native child-process cleanup. After the Unix test-only fix in `5170d68`, Pi Rust library tests still passed 24/24 and fake-SSH tests passed 20/20.

## Additional macOS build and CLI evidence

- macOS 26.5 on Apple Silicon (arm64); Bun 1.3.14, Rust 1.97.1, system OpenSSH 10.2p1. The frontend repository was fast-forwarded to `5170d68` after the build; the built production code came from `bbba36f` (the intervening commit modified only fake-SSH tests).
- `bun run test`: 212 passed, 0 failed; `bun run build`: passed. Rust library tests: 24/24 passed. The initial macOS fake-SSH suite run had 18 passes and one scheduling-race failure before the test-only fix. With the fix, the suite passed 20/20 in three consecutive runs; Rust formatting check passed.
- The local ARM64 core returned protocol v1 and `pong:true`. Its local `server.list` returned `UNSUPPORTED_PLATFORM`, as expected because real server management is Linux-only; this does **not** exercise a remote Linux core.
- `bun run sidecar:prepare` staged the ARM64 macOS core. A plain `bun run tauri build` produced `.app` and `.dmg`, but the resulting linker ad-hoc signature failed strict bundle verification. Rebuilding with temporary `APPLE_SIGNING_IDENTITY=-` produced both artifacts with an embedded ARM64 core; `codesign --verify --deep --strict` then passed. This is an ad-hoc local test build, **not** notarized or validated for public distribution.
- At the CLI-only checkpoint, no GUI window was launched or inspected and no real SSH host was contacted. Subsequent local GUI evidence is recorded below; every real SSH/host-key/agent item remains pending.

## macOS local GUI evidence (2026-10-15)

- CuaDriver.app 0.28.0 reported Accessibility and Screen Recording granted, with AX available. The ad-hoc-signed build was opened in the background by its absolute build path, and the running executable path was checked to exclude the older installed copy.
- The native WebView loaded with the local core connected. Background AX navigation to Settings and the add-SSH-endpoint dialog worked and was read back after each action. At an 800-by-600 window, the dialog screenshot showed all three labels, help text, and Cancel/Confirm buttons without visible clipping or overflow. This does not establish every theme/language or mobile breakpoint.
- Submitting the empty form left the dialog open. After cancellation, Settings showed a generic endpoint-invalid/save-failed message; field-specific error guidance was not established by this check. The endpoint config file remained absent (local-only default), confirming no SSH endpoint was persisted. No credentials or real destination were entered.
- The app returned to Instances, then received a background Cmd+Q request. The driver reported an unverifiable delivery result; independent process and app-state reads subsequently confirmed that the exact app PID and both local core child PIDs were gone, no JMCL window remained, and no new JMCL crash report was present. This is local app/core exit evidence, not real SSH-child cleanup evidence.
- Remaining UX findings: the native macOS Local server page displays the raw `UNSUPPORTED_PLATFORM` diagnostic instead of a friendly Linux-only/SSH setup explanation; the empty-endpoint-form error experience needs a focused follow-up. Neither issue was changed in this verification-only batch.
- No real SSH host connection was attempted. Trusted-host RPC, strict host-key refusal, agent/authentication, endpoint switching under SSH, and SSH-child cleanup are still pending.

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

For each platform, record OS version and architecture, local core version if used, OpenSSH version, tester, date, run type (`tauri dev` or packaged), and evidence location. Mark each item `PASS`, `FAIL`, or `BLOCKED`, with a short note and evidence reference. Unverified entries remain **PENDING**.

### macOS

Record: macOS 26.5; arm64; local core 0.1.0-dev / protocol v1; OpenSSH 10.2p1; automated CLI/build check on 2026-09-30 and CuaDriver-scoped local GUI check on 2026-10-15; run type: ad-hoc packaged build, local-only GUI probe.

| Check | Result | Notes / evidence |
|---|---|---|
| Native Tauri app builds with the matching platform core/sidecar | PASS (local ad-hoc build only) | `.app` and `.dmg` created; embedded ARM64 core; strict bundle signature verification passed. Not notarized. |
| Native Tauri app launches and exits | PASS (local mode only) | Exact build executable and native window verified; after quit request, the app and both local core PIDs were absent. No new JMCL crash report. No real SSH cleanup proof. |
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

Keep every unverified macOS and Windows item pending until there is actual evidence. The macOS ad-hoc build alone does not finish Stage 2 or open Stage 3. Do not begin the Stage 3 real server lifecycle acceptance on the strength of Pi fake-SSH/local-core results or a desktop build without native GUI/transport verification.
