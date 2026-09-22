# Server Stage 1C Implementation Plan

> **For Hermes:** Execute each batch with a fresh Codex worker, then independently verify contract semantics, tests, and browser behavior before committing.

**Goal:** Build the Vite-mock server-management lifecycle from cached list state through create, EULA-gated install, start/stop/restart, resumable logs, console commands, and delete—without SSH or real server installation.

**Architecture:** Server manifests remain authoritative from `server.list/get`; GUI running state is restored from an endpoint-scoped app-data cache and changed only by lifecycle results or explicit `server.status`. The cache is advisory for UI, while the core remains the final authority. Server mock behavior lives outside the already-large generic mock transport and mutates real fixture state. UI components consume the Stage 1B capability matrix rather than reimplementing lifecycle checks.

**Tech Stack:** React 19, TypeScript, Bun tests, Tauri 2/Rust, shadcn-style UI components, JMCLCore protocol v1.

---

## Fixed design decisions

- No automatic status polling.
- App startup restores cached statuses and performs one `server.list` RPC only.
- `server.status` runs only for an explicit per-server refresh.
- The list-level refresh updates manifests only; it does not perform N status RPCs.
- Successful `server.start/stop/restart` results update the cache directly with no follow-up status request.
- Lifecycle errors infer only what their stable code proves; otherwise cache state becomes `unknown` and the UI offers explicit refresh.
- Cache is stored as `server-status-cache.v1.json` in fixed Tauri app-data; no caller-provided file path.
- Cache namespaces are endpoint-ready (`scopes[scopeKey]`) but Stage 1C implements only scope `local`.
- Persist `started_at_ms` and derive uptime; do not persist `uptime_ms`.
- Never persist logs, commands, RCON credentials, Query player data, API keys, or raw RPC request lines.
- Server list cards show cached state and timestamp, clearly labeled as last-known state.
- Server detail uses the same cache until explicit refresh or lifecycle mutation.
- Create does not accept EULA. First install requires a checked EULA confirmation; subsequent repair uses already-recorded acceptance while still sending `accept_eula:true`.
- Do not add SSH, endpoint configuration UI, RCON, Query, properties editing, world/content operation pages, or real Minecraft server installation.

## Batch 1: Versioned status cache and native app-data persistence

**Create:**
- `src/lib/serverStatusCache.ts`
- `src/lib/serverStatusCache.test.ts`
- `src-tauri/src/server_status_cache.rs`

**Modify:**
- `src/lib/native.ts`
- `src/lib/mockTransport.ts` only for isolated development cache storage/reset hooks if necessary
- `src-tauri/src/lib.rs`

**Behavior:**
- Schema version 1 with endpoint-ready scopes and server entries.
- Closed cache lifecycle union: `created | stopped | running | unknown`.
- Store PID/supervisor PID/Java/start time/check time and optional stale-cleanup time.
- Pure reducers for create/install/start/stop/restart/status/delete and selected stable lifecycle errors.
- `SERVER_ALREADY_RUNNING` can infer running but leaves unavailable process details null; `SERVER_NOT_RUNNING` infers stopped; uncertain errors infer unknown.
- Corrupt, absent, oversized, or unsupported-version files read as an empty v1 cache.
- Fixed app-data path and crash-safe same-directory replacement; no arbitrary paths.
- Browser mock storage is isolated and resettable for tests; production calls narrow Tauri commands.

**TDD:** Write one failing cache reducer test, observe RED, implement minimal behavior, then add persistence/error cases incrementally.

**Acceptance:** Bun tests/build, Rust tests/format, `git diff --check`; no UI changes.

## Batch 2: Mutable server mock dispatcher

**Create:**
- `src/lib/serverMock.ts`
- `src/lib/serverMock.test.ts`

**Modify:**
- `src/lib/mockTransport.ts`
- types only when serializer evidence requires correction

**Fixture coverage:**
- empty list;
- created/uninstalled Fabric server;
- installed/stopped server;
- running server;
- stale-state server;
- EULA rejection;
- Java incompatible install fixture;
- logs absent, append, cursor resume, truncation and file rotation/reset;
- RCON/Query disabled;
- server worlds, backups, mods and datapacks data for future pages.

**Lifecycle:**
`list → create → reject install without EULA → install → start → status → logs → command appends log → stop → delete → list` must mutate and remain observable across calls.

**Acceptance:** Public `CoreSession` wrappers drive the full lifecycle test. No static success responses. Existing client mock tests remain green.

## Batch 3: Server navigation, directory setting, list and creation

**Create:**
- `src/pages/ServersPage.tsx`
- `src/components/ServerCard.tsx`
- `src/components/CreateServerDialog.tsx`
- focused component/integration tests

**Modify:**
- `src/App.tsx`
- `src/lib/settings.tsx`
- `src/lib/native.ts` (`serversDir`, local app-data default; mock `/mock/jmcl/servers`)
- `src/pages/SettingsPage.tsx`
- `src/lib/i18n.ts` (Chinese and English)

**Behavior:**
- Sidebar “Servers” route and server detail route placeholder boundary.
- Startup/list refresh performs `server.list` once and reconciles cache entries with manifests.
- Cards show manifest, loader, installed flag, cached lifecycle and checked timestamp.
- Unknown status offers per-server explicit refresh (`server.status`, exactly once).
- List refresh does not query per-server status.
- Create writes `accept_eula:false`, updates cache to created, and opens detail.
- Loading, empty, core failure and list failure are distinct.

## Batch 4: Detail page, EULA install and lifecycle mutations

**Create:**
- `src/pages/ServerDetailPage.tsx`
- `src/components/ServerInstallDialog.tsx`
- `src/components/DeleteServerDialog.tsx`
- `src/lib/serverOperations.tsx` (server-specific, separate from client `TasksProvider`)
- tests

**Behavior:**
- Manifest + cached state render immediately; explicit refresh calls `server.status` once.
- All controls use `deriveServerState` capabilities.
- First install requires explicit checkbox and EULA link; no deliberate failing request.
- Install uses dedicated session and existing download progress events; processor tail waits for terminal result without invented event types.
- Start/stop/restart use dedicated sessions and update cache from terminal result only.
- Delete available only when state machine permits; removes cache entry.
- Stable lifecycle errors update cache only when logically justified; otherwise unknown.
- No hidden status follow-up RPC after successful operations.

## Batch 5: Resumable logs, console command and visual acceptance

**Create:**
- `src/lib/serverLogController.ts`
- `src/lib/serverLogController.test.ts`
- server console component(s)

**Behavior:**
- First read omits cursor/file_id; every resume sends both prior `next_cursor` and `file_id`.
- `reset:true` replaces buffered text; otherwise append.
- `truncated:true` displays older-log omission.
- `SERVER_LOGS_NOT_FOUND` is an empty state.
- Logs may poll while console is open/running, with in-flight guard, cleanup, final read after stop, and bounded buffer. Log polling does not alter lifecycle cache.
- Console command rejects empty/multiline input locally, sends one RPC, and does not claim command output before logs show it.

**Browser acceptance:**
- Default, empty, global errors, stale state, EULA gating and Java-incompatible flow.
- Real accessibility snapshot plus screenshot in light/dark and Chinese/English representative states.
- No overflow, truncation, misleading empty-vs-error state, or enabled forbidden action.

## Final verification

```bash
bun install --frozen-lockfile
bun run test
bun run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
git diff --check
zig-0.16 build test  # /home/mjoe/projects/JMCLCore, read/test only
```

Document Stage 1C completion without claiming SSH or native macOS/Windows integration was tested on the Pi.
