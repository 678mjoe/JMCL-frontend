# Stage 7 priority 3 — CurseForge — 2026-10-24

## Scope and contract

- Frontend base: `76ddf2b0b0088ba7b326a8cb853282491f4d77b5` (PR #11). The containing commit identifies this implementation tree.
- Linux x86_64 fallback; no registered desktop environment. Read `CONTRIBUTING.md` and preserved roadmap scope/order/acceptance gates.
- Inspected actual Core `97b65186d7882c415220969d8dcd264b6c3353bd`: `src/content/curseforge.zig`, `src/protocol/{content,datapacks,server_content,modpack}.zig`, `src/service.zig`, and modpack documentation. Core remains unchanged.
- Verified [official CurseForge API documentation](https://docs.curseforge.com/rest-api/): fixed `https://api.curseforge.com`, `x-api-key`, search `gameId`, loader/game-version coupling, and `pageSize <= 50`, `index + pageSize <= 10000`.
- Minecraft game 432; classes 6/12/6552/5290; loaders Forge 1, Fabric 4, NeoForge 6 match pinned Core. Numeric project/file IDs remain strings in RPC. Keys accept only 1–512 printable nonspace ASCII bytes.

## Implemented behavior

- Explicit optional Settings save/remove/status controls with transient masked input. Independent OS credential namespace `page.mjoe.jmcl.curseforge`, not a fake Microsoft account. No key getter, localStorage/settings/task persistence, arbitrary-URL fetch, or broadened HTTP/filesystem capability.
- Native-only fixed-host catalog requests, redirect refusal, 30-second request timeout, 2 MiB response cap, bounded pagination. Search shows the first 50 results; version UI explicitly shows at most the first 500 API files. Compatibility tags are checked again in frontend. No CDN URL is guessed or downloaded by the catalog UI.
- File browsing rechecks project game/class and third-party distribution policy. Missing/null/non-HTTPS download URLs become unavailable; URLs are removed from native file metadata. Restricted projects/files cannot be installed from the UI. Core remains final installation authority.
- Provider selection, install and version switching across client mods/resources/shaders, world datapacks, and server mods/datapacks. Server UI warns that catalog tags do not establish server-side suitability and that installation sends the key to the selected trusted Core endpoint over its existing transport.
- Native bridge injects the stored key only for allowlisted content/install/version-change and modpack methods. JS-supplied `api_key` is rejected recursively. The provider marker is stripped from set-version/modpack wire parameters; Core derives registered provider and auto-detects archive format.
- Credential-bearing sessions are single-use, reject queued subsequent reads, and are closed/reaped before the secret is released. Diagnostics/unknown events are dropped, progress is projected to safe numeric counters, errors use static text and allowlisted codes. Controllers reopen clean sessions for refresh or post-import game setup, retaining existing mutation coordination and cancellation behavior.
- CF modpack import requires explicit provider choice and saved-key status, preserves existing new-instance/ambiguous-outcome rules, and never blindly retries an uncertain archive write.
- Review caught pinned-Core selector limitations: project IDs/slugs are not provider-qualified during set-version, and client toggle/remove project selectors only support Modrinth. Native CF version changes preflight the current registry and fail closed on ambiguous/wrong-provider selectors; UI explains ambiguity. Client toggles/removal use exact registry file identities rather than project selectors.
- Synthetic mock credential state retains only presence, never entered secret bytes. Mutable mock content/import paths exercise CF intent without real APIs or downloads.

## Verification environment

- Bun 1.4.4 and lockfile frontend dependencies.
- Official Rust 1.99.1/cargo/rustfmt installed into the workspace. Debian trixie dependency archives were checked against a signed InRelease/Packages index and per-archive SHA256, then extracted to a workspace sysroot without package scripts or system configuration changes. GLib/GTK/WebKit pkg-config and a C link smoke check passed.
- Official Zig 0.16 archive SHA256 verified. Actual pinned Core compiled and staged with `scripts/prepare-sidecar.sh`; it was not executed. Generated binaries/toolchains/sysroot are untracked and not part of the PR.
- Commands use the workspace-native environment (`PKG_CONFIG_SYSROOT_DIR`, `PKG_CONFIG_LIBDIR`, native library/link search paths). This setup is reproducible evidence of this Linux build only, not a platform acceptance claim.

## Executed checks

| Check | Result |
| --- | --- |
| `bun run test` | **PASS**: 407 tests, 48 files, 2,792 assertions, zero failures |
| `bun run build` | **PASS**: TypeScript and Vite production build; main chunk about 842 kB |
| `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check` | **PASS** |
| `cargo check --locked --manifest-path src-tauri/Cargo.toml` | **PASS** |
| `cargo test --locked --manifest-path src-tauri/Cargo.toml --lib` | **PASS**: 38 unit tests |
| Pinned Core `zig build` + sidecar staging | **PASS**, built only, not executed |
| `git diff --check` | **PASS** |

The final checks ran after review fixes, including ordinary Modrinth and Microsoft token-contract regressions. Initial runs exposed test-fixture typing/DOM-dispatch errors and races with concurrently edited tests; those were fixed before the final aggregate pass. No initial failure is counted as a passing result. Core binary SHA256: `06d5718984e142da0706dd5f2230f35a2bc66d25fc107e29f63bd2e44ba4d940`.

## Pending / not run

- Real API/key acceptance, OS credential-store save/read/delete, real archives/downloads/dependencies, Minecraft workloads, SSH endpoints and server mutation were **not run**. No real key/account was acquired or configured.
- Native macOS/Windows keychain/WebView/sidecar builds and actual UI acceptance remain pending. Linux Rust checks do not establish either platform.
- Browser pixel/visual acceptance remains pending due to the previously denied isolated preview route. No retry, bypass, or replacement route was attempted. DOM tests are not visual screenshots.
- Live HTTP redirects/error/oversize behavior is not established by pure request/response transformation tests; no real API or credential-bearing HTTP request was made.
- No release/deployment, paid services, persistent security grants, or roadmap completion gates were changed. Existing Vite main-chunk size warning remains nonblocking.
