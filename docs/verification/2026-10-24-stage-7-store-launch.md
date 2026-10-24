# Stage 7 priorities 4–6 — store GC and launch preferences — 2026-10-24

## Scope and contract

- Frontend base `4cc86f6bdff34c627d17075fcf65a71ce9f6a889` (merged PR #12); containing commit identifies implementation.
- Linux x86_64. Inspected actual Core `97b65186d7882c415220969d8dcd264b6c3353bd`: `src/protocol/{store,launch}.zig`, `src/launch/{plan,executor}.zig`, and artifact store collection/locking.
- Scope remains roadmap priorities 4–6. No activation/shader guidance, release work, Core changes or new permissions.

## Implemented

- Settings exposes local configured `storeDir` only, minimum age default 86400 seconds, dry-run preview then exact-directory destructive confirmation. Execution is a new scan, not an immutable deletion plan. Settings/path/age changes invalidate approval. Duplicate clicks and stale asynchronous replies cannot authorize a new scope.
- Exact GC summary fields and matching request parameters are validated and projected. `STORE_GC_PARTIAL` carries no summary; UI reports unknown deletion totals, invalidates preview and requires a new preview. Other uncertain failures likewise never infer zero deletions or retry a destructive request.
- Core uses per-object locks and rechecks hardlink counts/age; no invented global frontend lock. UI recommends waiting for installs/downloads. Synthetic fixtures never delete real files.
- Version-1 frontend launch preferences keyed by normalized instance root plus ID. Existing valid settings retained; malformed fields/entries and unsupported preference versions safely default independently.
- JVM/game arguments are JSON string arrays, preserving literal whitespace, empty entries, order and duplicates; no shell parsing. NUL/nonstring elements rejected. Resolution is optional or a positive paired u32. Demo/default-user-JVM controls preserve Core defaults. No invented memory/fullscreen fields.
- Both instance-list and detail launch entry points use saved preferences. Shared parameter construction preserves selected version, directory, source, store, loader and Java override at the top level; only supported launch options are nested.
- `launch.plan` now requires explicit game directory and carries the same loader/Java/source fields as execution. Preview uses a dedicated session and actual selected auth, renders only Core `redacted_argv`, never raw response/diagnostics, and is invalidated on edits/cancel/scope changes. Preview uses an explicitly labeled natives placeholder: actual execution allocates a fresh extraction directory. Preview does not install Java or launch Minecraft, but Core may resolve metadata.
- Preferences are plaintext local settings; UI warns not to enter tokens/passwords. Core only recognizes known authentication secrets; arbitrary custom secrets are not guaranteed redacted.
- Root switches discard stale manifests/lists and pending auth intent; late requests cannot mix an old instance's metadata with a new root.

## Executed checks

- `bun run test`: **PASS**, 442 tests / 54 files / 2,946 assertions / zero failures.
- `bun run build`: **PASS**, TypeScript and Vite production build (main chunk about 860 kB).
- `git diff --check`: **PASS**.
- Initial verification caught incomplete test fixture typing and missing synthetic world-backup responses; those were corrected before this final aggregate pass. No failed run is counted as a pass.

Test fixtures cover save/cancel/reopen, root/store/Java scope changes, malformed persisted data, literal/duplicate/invalid argv, exact plan/execute/GC wire shapes, partial/unknown GC outcomes, late session opens/replies, repeated confirmation and canceled previews.

## Pending / not run

- Native macOS/Windows, visual/WebView and real UI acceptance remain pending. The previously denied isolated browser preview route was not retried or bypassed.
- No real store deletion, credential/account/API calls, Minecraft launches/downloads, SSH/server/paid/release/deployment actions were performed. Tests use synthetic in-memory fixtures only.
- Rust code unchanged; no new native check claimed. Prior PR #12 native build evidence remains historical, not this feature's UI acceptance.
- Vite's existing >500 kB main-chunk warning remains nonblocking.
