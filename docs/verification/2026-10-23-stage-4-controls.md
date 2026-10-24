# Stage 4 server configuration and advanced controls — 2026-10-23

## Scope and environment

- Frontend base: `95860ee6e4c80d16a4f37b398ca5aafb1e1e7748` (merged PR #7).
  The containing Git revision identifies the tested implementation.
- Linux x86_64 cloud fallback; Bun 1.4.4, existing isolated lockfile dependencies
  reused from the Stage 3 workspace. No dependency or Rust changes.
- No JMCLCore binary was changed or executed. Contract reference: this revision's
  `gui-handoff.md` (properties merged atomically by core; RCON/Query loopback only).
- This is frontend implementation and automated evidence, **not real Stage 4
  acceptance**. The user-authorized development exception does not lower gates.

## Implemented behavior

- Detail page includes bilingual advanced controls. Properties are displayed as
  strings; saves send only explicit changed/new fields. Unknown fields survive
  core's merge. Password fields are always redacted and read-only; password keys
  (including case variants) cannot be added or written back. Failed saves retain
  edits, and reload requires save/discard rather than silently replacing drafts.
- Each save obtains fresh authoritative `server.status` on its dedicated session
  before writing. Running, unknown, failed or stale-source checks cannot dispatch
  a write. Core remains the final authority for races outside the GUI.
- RCON uses a masked transient password, cleared on submit, cancel, panel close,
  unmount, source switch and leaving running state. It is neither persisted nor
  added to task diagnostics, logs, telemetry or caches. Cancellation during open
  or status prevents dispatch. Cancellation after dispatch does not claim undo.
- Query offers basic/full results including nullable fields and player lists.
  RCON/Query use existing typed RPC wrappers; no host/port selector or public
  exposure shortcut exists. Requests require fresh live running status.
- Allowlisted error codes drive recovery copy; raw diagnostic messages are never
  retained by this controller. Disabled features, authentication/protocol errors,
  Java and connection failures do not cause automatic retries.
- Lifecycle, FIFO commands and advanced actions share the same physical-target
  coordinator across controllers and source revisions. Different endpoints remain
  independent. Scope checks discard late responses; cancellation does not release
  the lock until dispatched work and dedicated-session cleanup settle.

## Executed checks

| Check | Result |
| --- | --- |
| `bun run test` | **PASS**: 260 tests, 31 files, 1,692 assertions, zero failures |
| New controller and DOM tests (included above) | **PASS**: 30 tests; authority, strings/redaction, safe errors, cancel/close/repeated clicks, endpoint switches and shared-lock conflicts |
| `bun run build` | **PASS**: TypeScript + Vite production build |
| `git diff --check` | **PASS** |

Vite retains the non-blocking main-chunk warning (approximately 750 kB minified).
DOM tests use happy-dom fixtures: they establish behavior, **not rendered pixels**.
No Rust source changed, so Rust/native checks were not rerun for this batch.

## Pending / not run

- Browser pixel/visual acceptance remains pending. The earlier supported cloud
  preview could not reach isolated Vite and setup escalation failed before
  execution on a read-only runtime path. No connected browser route became
  available; the restricted action was not retried or bypassed.
- macOS/Windows native Tauri/WebView, packaged sidecar, keychain and dialogs remain
  pending their target environments. A Linux Vite build is not native acceptance.
- Real properties files, SSH disconnects, RCON authentication, Query and Minecraft
  workloads were not exercised. These require a separately approved target and
  scope. All new interactions used fixtures; no real accounts, hosts, credentials,
  security settings, paid services, deployment or formal release were used.
