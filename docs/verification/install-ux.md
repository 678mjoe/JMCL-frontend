# Installation UX verification

Scope: frontend preview, confirmation, application-owned modpack tasks, safe recovery,
completion summaries and shared ordinary/modpack installation progress. Core remains
pinned to `5a4310debbcee26b3d2391bab2339f79cd6ec52e`; no protocol or hard-link storage
semantics are changed. True task cancellation remains a separate Core feature.

## Automated coverage

- Bounded native archive inspection: manifest-only read, size/member limits,
  duplicate/ambiguous manifests, unsupported metadata and loader conflicts.
- Real pinned Core smoke fixture: synthetic local Modrinth archive, returned name
  (including version suffix), version, loader and file counts compared with preview.
- Controller/UI lifecycle: duplicate clicks, close/reopen, navigation, Settings/key
  detour, preserved form, editable failures, setup-only resume and unknown outcome
  replay prevention, including normalized destination aliases.
- Shared progress: Core-shaped file/retry/Java/processor events, malformed payloads,
  stage reset and independent same-ID tasks in different instance roots.
- Browser mock lifecycle scenario is part of `bun run test:e2e` in GitHub CI.

Local commands: `bun run test`, `bun run build`, `cargo fmt --manifest-path
src-tauri/Cargo.toml --all -- --check`, and `cargo test --locked --manifest-path
src-tauri/Cargo.toml` with the matching staged Core sidecar. Native CI also builds
and inspects non-distributed Linux, macOS arm64/x64 and Windows packages.

These checks do not constitute native visual acceptance, real Microsoft/CurseForge
account testing, provider download availability testing, a large real modpack
installation or game launch. No real credentials or external provider requests are
needed by the added fixtures. Local browser execution is environment-blocked;
browser CI is the executable acceptance path, not a local GUI claim.

## Local result (2026-10-25)

Rust 1.99.1 with a workspace-only Debian 13 sysroot: `cargo check --locked
--all-targets`, formatting and the full test command passed. Native tests: 82
library, 9 real Core RPC and 25 synthetic SSH tests (116 total, no failures or
ignored tests). The staged Linux Core SHA256 was
`0d49ff4130720c67397c3f673afaaf226f4b1f8384f68ea599e43340030c164b`.
The typed account wrapper smoke and five package-inspection helper tests also
passed. Existing Rust naming and Vite bundle-size warnings are unchanged.
Frontend: 549 Bun tests passed, TypeScript/Vite build passed. The refresh regression
asserts one list refresh per settled task and none for draft edits or another
active task's progress. Native visual acceptance remains outstanding as above.
