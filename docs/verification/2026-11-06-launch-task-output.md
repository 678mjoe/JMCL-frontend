# Launch task ownership and UTF-8 output — 2026-11-06

## Scope

- Frontend base: `7b1a60e1d5053501332a92c14299f1f7a4ca3e5f`. The containing commit identifies the fix.
- Environment: Linux x86_64, Bun 1.4.4. Dependencies installed with `bun install --frozen-lockfile` from the existing cache; the lockfile is unchanged.
- Frontend-only changes. No Core revision was executed. Protocol output is represented by synthetic events, including a 16,384-byte record boundary inside a UTF-8 character.
- No roadmap, acceptance-gate, CI, native, packaging, release or dependency changes.

## Confirmed defects and fixes

1. `TasksProvider` stays mounted when the instance root changes. Existing manifest/auth scope guards did not scope launch tasks: root A's `demo` and root B's `demo` shared the same key, PID, log and running state. Install and launch tasks now use the normalized root plus instance ID. Creation, list/detail lookup, LogSheet lookup and deletion cleanup use that identity. Unscoped lookups/clears cannot match a scoped launch.
2. Launches now capture the root/store and launch arguments before opening the dedicated asynchronous session. A synchronous per-instance guard prevents repeated clicks from replacing an active task, including while session opening is pending. Different roots remain independent. Clearing a running task hides its state but does not release its launch guard or cancel its process. Success, RPC failure and open failure release the guard.
3. Output previously decoded every base64 record independently, corrupting UTF-8 sequences split across records. Each launch now owns independent stdout/stderr streaming decoders. Newline/EOF finalize the affected decoder; EOF flushes that stream immediately. RPC success/failure finalize both decoder tails and text buffers without duplicate output. Events arriving after request completion are ignored, including PID, progress and diagnostic callbacks that could otherwise alter a replacement task.

## Reproduction and verification

Before fixes, the new synthetic regressions failed as expected:

- Task ownership suite: 5 failed / 1 passed. Confirmed duplicate opens, cross-root lookup and late callbacks altering replacement tasks.
- List/detail scope suite: 2 failed / 6 passed. Both pages retained a disabled Launch button after switching roots with the same instance ID.
- Launch runner suite: 5 failed / 2 passed. Confirmed split UTF-8 damage, delayed EOF output, truncated-tail handling and accepted late callbacks.

Final checks on the complete source:

- `MODE=test bun test src/lib/launchTasks.test.tsx src/pages/InstancesPage.scope.test.tsx src/lib/launchRunner.test.ts src/lib/logBuffer.test.ts`: **23 passed, 0 failed, 97 assertions**.
- `bun run test`: **583 passed, 0 failed, 3,808 assertions across 78 files**.
- `bun run build`: **passed**, including TypeScript checking and Vite production build.
- `python3 scripts/test-verify-ci-package.py`: **5 passed**; synthetic header/hash checks only, no package or binary execution.
- `git diff --check`: **passed**. No frontend formatter is configured; Rust was unchanged.

The first build caught a test selector typed as a generic Element without `click`; the selector was corrected and full tests/build rerun. Early UI test setup also needed the existing Happy DOM animation/observer globals before reproducing the actual scope failure. These setup/type errors are not counted as passing verification. Vite's existing >500 kB main-chunk warning remains nonblocking.

## Boundaries

No Java, Core, Minecraft, network service, game installation, archive workload, native Tauri test, browser E2E server or packaging command was run. Browser E2E and native platform checks remain unrun. These regressions establish frontend state and byte-decoding behavior under synthetic events, not a successful real game launch, native UI acceptance, or complete frontend/Core integration.
