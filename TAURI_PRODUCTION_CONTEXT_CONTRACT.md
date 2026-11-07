# Production development context command contract

Status: prepared, not yet executed. This is a new overlay, not the previously passed mock-context tree.

This Linux-only test replaces the earlier dummy context with `tauri::generate_context!()` reading the frozen production `tauri.conf.json` and capabilities. It reads `window.url()` and requires equality to the unchanged configured development URL, http://localhost:1420/. It neither navigates nor substitutes a privileged URL. The original http://tauri.localhost rejection remains mandatory before any Core session can open.

Scope remains exactly one ignored unit test through MockRuntime, original generate_handler wrappers, and two real RustCore sessions: ping, unknown-method rejection and recovery, isolated close, idempotent close and Pool cleanup. Original production function bodies, capability files, config files and dependency versions are unchanged.

This is development context, not release context. The previously reviewed build-only `TAURI_CONFIG` override removes `bundle.externalBin` to avoid staging a production Zig sidecar. No other config override is introduced. It is therefore not a byte-for-byte unmodified build environment. It does not execute production plugin setup, actual WebView, JavaScript callback delivery, frontend routing, packaging, Java, account, game, archive or network business operations.

Frontend source: 9c0fd81ce8109c1e35229560fee31308ca114ef5, tree 48ea91981bdb7b375bca8e9bc47738b6c3dde4d1. Core source: bdd6cb3e55d69cb9e0e02037d251635e289207a8, tree 0e8e901bc587cf3c6d7dc1ba78821c4701785e20.

The isolated workflow `.github/workflows/tauri-production-context-linux.yml` is restricted to branch `tauri-production-context-linux-20261107` and exact fixture paths. It neither edits nor triggers the existing quality workflow. Native dependencies are installed from official Ubuntu 24.04 sources on the authorized standard runner. No local dependency installation is attempted.

The bounded runner retains exact inventory/pass-count checks, native ELF checks, before/after binary and source hashes, process-group and Linux subreaper cleanup, and bounded lossless evidence chunks. An added unique marker records the actual production development origin. Normal and optimized guard suites (9 tests each) and emitter suite (5 tests) pass locally. These are fake runner tests, not native acceptance.
