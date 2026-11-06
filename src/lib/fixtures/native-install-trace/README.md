# Native install recovery trace fixture

These files are copied byte-for-byte from JMCLCore artifact commit
`a87c3afac372653acb0ca9bd1a92b0fc9a743a0d`, under
`rust/compat/frontend_bridge/traces/instance-recovery/`.
The capturing harness is committed at
`a64592885862b7a064f25b8019c350478b83d49d`; its exact guarded execution log
is stored with that upstream artifact as `capture.log`.

- `raw.jsonl`: observed request parameters, original native Session callback
  objects, returned results/errors, and harness lifecycle/fixture observations.
  “Raw” here means Session API data, not byte-for-byte Core stdout.
- `normalized.json`: the same 37 records / 28 requests after the single recursive
  string replacement documented in `provenance.json`. Only the temporary root
  becomes `${FIXTURE_ROOT}`. IDs, nonces, callback ordering, values and errors
  are unchanged.
- `provenance.json`: original/normalized SHA-256, capture-source hashes, executable
  hashes, unchanged frontend native-module hashes, and the normalization rule.

The capture uses the production Core RPC dispatcher and unchanged frontend
native Session over a local child process, with the dedicated syscall/exec/FD/IPC
isolation runner. Its payload is five synthetic bytes (`hello`), not a usable
JAR; no Java, archive extraction or network transfer is part of the scenario.
The producer's exact guarded test passed. This frontend test does not rerun it.

Relevant actual request sequences:

- 12: initial `blocked` manifest, installed=false.
- 13: cached execute, including real started/file/progress callbacks.
- 14: prepare fails with PREPARE_FAILED because of the owned canary.
- 20: a new Core process lists all three instances as installed=true, before retry.
- 21/22: actual execute/prepare retry succeeds after the owned canary is removed.
- 27: after removing `one`'s receipt, its installed flag is false; the others remain true.

`nativeInstallTrace.test.tsx` checks both hashes and derives the normalized tree
from raw records. It also checks the native-module source hashes before treating
this as a trace from the current frontend's unchanged native Session code.
Native source changes require provenance review or recapture, not silent removal
of that check.

The tests replay captured data through the real CoreSession request wrappers,
instance coordinator, TasksProvider, progress rendering and InstancesPage. The
request transport and close operation are test seams; wrapper parameters are
compared after normal JSON serialization omits undefined fields. Timing and interleaving
are deliberately controlled. Reusing a trace in multiple tests does not represent
new native executions. The page's unrelated account-list response is an explicitly
marked empty UI stub. Fixture actions are observations, not filesystem actions
executed by the replay.

This establishes captured-event consumption and frontend state behavior. It is
not live Tauri, native concurrency/close, WebView, account, game-launch or complete
installation acceptance. Page remount is not Core-process restart.
