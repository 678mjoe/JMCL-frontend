# Stage 2E platform handoff

**Date:** 2026-09-30

**Last evidence update:** 2026-10-16

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
- This local-only probe did not attempt a real SSH host connection. Subsequent trusted-host transport evidence is recorded below; negative host-key/auth cases and agent-specific behavior remain pending.

## macOS to Pi transport evidence (2026-10-15)

- The user authorized the current Pi as a transport-only target and ruled out running a full Minecraft server on it. The request allowlist was `core.version`, `ping`, and `server.list` against a dedicated empty directory. No server create/install/start, Java process, Minecraft command, or other lifecycle operation was requested.
- The Mac's saved host key matched the Pi's public host key. The existing LAN route timed out, while the existing Access-backed alias succeeded with `BatchMode=yes` and `StrictHostKeyChecking=yes`; no new host trust was accepted. The saved host entry was unchanged after the test.
- The noninteractive Pi shell initially could not find `jmcl-core`. With explicit user permission, a marked temporary PATH block and a user-level core symlink were used for this batch only. The exact fixed remote command `exec jmcl-core rpc` returned protocol v1 / core `0.1.0-dev`, `{"pong":true}`, and an empty `server.list`, with SSH exit 0 and no stderr.
- A temporary endpoint was added through the native JMCL dialog; its stored type, destination, and empty-directory path were read back. Native Test Connection reported success with core `0.1.0-dev`. The real server page selected this endpoint and displayed the empty-list state without a transport/list error or visible clipping. A live process-path read confirmed the GUI used `/usr/bin/ssh` and its existing Access proxy, not a mock transport.
- Switching back to Local restored the local page state and removed the recorded SSH/proxy and Pi RPC PIDs. After selecting the remote endpoint again and quitting the app, independent reads confirmed that the recorded app, local core, SSH, Access proxy, and Pi RPC PIDs had all exited. The empty directory remained empty throughout.
- Cleanup was verified: the temporary endpoint was deleted through its named confirmation dialog, its cache scope was absent, selection fell back to Local, and the native endpoint config returned to its original absence. The app and CuaDriver lifecycle session were closed. The Pi PATH block and symlink were removed; `.bashrc` matched its original SHA-256 byte-for-byte. The empty directory, rollback backup/manifest, and this batch's screenshots were removed. The CuaDriver daemon was left available.
- At this successful-transport checkpoint, key-file versus agent/Keychain behavior, negative host-key/auth cases, disconnect/reconnect, and Windows acceptance had not been isolated. Subsequent negative-case evidence is recorded below. This is transport and empty-list evidence, not Minecraft lifecycle proof.

## macOS negative SSH probes (2026-10-16)

- Three narrowly scoped temporary aliases used isolated known_hosts files: an empty file for unknown trust, a deliberately different existing public key for changed trust, and a trusted-key file with both identity files and the agent disabled for unavailable authentication. Connection sharing was disabled so an existing SSH session could not bypass each check. The real known_hosts file and existing aliases were not modified.
- With the production fixed remote command and strict/batch SSH flags, the Mac CLI refused every case with exit 255 and the expected diagnostic. These failures occur before RPC establishment; Pi's temporary core/PATH setup remained absent, and no Minecraft/Java lifecycle action was requested.

| Case | CLI result | Native Test Connection AX readback |
|---|---|---|
| Unknown host key | Explicit unknown-key refusal | First attempt: generic connection-test failure. One controlled repeat with unchanged SSH configuration: dedicated unknown-key guidance. The first result's cause was not established. |
| Changed host key | Explicit changed-key refusal | Dedicated changed-key/refused message observed. |
| No usable noninteractive credential | Permission denied, no prompt | Dedicated SSH-authentication-required guidance observed. This does not prove locked-key, password-only, or agent/Keychain-specific behavior. |

- Native tests persisted and read back one temporary endpoint at a time, then deleted it through its named confirmation. The dedicated AX messages were observed in the real Tauri app, not the Mock. However, background captures still showed retained edit/delete dialogs while AX/configuration state had advanced. Therefore this batch does **not** establish visual correctness of the final messages/dialog transitions; a foreground or independent human check is still needed. No cause was assigned to the capture/rendering discrepancy, and no speculative production fix was made.
- A user-approved foreground follow-up on the same date was **BLOCKED**, not a visual pass: exact-window activation was only partially accepted, and independent console flags reported `IOConsoleLocked=true` / `CGSSessionScreenIsLocked=true`. No GUI input or unlock was attempted. Fresh Mac-to-target SSH probes also timed out/closed before host-key checking; their cause was not established. The newly launched test app/owned core children exited, the temporary SSH configuration was rolled back with original hash/mode and unchanged trust verified, and the test lifecycle session ended; no endpoint configuration was changed.
- Cleanup was verified after app exit: all temporary endpoints and cache scopes were absent, the endpoint-config file returned to its original absence, the SSH config matched its original SHA-256 and permissions, and the real known_hosts hash was unchanged. The isolated configuration, public-key test files, backups, helper, screenshots, and CuaDriver lifecycle session were removed/ended. The user's VS Code setup was not changed.

## Foreground visual follow-up (2026-10-16)

