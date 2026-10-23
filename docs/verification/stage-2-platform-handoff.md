# Stage 2E platform handoff

> Historical evidence: the Pi/personal-macOS setup and tools below describe the original runs, not the current development environment. Use [Devin Cloud development](../development.md) for setup. Preserve these results as historical evidence; new Cloud runs must record their own platform, revisions, and outcomes. Existing acceptance gates remain unchanged.

**Date:** 2026-09-30

**Last evidence update:** 2026-10-21

**Status:** Partial verification; macOS and Windows desktop acceptance remains **PENDING**. Stage 2 is not marked complete, and the Stage 3 gate is not open.

## Devin Cloud closeout evidence

The following is new Cloud evidence, separate from the historical Pi/personal-macOS runs below. The existing acceptance gates are unchanged. Evidence and build logs are available in the [Cloud session](https://app.devin.ai/sessions/0932d3724a184bc4b93ccdb0c3dac3ea).

### Linux automated regression, 2026-10-21

- Frontend: base `824422e29fdabd1cf7d2a55bd017c21082b868b8`, with the SSH UTF-8 fix and regression tests in `4b1d3d368859ebc03a0bd5869442dd3d18cbc72c`.
- Core: `97b65186d7882c415220969d8dcd264b6c3353bd`, built with Zig 0.16.0 / `ReleaseSafe`; matching Linux sidecar staged.
- Platform: Ubuntu 22.04.5 LTS, x86_64; Bun 1.4.3; Rust 1.97.1; OpenJDK 17.0.19.
- Reproduced before the fix: both new fake-SSH tests failed because invalid UTF-8 inside a JSON string was silently replaced with U+FFFD. A corrupted identity could establish a session and a corrupted RPC result could be returned as successful data.
- After the fix: invalid UTF-8 uses the existing redacted `SSH_PROTOCOL_ERROR` path, aborts the session and reaps the fake SSH child. Reader tests preserve valid Chinese, emoji and literal U+FFFD across one-byte reads, CRLF and consecutive frames.

| Command | Result |
| --- | --- |
| `bun run test` | PASS: 212 tests, 0 failures, 29 files; frontend unchanged by the Rust fix |
| `bun run build` | PASS: TypeScript and Vite production build |
| `cargo test --manifest-path src-tauri/Cargo.toml --lib --test ssh_transport --test rpc_smoke` | PASS: 28 library, 22 fake-SSH and 7 real local-core RPC tests; no skips |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | PASS |
| `cargo check --manifest-path src-tauri/Cargo.toml` | PASS |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets` | PASS with existing redundant-guard, while-let-loop and test-module-order warnings; not a warnings-as-errors result |
| `sh -n src-tauri/tests/fixtures/fake-ssh` and `git diff --check` | PASS |

React `act(...)` and Vite chunk-size warnings remain non-blocking. Fake-SSH process tests are Unix-only; their Linux pass is not Windows process evidence. No native GUI, real SSH target, authentication/trust configuration, account login or Minecraft workload was used in this regression run.

### Authorized native attempts and isolated SSH lab, 2026-10-21

The user approved Cloud native GUI recordings and an isolated Linux SSH target, using temporary keys and separate SSH configuration/trust files. The scope remains read-only `core.version`, `ping`, dedicated empty-directory `server.list`, connection/refusal errors, endpoint switching and child cleanup; no real user hosts/accounts or Minecraft workloads.

- The [macOS Cloud attempt](https://app.devin.ai/sessions/aa19fe64d45b459694c2756794387fcc) and [Windows Cloud attempt](https://app.devin.ai/sessions/64681a391c8a41ef93ad309e996398e7) targeted frontend `61be61bdf41e2701f89b7d096085b5f85c9b8dff` and core `97b6518`. Both suspended with `chatgpt_subscription_limit_reached` before delivering a completed acceptance recording/report. They are not running or passing acceptance gates; resume only after the usage limit is resolved.
- Windows completed a native release build and reached a real local-core UI. The testing agent observed visible console windows from local core children obscuring the app. This is a startup defect, not a successful GUI/exit acceptance result. The fix in `8b613157b6a45c54fd7f2f0bbc4c44c148f9dd57` applies Windows `CREATE_NO_WINDOW` to both local-core and SSH transport children, retaining piped stdin/stdout/stderr. Its Windows build and native GUI recheck remain **PENDING**.
- A Windows-only local-transport regression uses a no-profile, noninteractive PowerShell console probe: `GetConsoleWindow()` must return zero, and a line must round-trip through the existing pipes. It is excluded on Linux and has **not run on Windows yet**. The Linux rerun at `8b61315` passes 212 frontend tests, TypeScript/Vite build, the existing 28 library, 22 fake-SSH and 7 local-core tests, Rust fmt/check and Clippy (existing warnings); it does not verify console suppression.
- On Ubuntu 22.04.5 x86_64, system OpenSSH connected over loopback to a separate temporary `sshd` and pinned Linux core. Sequential protocol-v1 `core.version`, `ping` and empty-directory `server.list` passed, with core child cleanup after disconnect. Independent trust files correctly refused unknown/changed host keys; unauthorized and locked private keys failed noninteractively. A forced-command guard rejected arbitrary remote shell commands, methods outside the three allowed RPCs, and other list directories. No user SSH configuration/trust files were used.
- The daemon was configured for loopback only and stopped after the probes; no logged test-core children remain. Cross-VM access from macOS/Windows has **not been established**. The Linux probe is real local OpenSSH evidence, not desktop-to-Linux GUI acceptance. No public listener, third-party relay or new account/API credential was configured.

### SSH diagnostic-reader cleanup regression, 2026-10-21

- Frontend base: `6ec5d2f7e5f5c7a658bb773b3d0e1d3fe69f05c5`; core remains pinned to `97b6518`.
- Three new Unix fake-SSH tests reproduced an unbounded wait in failure classification, normal close and abort: the SSH child had exited, but a separate process still held its inherited stderr pipe open. All three tests timed out before the fix.
- Cleanup now permits a bounded 100 ms diagnostic drain, then aborts and joins the stderr reader rather than waiting indefinitely for EOF. Dropping a transport also aborts its owned stdout/stderr readers. The SSH argument list, host-key policy, remote command and billing settings are unchanged.
- All three tests pass after the fix, checking the typed authentication failure where applicable, the reaped SSH child, cleared diagnostic tail and a still-running pipe holder. The fixture separately cleans up its own holder; the production transport does not kill unrelated processes to close inherited pipes.
- Linux regression: 28 library, 25 fake-SSH and 7 real local-core tests pass (60 total), together with 212 frontend tests, TypeScript/Vite build, Rust fmt/check, Clippy (existing warnings), shell syntax and diff whitespace checks. These are automated Linux results, not macOS/Windows GUI or cross-VM SSH acceptance.
- The existing native sessions were instructed to stop old-version GUI work before a new revision is tested. Both produced normal replies, then suspended again with the platform-reported `chatgpt_subscription_limit_reached`; that classification does not independently establish the user's remaining allowance. The Windows console-regression invocation completed with **0 tests run** (7 filtered out), so it is not a pass; the checked-out revision and test discovery need verification before a retry. No native gate is promoted by this fix.

### Platform status matrix

The 2026-10-20 Cloud toolchain runs used frontend `824422e` and pinned core `97b6518`, before the UTF-8 fix. macOS arm64 and Windows x64 each passed 212 frontend tests, the frontend build, Rust formatting/checking and `bun run tauri build --no-bundle`. Windows subsequently compiled `61be61b`, including the UTF-8 fix, during the attempt above. These are compile/build results, not completed GUI or SSH acceptance. The console-window fix has not been built or run on Windows yet.

| Layer | Linux Cloud | macOS Cloud | Windows Cloud |
| --- | --- | --- | --- |
| SSH implementation | Present; UTF-8 response validation fixed | Same implementation; runtime revalidation pending | Same implementation; runtime revalidation pending |
| Automated frontend / Rust checks | PASS as recorded above | PASS on pre-fix `824422e`; Rust tests not rerun | PASS on pre-fix `824422e`; Rust tests not run |
| Native release compilation | Not run in this closeout | PASS, pre-fix no-bundle build | PASS at `61be61b`; console-window fix not built here |
| Native GUI / sidecar runtime | Not run | BLOCKED by usage limit; no completed new Cloud acceptance | Startup console defect observed; full acceptance/exit check BLOCKED by usage limit |
| System SSH, authentication source, refusal messages, endpoint switching and exit cleanup | Loopback OpenSSH/core and refusal/guard probes PASS; cross-VM pending | PENDING new Cloud acceptance; historical partial results below | PENDING |
| Real Minecraft server lifecycle | Not run; Stage 3, not a Stage 2 acceptance item | Not run | Not run |

Stage 2's remaining work is native macOS/Windows GUI and system-SSH acceptance against the approved isolated Linux test target: successful `core.version`, `ping` and empty-directory `server.list`, safe error/refusal behavior, endpoint isolation/local switching and child cleanup. Authorization is recorded above; usage limits and cross-VM connectivity currently block completion. Do not substitute command-line builds, loopback-only probes or fake SSH for these checks, and do not add Minecraft lifecycle work to Stage 2.

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
| Native Tauri app builds with the matching platform core/sidecar | PASS (Cloud no-bundle compile only, pre-fix) | 2026-10-20: frontend `824422e`, core `97b6518`, Windows Server 2022 Standard 10.0.20348 x64; authoring run `run-0dd9b5b531bd` succeeded. Not an installer, UI or post-fix build result. |
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

### Owner-authorized development exception — 2026-10-23

The owner explicitly authorized later-stage development and executable automated
tests while environment-blocked native, visual and real-scenario acceptance
remains pending. This supersedes the historical restriction on **starting later
stage development only**; it does not change acceptance criteria, promote any
unverified result, or mark Stage 2 or Stage 3 accepted. Historical gates and
evidence below remain the acceptance record. Real accounts, SSH/server targets,
Minecraft workloads, security changes, spending and formal releases still need
separate authorization.


Keep every unverified macOS and Windows item pending until there is actual evidence. The macOS ad-hoc build alone does not finish Stage 2 or open Stage 3. Do not begin the Stage 3 real server lifecycle acceptance on the strength of Pi fake-SSH/local-core results or a desktop build without native GUI/transport verification.

Even after the remaining Stage 2 gates pass, real Stage 3 lifecycle testing requires a separately approved, adequately resourced Linux environment. The historical Pi restrictions above do not describe Cloud VM resources; Cloud provisioning alone does not select or approve a lifecycle test target.
