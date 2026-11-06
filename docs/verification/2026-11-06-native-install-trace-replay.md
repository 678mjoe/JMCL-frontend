# Captured native install recovery → frontend replay — 2026-11-06

## Sources and scope

- Frontend base: `974eec46ab536768457cbcb0121dc2a9afde8f96`, tree `b46c4d262e8bc91463376dffa033d56eba1d9f18`.
- Replay environment: Linux x86_64, Bun 1.4.4. Existing locked dependencies were installed with `bun install --frozen-lockfile`; the lockfile is unchanged.
- Real Core/native Session trace producer: JMCLCore source commit `a64592885862b7a064f25b8019c350478b83d49d`; captured artifact commit `a87c3afac372653acb0ca9bd1a92b0fc9a743a0d`. The producer ran its isolated cached-instance chain successfully and recorded the actual prepare error and successful retry. Core and capture-binary SHA-256 values are retained in fixture provenance.
- This change is test-only: one test file, byte-identical copied trace/provenance, and documentation. No production, CI, native, dependency, roadmap or acceptance-gate changes.

See [fixture provenance and replay boundaries](../../src/lib/fixtures/native-install-trace/README.md).

## What the tests establish

1. Captured cached-file events pass unchanged through the real CoreSession request wrapper into TasksProvider and actual progress rendering. They display verified cached progress with 5 processed bytes and 1 completed file; the captured result separately confirms 0 transferred bytes. The task remains running at 100% download completion and during prepare; old download detail is cleared before prepare.
2. The captured PREPARE_FAILED result becomes an error task, and the provider closes its dedicated replay session after the prepare terminal. Repeated calls during asynchronous open, execute and prepare do not admit duplicate task sessions. The guard releases after failure, allowing the separately captured real retry sequence to finish successfully.
3. Artificially interleaved replay of two real per-instance traces leaves the other task's progress, running state, close count and duplicate guard intact when one prepare fails. This is a frontend isolation assertion, not evidence that the source capture was concurrent.
4. The same TasksProvider retains the failed task while the actual InstancesPage mounts and remounts. The captured authoritative list renders `blocked` as installed/Launch while retaining PREPARE_FAILED. A later captured list, after real owned-receipt removal, changes `one` to Not installed/Install without changing the other instances. Task success/failure is not substituted for Core's `installed` value.
5. Fixture checks verify the raw and normalized SHA-256, all 37 records / 28 requests, the exact root-only transform, distinct initial/retry native sessions, and the unchanged native-source hashes.

The replay seam strictly compares actual wrapper method/parameters with captured requests, preserves callback order, refuses to skip events before the terminal, and records close ordering. Native Session callback data are the capture boundary, not raw stdout wire bytes. Request execution, close counting, gates and concurrency scheduling are test controls; the account-list response needed by the page is an explicitly marked unrelated UI stub. No automatic post-success refresh or Launch-button action is asserted.

## Executed checks

- `MODE=test bun test src/lib/nativeInstallTrace.test.tsx`: **4 passed, 0 failed, 90 assertions**.
- `bun run test`: **587 passed, 0 failed, 3,898 assertions across 79 files**.
- `bun run build`: **passed**, including TypeScript checking and Vite production build.
- `git diff --check`: **passed**. No frontend formatter is configured; Rust is unchanged.
- Independent read-only reviews confirmed fixture identity, request matching, event provenance, cleanup and retained-task page-remount semantics.

The first build found a generic assertion type mismatch in the normalization test (`unknown` versus the typed record array). It was corrected at the assertion boundary and the complete tests/build were rerun. No failed run is counted as passing evidence. Vite's existing >500 kB main-chunk warning remains.

## Not executed by this frontend slice

No Core, Java, Minecraft, network service, archive extraction, game installation, native Tauri build or browser E2E server was executed. The separate producer's guarded Core capture is cited rather than claimed as a new frontend live run. The replay does not establish native queue/close behavior, live Tauri UI integration, cross-platform native behavior, rendering acceptance or successful real game launch.
