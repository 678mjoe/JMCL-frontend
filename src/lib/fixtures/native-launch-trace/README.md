# Captured real native launch trace

These four files are byte-for-byte copies from JMCLCore commit
`0b3c8bd531947f3686203ab168817185d47bf2fd`, directory
`rust/compat/frontend_bridge/traces/native-launch-frontend-shape-20261106`:

- `raw.jsonl`: original native Session callback objects and returned
  Result/SessionError, plus fixture/session lifecycle observations.
- `normalized.json`: only recursive literal replacement of the owned temporary
  fixture root with `${FIXTURE_ROOT}`. Events, request IDs, PIDs, durations,
  RSS, native-directory nonces, ordering and all other fields are unchanged.
- `provenance.json`: exact capture source, file hashes, imported frontend module
  hashes, Core/native-child/test binary hashes, guard and execution result.
- `test-output.txt`: the one passed, zero failed, zero ignored native test.

`replay-pins.json` is frontend-owned metadata. It pins the provenance file and
records the inspected frontend base and Core source/artifact commits. At import,
all source hashes were checked against the captured clean Core source commit,
and the four copied files were compared against the Core artifact commit.

The clean source used for execution was
`b7b7b9abe5360054819ace0733599163feabe25f`; the later artifact commit adds
verification evidence and documentation. The native producer ran offline with
an inherited, explicitly selected `launch_network_guard` and mandatory guard
self-tests plus missing/successful benign-spawn gates. It executed a benign
native child, never Java or Minecraft. See the Core capture documentation for
that guard's limits and the separately retained original-guard failure.

The trace contains only deliberately fake request credentials:
`synthetic-access-secret` and `synthetic-session-secret`. The real Core redacted
both from started argv and child stdout/stderr before forwarding events. Never
replace these with real accounts or credentials.

`nativeLaunchTrace.test.tsx` verifies hashes and normalization, then consumes:

1. The normalized full request sequence through real CoreSession wrappers and
   the launch runner, including error/ping/close/reopen records.
2. The raw launch records through actual InstancesPage Launch clicks,
   TasksProvider and LogSheet. Raw paths retain their absolute form so normal
   Java preference validation runs unchanged. These paths are inert test data;
   no file at them is accessed. Request params/events/outcomes are not adapted.

Instance-list/account-refresh responses, scheduling and close operations in the
React replay are explicitly synthetic test scaffolding. Native same-session
retry/reopen comes from the upstream capture; TasksProvider legitimately opens
its own dedicated session for each replayed launch. This is request-level
frontend integration coverage, not a newly executed native session, Tauri IPC,
WebView/browser layout, real authentication, JVM/game or OS acceptance.

Full verification: `docs/verification/2026-11-06-native-launch-trace-replay.md`.
