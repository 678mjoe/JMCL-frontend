# Preserve empty launch log lines — 2026-11-06

## Scope and source evidence

- Frontend baseline: `90b9d5472e620255af740b55315e2cf75c1c9115`.
- This corrects an existing output-reconstruction gap, not a regression introduced
  by the recent UTF-8 decoder change. `logBuffer.ts` and its tests are unchanged
  between the available `9dc0b25` baseline and `90b9d547`; this shallow checkout
  does not establish the original introduction commit.
- Pinned Zig Core `5a4310debbcee26b3d2391bab2339f79cd6ec52e`,
  `src/launch/process.zig`'s `Framer.feed`, emits one `newline` record for each
  delimiter and removes that delimiter from the payload. An empty payload with
  `end: "newline"` therefore represents an actual empty line.
- Experimental Rust Core `a87c3af` has the same behavior in
  `rust/src/launch/process.rs`. Its existing `rust/tests/launch_process.rs`
  explicitly asserts an empty stdout newline record. These are source and
  existing fixture references, not new Core execution evidence.
- No documentation or test found in the available frontend history specifies
  intentional blank-line filtering. The original `if (tail)` discarded those
  records while retaining blank lines embedded inside a payload.

## Change

The line buffer now distinguishes `newline`, `eof` and `more`. A delimiter-free
newline completes a line even when empty. EOF flushes only existing text, and
the final decoder flush still uses `more`, so empty EOF/finally operations do
not invent lines. Existing payload-embedded LF/CRLF behavior is retained without
adding a duplicate ending. Streaming UTF-8 decoder ownership/reset is unchanged.

Log rows have a minimum height matching the existing `leading-5`, so a preserved
empty row does not collapse. The browser Mock launch emits a Core-shaped blank
newline and empty EOF; it does not execute a game, Java or Core.

## Local verification

Linux x86_64, Bun 1.4.4. Locked dependencies were copied into this independent
worktree from an existing dependency tree with an identical `bun.lock`; no
dependency or lockfile changes were made.

- Before the production changes, the expanded buffer/runner tests reported
  **6 failed / 10 passed**. This included the missing explicit buffer EOF API
  as well as lost standalone blank lines; the old runner already flushed EOF.
- Focused buffer, decoder and React DOM Mock tests:
  `MODE=test bun test src/lib/logBuffer.test.ts src/lib/launchRunner.test.ts src/components/LogSheet.test.tsx`.
  **17 passed, 0 failed, 52 assertions**.
- Full frontend suite: `bun run test`: **591 passed, 0 failed, 3,838 assertions
  across 79 files**.
- TypeScript and production bundle: `bun run build`: **passed**, with the existing
  bundle-size warning. The generated stylesheet contains the `min-h-5` rule;
  this is not a rendered-layout assertion.
- Browser Mock command attempted:
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium bun run test:e2e`.
  All six scenarios stopped during Chromium startup, before application actions
  or assertions. Chromium reported `process_singleton_posix.cc: socket() failed:
  Operation not permitted`, along with a Crashpad database error. No environment
  restriction or browser security setting was bypassed.

The focused suite checks standalone/consecutive blank records, a partial line
completed by empty newline, independent stream EOF, repeated empty EOF,
payload-embedded line endings, successful/failed RPC cleanup, and truncated
UTF-8 followed by a real blank line. The React DOM Mock checks retained row
contents, the minimum-height class, terminal status, and closing/reopening
without a second launch or duplicate rows. Happy DOM does not validate layout.
The added browser test checks actual row height and close/reopen behavior when
run in a supported browser environment; that validation has not run locally.

## Boundaries

No new live NativeSession launch trace was captured. The separate attempted
native launch lane is blocked by its existing process-isolation restrictions;
it is not used as evidence for this frontend fix. No production Core source,
sidecar pin, task identity, launch policy, account flow, native IPC, installation,
archive handling or cancellation semantics changed. Native Tauri/WebView,
real game output and rendered browser layout remain unverified. No remote
repository write, release or package publication is part of this change.
