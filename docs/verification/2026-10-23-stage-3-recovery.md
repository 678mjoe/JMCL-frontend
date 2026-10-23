# Stage 3 lifecycle recovery hardening — 2026-10-23

## Scope and environment

- Frontend base: `467acb9fed80ad570e747d1282b8e28361758444` (merged Stage 2 UX).
- This record accompanies the Stage 3 recovery commit; use the containing Git
  revision for the exact tested source. No JMCLCore binary was run or changed;
  contract reference: the base revision's `gui-handoff.md`.
- Cloud fallback: Linux x86_64, Bun 1.4.4. Existing installed lockfile dependencies
  reused from the isolated Stage 2 workspace; no tracked dependency changes.
- Owner-authorized development exception applies. This is frontend automated
  evidence, **not Stage 3 acceptance** and not a change to roadmap gates.

## Implemented and tested

- Log transport failures retire the failed session and pause polling. Explicit
  Retry deduplicates reconnects and resumes the last acknowledged cursor/file ID.
  Rotation still replaces old text. Close and source changes invalidate late
  reconnects; failed commands are never replayed. A command transport failure
  also invalidates a concurrent old log response.
- Physical target mutation exclusivity is independent of source revision and
  controller/provider lifetime; locks remain until action/session cleanup settles.
  Endpoint independence and revision-specific cache/visibility guards remain.
  Future server mutation entry points must use the same target coordinator, not
  introduce a separate lock keyed by view revision.
- Java missing/incompatible guidance uses fixed bilingual copy and distinguishes
  local Java from the runtime on the remote host. EULA guidance requires explicit
  acceptance via Install / Repair. Remote raw diagnostics remain hidden.

## Executed checks

Commands run with the workspace Bun binary on PATH:

| Check | Result |
| --- | --- |
| `bun run test` | **PASS**: 230 tests, 29 files, 1,440 assertions, zero failures |
| `bun run build` | **PASS**: TypeScript and Vite production build |
| `git diff --check` | **PASS** |

Vite retains the existing non-blocking warning for a main JS chunk above 500 kB
(approximately 731 kB minified). No Rust source changed.

Negative controls against original production implementations reproduced the
regressions before fixes: log suite 18 pass / 2 fail; mutation suite 17 pass /
3 fail; error-presentation suite 3 pass / 2 fail. Fixed suites and the aggregate
run above pass. Later added interruption/concurrent-read tests are included in
the final aggregate result, not in those original negative-control counts.

## Pending / not run

- Browser visual acceptance: pending. Prior isolated Vite preview was unreachable
  and escalated preview setup was denied before execution; that action was not
  retried or bypassed in this batch.
- macOS/Windows native Tauri/WebView, sidecar, keychain and packaged behavior:
  pending; corresponding native environments unavailable.
- Real SSH disconnect/reconnect and detached server persistence, Java/EULA
  behavior against core, installation/start/stop/restart/commands/deletion:
  pending separate approved host/workload scope. Fixtures do not establish these.
- No real accounts, SSH hosts, Minecraft workloads, security changes, paid
  services or release actions were used.
