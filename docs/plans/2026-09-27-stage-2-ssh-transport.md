# JMCL Frontend Stage 2: system OpenSSH transport

**Goal:** connect the existing Stage 1 server UI to a remote `jmcl-core rpc` process through the user's system OpenSSH client, while keeping the local sidecar session and its client features unchanged.

**Baseline inspected:** `5591d7ed780cda1e0289420438f3c219e5904cd1` (clean worktree at inspection). This plan does not claim SSH implementation or host connectivity has been tested.

## Evidence and design summary

- `src-tauri/src/transport.rs` already defines `LineTransport`; `LocalProcessTransport` owns a child with piped stdin/stdout/stderr. `src-tauri/src/session.rs` implements protocol v1 and serializes requests per session. `src-tauri/src/pool.rs` opens a fresh local process per session and stores `Arc<Session>` by numeric session ID. This is a direct extension point for SSH.
- `Session::request` currently holds the transport mutex for the entire request, and `Session::close` waits for that same mutex. Therefore the current close path cannot abort a hung in-flight request. Stage 2B must add a lock-independent cancellation signal and an abortable transport path before claiming handshake timeout, request cancellation, or prompt child cleanup. The request loop must select between transport events and cancellation; close signals first, then waits for request cleanup. Tests must fail if close waits for a fake transport that never emits another event.
- The native commands today are `core_open(binary_path?)`, `core_request(session_id, method, params, events, compact_events?)`, and `core_close(session_id)` in `src-tauri/src/lib.rs`. `CoreSession.open(binaryPath?)` in `src/lib/rpc.ts` is also the launcher-wide local session factory used by `src/lib/launcher.tsx`. Keep that API and local path intact; add explicit endpoint-session commands and `CoreSession.openEndpoint(...)` so a selected remote server endpoint cannot redirect local instance/account/Java calls.
- `src/lib/servers.tsx` has a one-list startup path, explicit per-server status refresh, and a `sourceRevision`; `src/lib/serverOperations.tsx` opens a dedicated session per operation; `src/lib/serverLogController.ts` owns a separate panel session and a single in-flight log read. Retain these ownership boundaries. A transport error is not evidence about Minecraft process state.
- Stage 1 status cache schema v1 already has `scopes: Record<string, ...>` and currently uses `SERVER_SCOPE = "local"`. `server-status-cache.v1.json` is read/written at a fixed app-data path with validation, a 1 MiB cap, and atomic replacement in `src-tauri/src/server_status_cache.rs`. Preserve the exact `local` key and all its records; use persisted endpoint IDs as keys for new scopes. No cache schema rewrite or server-entry move is required.
- `gui-handoff.md` §1 requires one in-flight request per RPC stream and multiple sessions for concurrency. Its server section says the core is Linux-only, takes a server-root `directory`, and documents the existing `ssh user@host jmcl-core rpc` convention. JMCLCore `rust/src/main.rs` accepts exactly `jmcl-core rpc`; it reads JSON Lines from stdin, writes protocol events only to stdout, and diagnostics to stderr. The RPC request itself is not an SSH command.
- OpenSSH's documented CLI appends multiple remote command arguments separated by spaces, then sends the command to the server; remote command execution therefore invokes the remote user's shell. Build one fixed remote command string, `exec jmcl-core rpc`, and pass it as the single command argument. Do not add endpoint fields to this string. The local process is still spawned directly with argv and no local shell. This fixed command minimizes remote-shell interpretation; it cannot remove the remote login-shell boundary inherent in ordinary SSH command execution. (See [OpenBSD ssh(1)](https://man.openbsd.org/ssh) and the [JMCLCore protocol docs](https://github.com/JMCL-JMCLCore/JMCLCore/blob/main/docs/protocol.md).)
- Use `BatchMode=yes` and `StrictHostKeyChecking=yes`. OpenSSH documents `StrictHostKeyChecking=yes` as refusing both unknown and changed keys without automatically adding them. Keep the user's normal known-hosts files. Unknown/changed keys fail closed and require the user to verify/add the host key through their normal OpenSSH workflow. See [OpenBSD ssh_config(5)](https://man.openbsd.org/ssh_config).

## Fixed v1 contracts

### Endpoint model

Persist a discriminated endpoint record in a new fixed app-data file, `endpoints.v1.json`:

```ts
type EndpointId = string; // persisted lowercase UUID; immutable after creation
type Endpoint =
  | { id: "local"; kind: "local"; label: string }
  | {
      id: EndpointId;
      kind: "ssh";
      label: string;
      destination: string;       // host alias or [user@]host; never a command
      serversDirectory?: string; // remote Linux absolute path, needed by server.*
    };
```

V1 does not persist an SSH executable override or remote core path. Resolve `ssh`/`ssh.exe` from the app's inherited `PATH`; allow the test-only Rust spawn seam to supply a fake executable. Use the core's normal remote `PATH` lookup for `jmcl-core`. Endpoint IDs are created once with `crypto.randomUUID()`, validated again in Rust, and retained through label/destination edits. They are not derived from destination, which can change and is not a reliable identity. The local endpoint is reserved and cannot be removed or edited into an SSH endpoint; its display name is rendered through i18n rather than treating the persisted English fallback label as UI copy. Bound the document to 64 endpoints and 256 KiB serialized size. Accept labels up to 80 Unicode scalar values with no control characters, destinations up to 255 ASCII bytes, and remote directories up to 4096 UTF-8 bytes. Accept only conservative destination tokens (hostname/SSH alias, optional `user@`, or bracketed IPv6 form); reject empty values, leading `-`, whitespace, controls, shell metacharacters, and option-like values. Validate an SSH server directory as a nonempty absolute POSIX path with no NUL/newline; it remains data sent only inside the JSON RPC request.

Server management needs a remote `directory`, while current `settings.serversDir` is a local app-data path. Keep `serversDir` for the local endpoint. An SSH endpoint may be saved before this value is known, but server listing/actions remain disabled with an accessible “configure remote server directory” prompt until its `serversDirectory` is set. Do not silently send the local path to a remote host or guess `/srv/jmcl/servers`.

### Persistence and migration

- Use `endpoints.v1.json` under the Tauri fixed app-data directory, not caller-selected paths. Rust commands read/write a typed, size-limited v1 document via same-directory temp file plus atomic replace, following the existing server cache persistence pattern. Endpoint fields contain only a display label, SSH destination, stable ID, and optional remote directory; never credentials, key paths, passphrases, passwords, or SSH command text. Treat labels/destinations as private connection metadata. Restrict Unix file permissions to the app user's access where practical; rely on app-data's user-scoped ACL on Windows.
- Add `endpoint_config_read`/`endpoint_config_write`; do not serialize endpoint definitions into `src/lib/settings.tsx` localStorage. This keeps validation, atomic writes and one portable app-owned location together. It also means reinstall/profile reset can remove endpoint metadata; there is no credential or secret recovery story to preserve. Persist only `selectedServerEndpointId` as an ordinary UI preference in settings/localStorage, defaulting to `local`; after config load, an absent, invalid, or deleted ID falls back to `local`. Deleting the selected endpoint switches selection to `local` before removing its cache/session state.
- On a missing file, return the canonical config containing only `{id:"local", kind:"local", label:"Local"}`. Do not move or rewrite `settings.serversDir`. Existing installations gain the local endpoint without an interactive migration. Write the default lazily on the first edit.
- Keep `ServerStatusCacheV1` unchanged. Its current `scopes.local` is already the exact Stage 1 local namespace: retain it byte-for-byte until a normal cache update, and keep all server entries. New endpoints get independent keys `scopes[endpoint.id]`; scope `directory` remains the local or remote server root. Endpoint deletion removes only its cache scope after confirmation; local cache cannot be deleted from endpoint settings. Tests must prove legacy local data survives config initialization, remote add/edit/delete, and cache reconciliation.

### SSH argv and child process

Spawn `Command::new(resolved_ssh_executable).args(argv)`; never `sh -c`, command-string concatenation, or shell interpolation. For destination `pi-mc`, expected argv is exactly:

```text
-T
-o BatchMode=yes
-o StrictHostKeyChecking=yes
-o ConnectTimeout=10
-o ServerAliveInterval=15
-o ServerAliveCountMax=3
pi-mc
exec jmcl-core rpc
```

Represent the above as discrete argv tokens (`-o`, `BatchMode=yes`, etc.); the final remote command is one constant argv element, exactly `exec jmcl-core rpc`. Do not include `-n`: stdin is the RPC request stream. `-T` disables PTY allocation so JSONL stays byte/line oriented. Keep `~/.ssh/config`, agent environment, platform key providers, ProxyJump and ControlMaster available by inheriting the normal process environment and leaving user SSH config in force, except the explicit security/timeout options above. Do not add `-A` agent forwarding. In particular, never pass `StrictHostKeyChecking=no`, `UserKnownHostsFile=/dev/null`, `accept-new`, or any host-key bypass. `BatchMode=yes` makes password, key-passphrase, and host-key questions noninteractive; unsupported interactive auth must return a typed error promptly.

Pipe SSH child's stdin/stdout/stderr. stdin carries the existing protocol request lines unchanged. stdout reader emits only complete JSONL candidate lines; stderr reader drains concurrently into a bounded diagnostic tail (32 KiB maximum) to prevent pipe backpressure. Never forward raw stderr, argv, environment, destination, credentials, or key paths to UI logs. Classify diagnostics in memory into stable error codes and safe localized messages, then discard the raw buffer when the session closes. Environment inheritance is required for `PATH`, `HOME`/`USERPROFILE`, `SSH_AUTH_SOCK`, and native agent integrations; never log it.

Use `kill_on_drop(true)`/best-effort child kill and await the child on normal close. Closing stdin is a graceful half-close; a dropped/cancelled operation or app shutdown kills its SSH child. Bound initial spawn + `core.version` handshake to 15 seconds; `ConnectTimeout=10` bounds network setup, and the handshake deadline also bounds remote startup/banner stalls. ServerAlive at 15 seconds with count 3 bounds a silent dead connection at roughly 45 seconds after activity stops. Protocol v1 has no wire cancellation, so implement local cancellation outside the transport mutex: `Session::close` marks closed and notifies the active request; the request-side `select!` invokes an abort-capable transport close/kill, returns a typed cancellation/session error, and releases the mutex; close then completes cleanup. This must also preserve current local-session behavior and never kill or block sibling sessions.

### Errors and host-key behavior

Expose a typed endpoint/session error union across Rust/TS, separate from `RpcError` and server lifecycle errors. Minimum codes: `SSH_EXECUTABLE_NOT_FOUND`, `SSH_TIMEOUT`, `SSH_HOST_KEY_UNKNOWN`, `SSH_HOST_KEY_CHANGED`, `SSH_AUTH_REQUIRED_OR_FAILED`, `SSH_INTERACTIVE_AUTH_UNSUPPORTED`, `SSH_REMOTE_COMMAND_FAILED`, `SSH_PROTOCOL_ERROR`, `SSH_DISCONNECTED`, `ENDPOINT_CONFIG_INVALID`, and existing `UNSUPPORTED_PROTOCOL`. Messages say which action is needed but omit raw stderr and full destination. Match known OpenSSH diagnostic fragments conservatively; unrecognized/locale-dependent stderr maps to a generic safe `SSH_CONNECTION_FAILED`, never to a server state.

`StrictHostKeyChecking=yes` intentionally rejects an unknown key as well as a changed key. If OpenSSH exposes an unambiguous diagnostic, show distinct “host key not present; verify it and add it to known_hosts with OpenSSH” and “host key changed; inspect known_hosts before proceeding” guidance. Otherwise show the generic verification failure. Never accept a key from the app. Do not emit a fingerprint as trusted unless a separate supported API can obtain and verify it; v1 does not implement one. `BatchMode=yes` means password/passphrase prompts are unsupported: show that a configured key/agent or an already-unlocked platform agent is needed, with no retry loop.

Handshake is the existing `core.version` request; require a valid result and `protocol == 1` before inserting the session in the pool. A malformed/non-JSON stdout line, unexpected EOF, timeout, child exit, or invalid identity is a transport/session error. Preserve `UNSUPPORTED_PROTOCOL` as its own incompatibility result. Later EOF/child exit returns endpoint/session error. For server operations, do not call cache reducers that infer running/stopped from endpoint/transport errors. Preserve last-known cache state and show connection-disconnected/stale messaging; only a successful server RPC or a stable server RPC error may update lifecycle state.

## Reviewable implementation batches

Each batch is a separate commit boundary. Write and run the named failing tests first (RED), implement only that batch, then run its acceptance commands. Keep unrelated client-side refactors out of these batches.

### 2A — Endpoint domain, app-data persistence, cache identity

**Create:** `src/lib/endpoints.ts`, `src/lib/endpoints.test.ts`, `src-tauri/src/endpoints.rs`.

**Modify:** `src-tauri/src/lib.rs` (module/commands only), `src/lib/native.ts`, `src/lib/mockTransport.ts` (isolated mock config storage only), `src/lib/settings.tsx` for `selectedServerEndpointId`, and `src/lib/serverStatusCache.ts`/tests for immutable endpoint-scope removal while protecting `local`.

**Interfaces:** TS `Endpoint`, `EndpointConfigV1`, `validateEndpoint`, `parseEndpointConfig`, `localEndpoint`, and an `EndpointRepository` using `read/write` native adapter calls. Rust serde endpoint structs plus `endpoint_config_read/write`; Rust repeats all validation and rejects unknown version/oversize writes. Tauri command takes the typed document and never accepts a caller-chosen file path.

**RED first:** TS tests for default local-only migration, UUID stability through edit, 64-endpoint/field-size boundaries, reject malformed IDs/destinations/control characters/leading-dash aliases, remote directory validation, selected-ID fallback, and endpoint deletion preserving other IDs. Rust tests for absent/corrupt/oversized/unsupported config, endpoint-count and field-size bounds, invalid values, atomic round trip and fixed path. Cache regression test asserts `scopes.local` fixture and timestamps are retained unchanged, local scope cannot be removed through endpoint deletion, and the first remote endpoint creates/removes only its isolated scope.

**Acceptance:** `bun test src/lib/endpoints.test.ts src/lib/serverStatusCache.test.ts`; `cargo test --manifest-path src-tauri/Cargo.toml endpoints`; `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`; `git diff --check`.

**Migration:** no schema upgrade of server cache and no settings data rewrite; missing endpoint config synthesizes the local endpoint. Existing `settings.serversDir` remains the local directory. Never migrate a local cache entry into a remote scope.

**Non-goals:** SSH spawning, UI, credentials, endpoint import/export, migration of endpoint data from localStorage (none exists at baseline).

**Collision hotspots:** `src-tauri/src/lib.rs` command registration, fixed app-data IO helpers, `src/lib/native.ts` mock/native seam, `src/lib/settings.tsx` current local directory ownership.

**Commit:** `feat: add persisted server endpoints`.

### 2B — Rust OpenSSH transport and fake executable contract

**Create:** `src-tauri/src/ssh_transport.rs`, `src-tauri/tests/ssh_transport.rs`, `src-tauri/tests/fixtures/fake-ssh` (or platform-specific fixture wrapper needed by the Pi tests).

**Modify:** `src-tauri/src/transport.rs` to share line-reader/child cleanup helpers and add an abort-capable transport contract without changing observable local behavior; `src-tauri/src/session.rs` to add lock-independent cancellation plus bounded establishment; `src-tauri/src/pool.rs` to select a `LineTransport` factory; `src-tauri/src/lib.rs` to map safe errors/commands; `src-tauri/Cargo.toml` only if an existing Tokio feature is insufficient (do not add an SSH protocol crate).

**Interfaces:** `SshEndpoint { id, destination }` validated again in Rust; `SshProcessTransport::spawn(executable, destination, timeout_config)` implements `LineTransport`; `TransportError`/safe diagnostic classifier distinguishes transport codes from core `Rpc`; fixed private constant `REMOTE_RPC_COMMAND = "exec jmcl-core rpc"`. Production executable resolver is `ssh`/`ssh.exe` on inherited `PATH`; tests inject a path through an internal function, never an app setting. Add a native `endpoint_session_open(endpoint_id)` which resolves a persisted SSH endpoint and returns existing `SessionInfo`; keep `core_open` as local-only for compatibility.

**RED first:** fake ssh records argv in a file and asserts exact token vector and exactly one final remote-command argument; independently assert no `sh`/`cmd.exe` spawn. Fake modes emulate a valid handshake/ping, malformed stdout, stderr then valid stdout, unknown/changed host key, interactive-auth diagnostic, nonzero remote-command exit, delayed/no handshake, abrupt disconnect after handshake, and child liveness after close/drop. Add a never-responding fake request proving `Session::close` completes within a bounded test deadline despite the request holding the transport mutex in the baseline design. Assert stderr is drained without forwarding raw lines, diagnostics are bounded, timeout kills the fake child, close kills only its child, and normal local transport tests remain unchanged.

**Acceptance:** `cargo test --manifest-path src-tauri/Cargo.toml ssh_transport`; `cargo test --manifest-path src-tauri/Cargo.toml --test rpc_smoke` when `backend-binaries/jmcl-core` is present; `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`; `git diff --check`. An optional loopback OpenSSH check is allowed only if ssh/sshd are already available and it needs no root or host-key/config changes; fake executable tests are required and sufficient for Pi.

**Non-goals:** changing JMCLCore RPC, adding password protocol, PTY, key storage, known-host UI/acceptance, agent forwarding, remote arbitrary commands, changing local `LocalProcessTransport` behavior.

**Collision hotspots:** shared `LineTransport` event semantics, Rust session startup/identity errors, child ownership and cancellation, `SessionPool` command registration, fake-script portability.

**Commit:** `feat: add system OpenSSH RPC transport`.

### 2C — Endpoint sessions, endpoint-scoped providers and stale-result isolation

**Modify:** `src/lib/rpc.ts`, `src/lib/native.ts`, `src/lib/servers.tsx`, `src/lib/serverOperations.tsx`, `src/lib/serverLogController.ts`, `src/lib/launcher.tsx` only if a session factory seam is required, and the corresponding `*.test.ts(x)` files.

**Interfaces:** Add `CoreSession.openEndpoint(endpoint)` / `CoreSession.openSshEndpoint(id)` calling `endpoint_session_open`; keep `CoreSession.open(binaryPath?)` local and unchanged. Add `endpointId` and `kind` to the operation source/scope; source equality and every applicability check compare endpoint ID, directory, and source revision. Add an endpoint session manager for the selected server endpoint: one persistent control session for startup/list/explicit status, a fresh operation session for each long mutation, and a fresh log-panel session. A connection-test session is short-lived. Do not reuse one request stream for these purposes.

Rust pool records are indexed by session ID and endpoint ID, with an endpoint-to-live-session index for cleanup/diagnostics. Every open makes an independent child/session, even when endpoint IDs match; never deduplicate sessions by endpoint, since that serializes unrelated requests. In-flight request clones retain `Arc<Session>` references while close/removal is processed; the pool removes the registry entry and closes only that session. Endpoint delete closes its indexed sessions. This provides explicit lifetime/refcount behavior without a shared blocking stream.

Update cache reducers/controller calls from hard-coded `SERVER_SCOPE` to captured `scope.endpointId`. Keep the literal local endpoint ID `local`, so Stage 1 data stays visible and untouched. The server card reads `cache.scopes[selectedEndpoint.id]`. On endpoint switch, increment `sourceRevision`, invalidate list/status generations and log/operation results, and preserve each endpoint's stored cache. A late completion may finish, but cannot update current manifests, cache scope, error status, or progress UI. Connection loss preserves last-known state and is presented separately from server lifecycle.

**RED first:** tests prove local launcher opens local `core_open`, endpoint opens the endpoint command, same endpoint has distinct sessions for operation/log/control, unrelated operations complete while a long call is pending on another session, switching endpoint/directory invalidates old list/status/operation/log completions (including switching away and back), cache scopes stay disjoint, and SSH disconnect during start/stop/restart never records stopped/running. Assert startup still performs one `server.list`, explicit status only, no N+1 polling, and panel/controller in-flight guards remain effective.

**Acceptance:** targeted Bun tests for `rpc`, `servers`, `serverOperations`, `serverLogController`, `serverStatusCache`, plus `bun run build`; `cargo test --manifest-path src-tauri/Cargo.toml`; Rust format; `git diff --check`.

**Migration:** `settings.selectedServerEndpointId` defaults to `local`; after endpoint config loads, invalid or missing selections fall back to `local`, and deleting the selected endpoint performs that fallback before cleanup. The local directory remains `settings.serversDir`, and cache scope remains `local`. Selected SSH endpoint has no server data until its own `server.list`/cache reconciliation. Keep endpoint definitions separate from UI preferences and all credentials.

**Non-goals:** server polling, automatic reconnect loops, RCON, properties/world/content pages, changing the Stage 1 lifecycle state machine except to distinguish endpoint/transport failure.

**Collision hotspots:** `SERVER_SCOPE`, `SourceKey`/`ServerOperationScope`, `startupRegistry`, `CoreSession.open`, `withOpenedSession`, log-panel close behavior, `ServerOperationsController` error reducer.

**Commit:** `feat: scope server sessions to endpoints`.

### 2D — Endpoint selector/settings UI and Vite scenarios

**Create:** `src/components/EndpointManager.tsx`, `src/components/EndpointManager.test.tsx`, `src/lib/endpointMock.ts`, `src/lib/endpointMock.test.ts`.

**Modify:** `src/App.tsx`, `src/pages/ServersPage.tsx`, `src/pages/SettingsPage.tsx`, `src/lib/servers.tsx` (provider wiring), `src/lib/mockTransport.ts`/`src/lib/transportMode.ts` only to select isolated mock scenarios, `src/lib/i18n.ts`, and `src/app.mock.test.tsx`.

**Flow:** Servers page has an accessible endpoint selector (Local is always present), add/edit/delete endpoint management in Settings, a Test connection action, and a required remote servers-directory field before server list/actions can run. Test connection opens an ephemeral endpoint session, verifies `core.version` then `ping`, closes it, and displays ready/version or structured categorized failure. It does not run `server.list` or mutate cache. Selecting an endpoint opens/uses its control session and makes exactly one startup `server.list`. Deletion requires confirmation, prevents deleting Local, removes only that endpoint's cache scope, invalidates late UI work, and terminates its sessions. Show distinct connecting, connected, unknown-host-key, changed-host-key, auth-required/interactive-unsupported, timeout, protocol mismatch, disconnected, and remote-path-required states; never label transport failure “server stopped”. Use labels, help text, keyboard-operable controls, focus-safe dialogs and live status announcements.

**Mock scenarios:** `default`, `empty`, `errors`, `ssh-host-key-unknown`, `ssh-host-key-changed`, `ssh-auth-required`, `ssh-timeout`, `ssh-bad-protocol`, and `ssh-disconnect`. Keep this endpoint dispatcher isolated from generic mock RPC behavior and store no secrets in mock state.

**RED first:** endpoint manager accessible-name/validation tests; add/edit/delete/local protected tests; connection test success/failure and guaranteed close; mock unknown-key/auth/timeout/protocol/disconnect flows; remote path blocks listing; switch from populated Local to SSH and back shows the same local cache; endpoint switch rejects stale completion; browser app tests ensure local instances still work and list refresh is not N+1.

**Acceptance:** targeted endpoint/component/app Bun tests; `bun run test`; `bun run build`; run Vite mock browser acceptance for every listed state in English/Chinese and light/dark, checking keyboard operation, accessible names/status, no overflow, and no host/command/secret leakage; `git diff --check`.

**Non-goals:** an SSH terminal, host-key acceptance UI, password/passphrase prompts, arbitrary ssh options, credential fields, lifecycle feature expansion, real SSH in mock mode.

**Collision hotspots:** `ServersPage`'s current `cache.scopes.local` lookup, app provider order, Settings local directory fields, i18n's paired dictionaries, `mockTransport` scenario initialization.

**Commit:** `feat: add endpoint selection and connection settings`.

### 2E — Platform verification and Stage 3 handoff

**Create/modify:** `docs/plans/2026-09-27-stage-2-ssh-transport.md` implementation record or a short Stage 2 completion record only after the work is actually complete; update `ROADMAP.md` status in the Stage 2 completion commit. No production code batch belongs here.

**RED/acceptance evidence:** Pi runs TypeScript tests/build, Rust unit/integration tests including fake ssh argv and process lifecycle, Rust formatting and diff checks. Optionally exercise loopback OpenSSH only if preinstalled and safe without root changes. Do not launch Tauri GUI on Pi. macOS and Windows each build/run the real Tauri GUI, verify native `ssh` discovery and child termination, environment/agent integration, unknown/changed known_hosts refusal, key/agent authentication, interactive-auth structured failure, remote `core.version`/`ping`/`server.list`, endpoint switch and app exit cleanup. Windows specifically verifies `ssh.exe`, executable lookup, WebView child lifetime and key/agent behavior; macOS verifies system OpenSSH, `SSH_AUTH_SOCK`/Keychain/agent behavior. Record versions and which platform performed each check. Real host connection tests require an explicitly configured, trusted test host; no credentials are entered or saved in JMCL.

**Stage 3 handoff gate:** only after target desktop proof of Stage 2 should Stage 3 run the real Pi server lifecycle: list/create, checked EULA install, start, explicit status, logs/cursor resume, command, stop/restart/delete, disconnect/reconnect, and detached-server survival after GUI close. Stage 3 owns real Minecraft server lifecycle acceptance; Stage 2 proves transport and endpoint isolation, not lifecycle correctness. Maintain no status polling/N+1 regression and never infer server stopped from SSH loss.

**Non-goals:** Pi desktop/Tauri GUI, changing Pi into a user-facing desktop target, root installation/config changes for OpenSSH, real Minecraft lifecycle work folded into Stage 2.

**Commit:** `docs: record Stage 2 platform verification and Stage 3 gate`.

## Risk table

| Risk | Evidence / impact | Mitigation and required proof |
|---|---|---|
| SSH remote command is interpreted by the remote login shell | OpenSSH joins command arguments and the server executes the command via the user's shell. | One immutable command argument `exec jmcl-core rpc`; no user-derived command/path/options; argv recorder assertion. This is a fixed-shell-command boundary, not shell-free remote execution. |
| Unknown/changed host key blocks a headless app | `StrictHostKeyChecking=yes` refuses both without asking or accepting. | Structured safe error and clear manual OpenSSH known_hosts guidance; fake diagnostics and macOS/Windows acceptance prove no automatic acceptance. |
| Password/passphrase prompt hangs or invokes askpass | GUI process has no supported interactive auth UI. | `BatchMode=yes`, bounded handshake, classify auth errors, close child; acceptance confirms no hanging prompt. |
| OpenSSH diagnostic wording differs by version/locale | stderr strings are not a stable API. | Best-effort narrow classification; safe generic connection failure fallback; never use diagnostic text as an RPC/server state. |
| Remote startup banners corrupt JSONL | Shell startup scripts may print to stdout before core events. | Handshake rejects malformed/non-JSON lines as protocol/session failure; document remote noninteractive shell stdout requirement and test malformed output. |
| SSH process leaks or one request blocks all sessions | Sessions are synchronous, and SSH transports own child processes. | Per-operation/log/control/test child sessions; bounded startup; child kill-on-drop; endpoint index with independent session IDs and Arc lifetimes; exercise cancellation/disconnect. |
| Stage 1 cache appears lost when selecting SSH | Current UI hardcodes `local`; cache already has endpoint scopes. | Keep endpoint ID `local` and same v1 cache bytes/key; add migration regression fixture and select Local after remote use. |
| Local `serversDir` is invalid on remote Linux | Setting is currently a local Tauri app-data directory. | Optional per-SSH `serversDirectory`, required before server RPC; never default/copy local path. |
| Platform executable/agent behavior differs | Pi cannot prove Tauri/WebView process env, macOS provider, or Windows OpenSSH install. | Pi fake executable coverage only; mandatory macOS and Windows native acceptance before Stage 3. |
| Endpoint metadata leaks host information | Labels and destinations identify infrastructure though they are not credentials. | Fixed app-data, bounded validated schema, no telemetry/logging of endpoint values, normal user-scoped file protections. |

## Decisions and user input

The available source evidence settles the v1 choices above: separate endpoint open command to protect the existing local launcher path; fixed app-data JSON for validated persistent endpoint metadata; random persistent endpoint IDs; local cache key remains `local`; no saved SSH/core executable overrides; system OpenSSH from inherited `PATH`; no guessed remote server directory; strict known-host checking; fixed `exec jmcl-core rpc` command. There is no blocking product decision that requires user input before implementation. If macOS/Windows acceptance shows `ssh` is unavailable through the app's inherited `PATH`, pause that platform's release gate and ask whether to add a user-selected executable override; do not quietly add it to v1.

## Recommended first implementation batch

Start with **2A**. It establishes the trust boundary and stable endpoint IDs, provides the exact Rust-validated model the SSH command will consume, preserves the existing local server root/cache behavior, and gives every later batch a testable endpoint contract without invoking SSH or touching the local process transport. Batch 2B can then build against a concrete validated endpoint rather than inventing a second configuration shape.
