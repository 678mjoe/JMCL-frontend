# Stage 6 server Mods and datapacks — 2026-10-24

## Scope and contract

- Frontend base: remote main `61f760c16ee3420d0dfdafc0cbf39948b9f09760` (merged PR #9). The containing commit identifies this implementation's tested tree.
- Linux x86_64 fallback, Bun 1.4.4, existing lockfile dependencies. No Rust or dependency changes.
- Checked `gui-handoff.md` and read-only JMCLCore `97b65186d7882c415220969d8dcd264b6c3353bd`, `src/service.zig` content operations and `src/worlds.zig` archive exclusions. Core was not built, changed or executed.
- **Frontend implementation and synthetic automated evidence, not real/native/visual acceptance.** Product ordering and acceptance gates are unchanged under the documented user-authorized development exception.

## Implemented behavior

- Bilingual server-detail content panel: lists, Modrinth search, compatible game/loader versions, install, upgrade/downgrade, enable/disable, filename-confirmed removal and unmanaged-file adoption.
- Fabric, NeoForge and Forge filtering; Vanilla rejects new Mod installation but permits datapacks. Core intentionally allows existing Mod cleanup/version operations without a loader; the GUI does not invent a backend prohibition on cleanup.
- Datapack registry belongs to the configured base world. Core resolves `level-name`, creates the directory on mutation before first launch and owns paths/properties. Usable properties are required; Core has no separate manifest-installed check. Mock registry follows property switches, rename and delete. Core archives exclude `.jmcl`, so restored datapack files appear unmanaged rather than fabricating restored registry metadata.
- Every mutation reads a fresh matching-target manifest and authoritative stopped status on a dedicated session. Unknown/malformed status, running state, wrong target or invalidated endpoint cannot dispatch. Core remains authoritative for external races and compatibility validation.
- Shared physical-target lock covers lifecycle, properties, worlds and content, including across controller replacement. Repeated dispatch is rejected. Cancellation closes the dedicated session and invalidates presentation but does not claim remote rollback or release an unsettled request's lock. Late responses/progress cannot revive a dismissed view.
- Content and status refresh after success/failure; refresh errors remain distinct from confirmed mutation results. Only allowlisted error codes and progress event names / validated numeric file counts are displayed: no raw diagnostic/path/URL/request payload retention.
- Registry file selectors preserve Core’s exact relative `mods/name.jar` / `datapacks/name.zip` values, including manual entries; absolute, traversal and wrong-kind selectors are rejected. No client/local path construction is used.
- Catalog reads use the existing Modrinth service, not client instance RPC. Close, tab changes, endpoint/source replacement, newer search and back navigation suppress stale catalog results. No CurseForge credentials were introduced.

## Executed checks

| Check | Result |
| --- | --- |
| `bun run test` (final code) | **PASS**: 332 tests, 36 files, 2,390 assertions, zero failures |
| New content controller tests (included above) | **PASS**: 18 tests, 169 assertions |
| New panel + catalog tests (included above) | **PASS**: 13 tests, 97 assertions |
| Focused mock + wire tests (included above) | **PASS**: 46 tests |
| `bun run build` | **PASS**: TypeScript + Vite production build |
| `git diff --check` | **PASS** |

Modrinth filtering was checked against its official [search](https://docs.modrinth.com/api/operations/searchprojects/) and [project versions](https://docs.modrinth.com/api/operations/getprojectversions/) contracts. Tests use local synthetic catalog responses, not real downloads.

Initial checks were not counted as passes: an early TypeScript build found incorrect controller imports, event-handler wrapper types, and synthetic adopted-result type, all corrected; a concurrent WIP panel language comparison was also corrected. An initial `bun run test` invocation failed because nested `bun` was not on PATH (exit 127); subsequent checks explicitly prepend the existing Bun tools directory. Intermediate complete runs passed before the final interaction cases were added. Parent review found an overstrict basename-only controller selector (masked by new unit fixtures, not the existing correctly-prefixed mutable mock); it was corrected to preserve real Core relative paths, with explicit manual toggle/remove and mock basename-rejection regressions. No earlier pass was treated as evidence for this corrected path behavior.

Vite retains the non-blocking >500 kB main-chunk warning (about 789 kB minified). No Rust source changed, so Rust/native checks were not rerun.

## Pending / not run

- Browser pixel/visual acceptance remains pending: earlier supported preview could not reach isolated Vite; runtime setup escalation failed on a restricted read-only path. No retry or bypass was attempted. happy-dom interactions are not screenshots.
- macOS/Windows native Tauri/WebView, packaged sidecar, OS integration and real UI checks need their target environments. Linux frontend build does not establish these results.
- No real package download/install, Minecraft workload, server, world, SSH target, account, credential, paid service, deployment or formal release was touched. Synthetic in-memory fixtures only; real target acceptance needs separately authorized scope.