- With explicit user permission and an unlocked desktop, the exact newly built app process/window was independently confirmed focused and frontmost. The check paused when the screen session locked again and resumed only after the user restored the desktop; no unlock or security-setting changes were attempted.
- A separate reserved-invalid-DNS endpoint exercised local UI and the real generic connection-failure path without depending on the unavailable trusted-host route. Its saved ID/type/destination were read back from native configuration. Screenshots independently confirmed that the add dialog closed, the endpoint and generic failure message were visible without an overlay, and the displayed result matched AX readback.
- Deletion used the confirmation naming that endpoint. The following screenshot showed only Local, an endpoint-deleted notice, and no retained edit/delete dialog or overlay; a separate configuration read confirmed the temporary ID was absent. This establishes the tested **foreground add/delete transitions and generic failure presentation**, not visual acceptance of dedicated unknown-key, changed-key, or authentication messages, nor the cause of the earlier background-capture discrepancy.
- Fresh trusted-target baselines were still unavailable: the Access proxy reported a TCP connection reset before SSH handshake/key checking, and the existing LAN route timed out. No new trust was accepted, no network configuration was changed, and no missing core entry was recreated. These current diagnostics do not establish the cause of the earlier intermittent generic unknown-key result.
- After returning to Instances and quitting, independent reads confirmed the app and both recorded local core children exited. Native endpoint configuration returned to its original absence, the temporary cache scope was absent, SSH configuration/trust hashes were unchanged, screenshots/backups were removed, and the GUI lifecycle ended. The original Hermes window was explicitly restored and independently read back as active. No Minecraft/Java lifecycle action ran on Pi.

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

For each platform, record OS version and architecture, local core version if used, OpenSSH version, tester, date, run type (`tauri dev` or packaged), and evidence location. Mark each item `PASS`, `PARTIAL`, `FAIL`, or `BLOCKED`, with a short note and evidence reference. Unverified entries remain **PENDING**.

### macOS

Record: macOS 26.5; arm64; core 0.1.0-dev / protocol v1; OpenSSH 10.2p1; automated CLI/build check on 2026-09-30, CuaDriver-scoped local GUI plus trusted-Pi transport checks on 2026-10-15, and refusal/foreground-visual follow-ups on 2026-10-16; run type: ad-hoc packaged build.

| Check | Result | Notes / evidence |
|---|---|---|
| Native Tauri app builds with the matching platform core/sidecar | PASS (local ad-hoc build only) | `.app` and `.dmg` created; embedded ARM64 core; strict bundle signature verification passed. Not notarized. |
| Native Tauri app launches and exits | PASS | Exact build executable/window verified; app exited in both local and remote-selected probes. |
| Foreground add/delete dialogs close and agree with native persistence | PASS | Independent screenshots and stored-ID readbacks; after deletion only Local remained, with no old dialog/overlay. |
| Generic connection-failure result is visible and agrees with AX | PASS | Real reserved-invalid-DNS connection attempt; foreground screenshot showed the fixed generic failure and no modal overlay. |
| Dedicated host-key/auth failure messages are visually verified | PENDING | Prior real CLI/native AX evidence remains valid within its scope; trusted-host network baselines currently fail before key checking. The generic visual check does not substitute for these cases. |
| App resolves system `ssh` and inherited SSH configuration | PASS | Live `/usr/bin/ssh` and existing Access proxy process paths verified during native GUI transport. |
| SSH agent / Keychain-specific environment behavior | PENDING | Existing noninteractive authentication worked, but the credential source was not isolated. |
| Disposable unknown-host-key attempt is refused; no automatic trust is added | PARTIAL | CLI refused; native AX showed correct guidance on controlled repeat, but first attempt was generic and its cause is unconfirmed. Final-message visual check pending; real trust remained unchanged. |
| Disposable changed-host-key attempt is refused | PASS (transport + AX scope) | CLI refusal and dedicated native AX message observed. Final-message visual check remains pending. |
| Key or agent authentication succeeds against the trusted test host | PASS (existing noninteractive configuration) | Native Test Connection and empty-list RPC succeeded without an application credential prompt; key-file versus agent not isolated. |
| No usable noninteractive credential fails with safe guidance | PASS (transport + AX scope) | CLI denied authentication and native AX requested SSH authentication; no prompt. Final-message visual check pending. |
| Interactive password/passphrase authentication fails promptly; no askpass prompt or hang | PENDING | Unavailable-key/agent case tested, but password-only and locked-passphrase cases were not isolated. |
| Remote `core.version`, `ping`, and `server.list` succeed | PASS (empty-directory scope) | Exact fixed command, native connection test, and server page verified over real SSH. No Minecraft server ran. |
| Switching back to Local returns to local server state | PASS | Local selection and its expected platform-limited state returned; former remote PIDs exited. |
| Exiting the app cleans up its SSH child process | PASS | Recorded SSH/proxy and Pi RPC PIDs were absent after app exit with the remote endpoint selected. |

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

The current Pi must not host a full Minecraft server instance. Even after the remaining Stage 2 gates pass, real Stage 3 lifecycle testing requires a separately selected, adequately resourced Linux host; that host is currently undecided.
