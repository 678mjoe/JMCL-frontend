# Real native launch trace consumed by the frontend

## Revisions and provenance

- Frontend base: PR28 head `f3d67b668680804c55b77a5154f17e6343b7cc30`, tree
  `48ea91981bdb7b375bca8e9bc47738b6c3dde4d1`, including the blank-log-line fix.
- Isolated local branch: `test/native-launch-trace-replay-20261106`.
- Producer clean source: Core `b7b7b9abe5360054819ace0733599163feabe25f`.
- Capture artifact commit: Core `0b3c8bd531947f3686203ab168817185d47bf2fd`.
- Executed production Core SHA-256:
  `dad858d76f05cc4fad65814b03790a83e02e9244c5fa1d3155f882b89c1fd1f5`.
- Raw trace SHA-256:
  `e87118512ff5a7d7da2fcad6652fb3f788108bf4f0abfed019ed572158a34e3c`.
- Normalized trace SHA-256:
  `f117361e6a1222de3f169b706edb11fd937b8813a0d8b4d3a006e4815bec5c34`.
- Provenance SHA-256:
  `335d1d70a1f47be11c42fcf92b40ea77743587fa7f8f47b0cc6777dc92330597`.
- Replay host: Linux x86_64; Bun 1.4.4; Vite 8.1.5.

The producer executed the real unchanged native frontend Session/transport
modules, the production Rust Core and an owned benign native child. The three
native modules in this frontend still match the capture's original frontend
`c0107f1803c73398a99f8ddd27ed712c0ed2e1b4` and compared main
`90b9d5472e620255af740b55315e2cf75c1c9115`. The test checks their file hashes.
At import, every producer source hash was checked against the clean capture
source commit, and all four captured files were compared byte-for-byte with the
artifact commit.

The final authentic capture uses the frontend's ordinary
`instances/demo/.minecraft` path and exact generated request fields. No request
adapter was introduced. The earlier producer capture remains separately
preserved in the Core evidence package; it is not silently rewritten here.

## What is replayed

`src/lib/fixtures/native-launch-trace/` contains 12 records, including seven
requests. The original order is:

1. Session 1 opens; a missing explicit override returns `JAVA_NOT_FOUND` with
   no launch events.
2. A launch returns exit 7, then ping succeeds.
3. A second launch returns exit 0; the session closes; ping returns
   `SESSION_CLOSED`.
4. Session 2 opens; a launch returns exit 0; ping succeeds; it closes.

Each successful launch contains one started event, six stdout events and two
stderr events. The captured native test itself also checked process reaping,
owned native-directory cleanup, inherited guard and filtered environment.
Those are producer assertions, not new frontend or GUI execution claims.

The fixture boundary is serialized native **Session API callbacks and returned
Result/SessionError**, not byte-for-byte Core wire capture. The native Session
has already removed terminal wire envelopes. Only fixture-root literals are
normalized; the test reconstructs that normalization and checks equality.

## Frontend verification

Three tests use production frontend code, with no production changes:

- Integrity and normalization: provenance, raw/normalized hashes, exact native
  source module hashes, record inventory, genuine split UTF-8 bytes and exact
  empty newline frame.
- Full normalized request replay through CoreSession and `runLaunchRequest`:
  all captured requests/outcomes, missing-override error, nonzero/zero results,
  ping, closed-session error, new replay session on recorded reopen, started
  PID/redacted argv and complete decoded stdout/stderr lines.
- Actual InstancesPage Launch clicks through TasksProvider and LogSheet:
  raw params/events/results are checked unchanged at the CoreSession request
  seam. Missing-override error releases the task for retry; successful calls
  remain running until their terminal result, close once, and re-enable Launch.
  Exit 7 stays a successful RPC result displayed as `Exited with code 7`, not
  an RPC failure; exit 0 is displayed separately.

The UI path checks the 36,384-character line assembled from two `more` frames
and a newline frame, preserving its split `中` without replacement characters.
It also checks the distinct blank stdout row and its `min-h-5` class, redacted
stdout and stderr, stderr styling, and the binary EOF row (`NUL` plus U+FFFD for
invalid UTF-8). Closing/reopening the actual LogSheet while running and after
completion preserves all six rows and terminal status without creating another
launch. These are DOM/class assertions, not browser pixel-height assertions.

The UI instance list and synthetic account refresh are explicitly labeled
scaffolding. They return only the fixture manifest and fake auth values and use
the existing in-memory credential mock. No real authentication or credential
store is exercised. Raw absolute temporary paths are inert replay data, never
accessed. TasksProvider opens a dedicated replay session for each launch, as it
does in production; same-native-session recovery and native process reopen are
producer evidence and full-sequence request replay, not UI native I/O.

## Commands and results

Commands from the isolated frontend checkout, using the already available Bun
and dependency tree (no dependency install or network access):

```sh
MODE=test bun test ./src/lib/nativeLaunchTrace.test.tsx
bun run test
bun run build
git diff --check
```

- Focused: 3 passed, 0 failed, 251 assertions.
- Full frontend suite: 594 passed, 0 failed, 4,089 assertions, 80 files.
- TypeScript and production Vite build: passed. Existing large-bundle warning
  remains; no production bundle splitting was changed.
- Diff whitespace check: passed. A fixture-local attribute preserves the original
  captured test output's final blank line without rewriting evidence.
- Independent read-only review: approved with no concrete issues found.

The first build identified test-only TypeScript type narrowing issues; they
were corrected before the final focused/full/build run.

## Explicit boundaries

This is captured real-event request-level frontend integration, not a live
Tauri/WebView bridge or GUI game launch. The replay starts no Core process,
benign child, Java/JVM or game, makes no network request, and uses no real
account. It does not establish Java acquisition, runtime/archive/loader
compatibility, running-process cancellation, keychain behavior, native browser
layout, or macOS/Windows acceptance. The known local Chromium socket EPERM was
not retried or worked around. No native build, remote write, merge, release or
roadmap acceptance change is included.
