# Stage 7 priorities 7–8 — pack activation and runtime guidance — 2026-10-24

## Scope and boundary

- Frontend base `26b0e7cee11028557c968eea2982b43e31e9ef89` (merged PR #13). Existing store/launch preferences retained. Core contract baseline `97b65186d7882c415220969d8dcd264b6c3353bd`.
- Linux x86_64 synthetic checks only. Core owns installed files; GUI owns game/runtime selection configuration. [Pinned upstream format research](./2026-10-24-pack-format-sources.md).
- No Core change, broad filesystem plugin, arbitrary file command, new credential access, real game files, games, downloads, SSH, or accounts were used.

## Implemented

- Separate resource-pack file availability from configured game selection. Existing `options.txt` `resourcePacks` JSON IDs use `file/<filename>` and low-to-high priority (last wins). Missing/unknown/built-in IDs are preserved and cannot be removed through this editor. Non-target lines/settings and relative order are retained byte-for-byte, including CRLF and unrelated compatibility acknowledgments.
- Resource format support is deliberately limited to numeric `1.x[.y]` releases with minor >=13 and an existing unambiguous setting. This recognizes a numeric modern naming/format shape, not existence of that release in Mojang metadata. Legacy, snapshots, arbitrary/custom version identifiers and newer numbering schemes fail closed rather than infer formats. Pack compatibility and actual rendering are not established by writing selection.
- Iris/Oculus shader selection uses explicit runtime-format choice and **existing** `config/iris.properties` / `config/oculus.properties`, not options.txt. Changes `shaderPack` and `enableShaders`; one selected shader is not a resource-pack stack. Requires separate user confirmation of chosen runtime and all game processes stopped. This is not installed-runtime autodetection: stale files/registry entries cannot establish what Minecraft actually loads. Limited ASCII Java Properties parser rejects unsupported escaping/continuations/ambiguous target keys, preserving other settings. Unsupported formats require the in-game menu.
- Native commands accept instance root + ID, validate manifest identity, and use fixed allowlisted paths. Unix directory-handle-relative traversal with `O_NOFOLLOW` rejects symlink ancestors/targets, traversal, nonregular config files and config hardlinks. Installed ZIP hardlinks are accepted because Core content storage can use them. Same-directory exclusive temporary files, fsync and rename provide atomic replacement; originals are checked by exact bytes and inode immediately before replacement. Unknown settings never travel to JavaScript; revisions reference bounded native snapshot storage.
- Native gate covers the entire `core_request` lifetime, including launch, across sessions; activation refuses while any Core request runs. Existing frontend instance coordinator also serializes writes against launch/content/world work. Gate is intentionally conservative across instances. Core exposes no authoritative client status; external or surviving game processes cannot be proven stopped. The UI requires an explicit stop acknowledgment and warns not to externally launch during save. Revision checking detects observed external edits, but cannot promise atomic compare-and-swap against an uncooperative external writer between final check and rename.
- Runtime guidance checks verified Iris/Oculus project identities against exact selected game version + loader per-version catalog metadata. No universal loader/runtime mapping. Registered matching/disabled/unverified/absent states are distinct; manual/other-provider installs may not be identified. Dependencies, GPU support and actual runtime loading remain separate. Checking never installs; explicit choice opens the existing Modrinth version-selection/install flow, with exact compatibility/identity checks repeated.
- Scope changes discard drafts, approvals and late responses; failed/uncertain saves invalidate revision and approval and require reread. No automatic retry of writes. Content-page late manifests cannot mount activation controls for a different root.

## Executed checks

- `bun run test`: **PASS**, 462 tests / 60 files / 3,022 assertions / zero failures.
- `bun run build`: **PASS**, TypeScript and Vite production build.
- `git diff --check`: **PASS**.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: **PASS**.
- `cargo check --manifest-path src-tauri/Cargo.toml --offline`: **PASS** (Linux native dependencies from existing `jmcl-tools/native-env.sh`).
- `cargo test --manifest-path src-tauri/Cargo.toml --offline`: **PASS**, 55 unit tests (17 new pack/shader tests), 7 pinned real-Core synthetic RPC tests, 25 fake-SSH process tests: **87 passed**, zero failed. Binary/doc targets contain zero tests. No real SSH host or Minecraft workload.
- Parent and independent source/native review completed. Bare-CR parsing ambiguity and reserved `(internal)` shader sentinel findings were fixed with regressions before final Rust checks.
- First native aggregate run lacked the ignored pinned Core fixture; reused the existing local binary for synthetic integration tests and reran the complete suite. This does not constitute sidecar packaging or game acceptance.

Focused coverage includes scope changes, canceled/pending reads and writes, repeated saves, consent invalidation, malformed/mismatching catalog metadata, no-loader/error fallback, revision conflicts, preserved unknown IDs, resource order, and distinct config/installed/compatible states. Initial test-harness missing animation-frame setup was corrected before the aggregate pass; no failed run is counted as passing.

## Unavailable / pending acceptance

- Windows config reads/writes intentionally return unsupported until equivalent reparse-point-safe access is implemented; this is an implementation limit, not an environment test pass.
- OptiFine/unknown runtime activation contracts are not verified and no adapter is guessed. Iris/Oculus support is an explicit verified format adapter, not a universal version/runtime compatibility claim.
- macOS native compile/runtime, Windows native build, Tauri/WebView visual acceptance and real Minecraft resource/shader loading remain pending. Linux synthetic native tests do not establish those acceptances.
- Previous blocked browser-preview route was not retried or bypassed. Existing Vite >500 kB chunk warning is nonblocking and remains.
- Stage 7 is not declared fully accepted. Stage ordering and product acceptance gates are unchanged.
