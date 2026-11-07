# Production development context command contract

Status: **passed on Linux x86_64 with production development context and MockRuntime**.

Run https://github.com/678mjoe/JMCL-frontend/actions/runs/42398397584 completed successfully: exactly 1 test passed, 0 failed, 0 ignored, 83 filtered out. Execution commit `fec042a709774b4d3558f3609f853c53ce75158b`, tree `29da13cbd401c43c660d89b1736433e54176b2e8`, is distinct from the earlier dummy-context overlay.

This Linux-only test replaces the earlier dummy context with `tauri::generate_context!()` reading the frozen production `tauri.conf.json` and capabilities. It reads `window.url()` and requires equality to the unchanged configured development URL, http://localhost:1420/. It neither navigates nor substitutes a privileged URL. The original http://tauri.localhost rejection remains mandatory before any Core session can open.

Scope remains exactly one ignored unit test through MockRuntime, original generate_handler wrappers, and two real RustCore sessions: ping, unknown-method rejection and recovery, isolated close, idempotent close and Pool cleanup. Original production function bodies, capability files, config files and dependency versions are unchanged.

This is development context, not release context. The previously reviewed build-only `TAURI_CONFIG` override removes `bundle.externalBin` to avoid staging a production Zig sidecar. No other config override is introduced. It is therefore not a byte-for-byte unmodified build environment. It does not execute production plugin setup, actual WebView, JavaScript callback delivery, frontend routing, packaging, Java, account, game, archive or network business operations.

Frontend source: 9c0fd81ce8109c1e35229560fee31308ca114ef5, tree 48ea91981bdb7b375bca8e9bc47738b6c3dde4d1. Core source: bdd6cb3e55d69cb9e0e02037d251635e289207a8, tree 0e8e901bc587cf3c6d7dc1ba78821c4701785e20.

The isolated workflow `.github/workflows/tauri-production-context-linux.yml` is restricted to branch `tauri-production-context-linux-20261107` and exact fixture paths. It neither edits nor triggers the existing quality workflow. Native dependencies are installed from official Ubuntu 24.04 sources on the authorized standard runner. No local dependency installation is attempted.

The bounded runner retains exact inventory/pass-count checks, native ELF checks, before/after binary and source hashes, process-group and Linux subreaper cleanup, and bounded lossless evidence chunks. An added unique marker records the actual production development origin. Normal and optimized guard suites (9 tests each) and emitter suite (5 tests) pass locally. These are fake runner tests, not native acceptance.

## Verified result

The actual window origin was `http://localhost:1420/`, exactly matching the unchanged production development configuration. The `TAURI_PRODUCTION_CONTEXT` marker, the original remote-origin rejection with empty Pool, and the two-session completion marker each appeared exactly once. Source and binary rechecks and owned process-group cleanup succeeded.

All 14 emitted raw evidence files were reconstructed and verified against chunk and complete-file lengths/SHA256. The test log is 396 bytes, SHA256 `e19b6d433173917df98a06106f6418b1a39b8791d185067bfcad4161ac472682`. The RustCore binary SHA256 is `07fcbf083222fc48ec5491c2a7f60749739cee3c30e22ba3f82ae7332cc8b935`; the native Tauri test executable SHA256 is `873f3aa4a863f952a0d565fa316fc9f959bdee3e438d05b7d1aac4966ec64e0f`. No distributable executable artifact was uploaded. Cleanup is enforced by the runner; a separate PID ledger was not emitted.

See `docs/acceptance/tauri-production-context-result-20261107.json` for complete original raw evidence as base64 with per-file hashes, identities, exact counts and scope limits. These generated CI logs contain public runner paths, not user-computer diagnostics. Only the new branch-scoped workflow ran for the execution commit; the existing quality workflow and main were untouched. This result does not validate release/custom-protocol assets, real WebView or JavaScript events.
