# Stage 7 first batch: client world datapacks and modpack import — 2026-10-24

## Scope and contract

- Frontend base: merged Stage 6 main `4fddd7514f2bf6d6a6a98abbf800fa88f7a81046`. The containing commit identifies the implementation tree.
- Linux x86_64 fallback, Bun 1.4.4, existing lockfile dependencies. No Rust or dependency changes.
- Read-only Core checkout verified at `97b65186d7882c415220969d8dcd264b6c3353bd`; inspected `src/protocol/datapacks.zig`, `src/protocol/modpack.zig`, content/world semantics, and `docs/modpack.md`. Core was not changed, built or executed.
- Corrected one handoff wording mismatch: every datapack operation takes the game directory and world, but only install/set-version require `minecraft_version`. List/toggle/remove/adopt do not. No loader argument or server datapack API is used.
- Only Stage 7 priorities 1–2. CurseForge archives explicitly remain blocked pending the existing priority 3 API-key work. No credentials, GC, advanced launch settings, release or security changes.

## Implemented behavior

- Bilingual world-specific panel: list, unmanaged files, adoption, Modrinth compatible project/version search, install, version change, enable/disable and filename-confirmed removal. Manual entries cannot change provider versions.
- Exact Core-relative `datapacks/name.zip` registry identities are preserved, including manual entries; no basename stripping or guessed world filesystem paths. Core owns world paths and locking.
- Fresh `worlds.get` lock check before mutation, Core final lock authority, and existing process-wide instance mutation coordinator prevent conflicting same-instance actions. Dedicated sessions close after terminal work. Cancel invalidates presentation; it does not claim rollback or release an unsettled write's lease. Late catalog/world responses cannot revive a dismissed or replaced view.
- Mock datapack state is mutable and isolated by game directory/world; rename/duplicate preserve registries, exports/backups exclude registry metadata, restores/imports expose unmanaged files for adoption.
- Modpack native picker reuses the existing adapter. Import requires a free new instance ID, calls `modpack.install`, reads and validates the resulting manifest, then explicitly calls `install.execute` and `install.prepare` with its pinned version/loader. One lease spans the full chain.
- Progress and allowlisted errors are displayed without raw diagnostic retention. Repeated clicks cannot duplicate imports. Ambiguous archive outcomes are not blindly retried; confirmed archive success permits only game setup to resume. Busy close is blocked, unmount suppresses follow-on stages, and pending archive work retains ownership until it settles. Picker cancellation makes no request.
- In-memory modpack imports create actual fixture manifests visible to list/get/install; conflicts and unsupported/CF key-blocked archives leave fixtures unchanged. No real archive was read or downloaded.

## Executed checks

| Check | Result |
| --- | --- |
| `bun run test` (final post-review source) | **PASS**: 370 tests, 43 files, 2,586 assertions, zero failures |
| Datapack controller/catalog/DOM focused tests | **PASS**: 14 tests, 85 assertions |
| Modpack controller/DOM focused tests | **PASS**: 15 tests, 61 assertions |
| Mutable mock focused tests (existing + new) | **PASS**: 13 tests, 79 assertions |
| `bun run build` (final post-review source) | **PASS**: TypeScript + Vite production build |
| `git diff --check` | **PASS** |

Initial incomplete checks were not counted as final passes: TypeScript first caught the modpack event callback generic mismatch, then missing annotations in the new RPC test; both were corrected. Parent review caught instance contention being presented as an ambiguous archive outcome; `INSTANCE_BUSY` now gives explicit no-submission guidance and has controller/DOM regressions. A focused DOM run initially timed out under concurrent work; its rerun and the final aggregate run passed. Final checks were rerun after review fixes. Vite retains the non-blocking >500 kB main-chunk warning (about 824 kB minified).

## Pending / not run

- Browser pixel/visual acceptance remains pending. Earlier supported preview could not reach isolated Vite and runtime setup escalation failed on a restricted read-only path. No retry or bypass was attempted. happy-dom interaction tests are not screenshots.
- macOS/Windows native Tauri/WebView, native file dialogs, packaged sidecar and real UI acceptance need the relevant platform environments. No Rust files changed; native/Rust checks were not rerun.
- No real archives, package downloads, Minecraft workloads, accounts, credentials, SSH hosts, server changes, paid services, deployment or formal release were touched. These remain outside this synthetic test scope.
- Frontend implementation, automated tests and actual native/visual/real acceptance remain distinct; roadmap gates are not declared passed.
