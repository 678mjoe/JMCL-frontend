# Stage 5 server worlds — 2026-10-24

## Scope and environment

- Frontend base: `d8285cb1af5b1d75726c3799c5ed3aecb8640e0f` (merged PR #8), verified against remote main. The containing commit identifies the tested tree.
- Linux x86_64 fallback; Bun 1.4.4; existing lockfile dependencies reused. No Rust or dependency changes.
- Contract: this revision's `gui-handoff.md`, `server.worlds.*`. No JMCLCore revision was built, changed or executed.
- Frontend implementation and automated fixture evidence only: **not Stage 5 real/native/visual acceptance**. Existing acceptance gates remain unchanged.

## Behavior

- Bilingual server-world panel lists the configured base world and existing dimension siblings, details/nullable metadata, lock state and whole-world backups.
- Core resolves every internal path. Frontend sends world/backup identifiers, never constructs filesystem paths. A whole-world backup omits `world`, collecting the configured base and existing siblings.
- Rename and delete require typing the selected world's name and explain coupled siblings. Base rename updates `level-name` through Core; base deletion cascades. Restore requires the exact backup name; overwrite is a separate unchecked opt-in and sends explicit `replace`.
- Restore preserves the contract's semantics: it restores every archived top-level world directory, not an invented client-world destination. It does not automatically switch the configured `level-name`; the panel explains this distinction.
- Every mutation first obtains a fresh, matching-target `server.status` on a dedicated session. Running, malformed/unknown, failed or stale-source authority cannot dispatch. An authoritative stopped status with `stale_state` is still stopped (stale PID bookkeeping is not a running process). Core remains the final authority for external races and world locks.
- World, backup, base-world configuration and status reads refresh after success and failure. Refresh failures are separate from mutation errors; stale details are cleared. The main server status cache refresh is scoped to the still-current source.
- Lifecycle, FIFO, properties and world operations share the physical-target lock across navigation and source revisions. Cancel invalidates presentation; it does not promise rollback or release a pending mutation's lock. Locks remain held until dispatched work and session cleanup settle. Late responses and late success after dismissal are discarded.
- Safe allowlisted error codes are retained; raw diagnostics and properties beyond `level-name` are not retained by the world controller. No automatic destructive retry.
- Mock fixtures now preserve archived metadata, current `level-name`, unrelated worlds and coupled-lock/collision atomicity. These fixtures are not a substitute for Core integration testing.

## Executed checks

| Check | Result |
| --- | --- |
| `bun run test` (final tree, two complete runs) | **PASS**: 297 tests, 33 files, 2,087 assertions, zero failures each |
| New controller tests (included above) | **PASS**: 23 tests, 283 assertions |
| New happy-dom panel tests (included above) | **PASS**: 9 tests, 77 assertions |
| `bun run build` | **PASS**: TypeScript + Vite production build |
| `git diff --check` | **PASS** |

An earlier aggregate run timed out in the existing `app.mock.test.tsx` setup hook
while parallel checks were still running (294 pass / 1 hook failure). No failed
result was counted as a pass; after all test edits settled, two complete normal
runs passed without increasing timeouts or excluding tests. The exact cause of
that transient setup timeout was not established.

Vite retains the non-blocking >500 kB main-chunk warning (about 770 kB minified).
No Rust source changed, so Rust/native checks were not rerun.

## Pending / not run

- Browser pixel/visual acceptance: prior supported preview could not reach isolated Vite; runtime setup escalation failed on a restricted read-only path. No retry or bypass was attempted. happy-dom interaction tests are **not screenshots**.
- macOS/Windows native Tauri/WebView, packaged sidecar and OS-specific integration remain pending their target environments. Linux frontend builds do not establish these results.
- Real SSH, Minecraft servers, worlds, archives, properties and irreversible operations were not touched. All new operation tests use synthetic in-memory fixtures. Real-target acceptance requires separately approved scope.
- No real accounts, credentials, security settings, paid services, deployment or formal release.
