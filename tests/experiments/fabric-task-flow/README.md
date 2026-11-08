# Synthetic Fabric TasksProvider experiment

This source-and-evidence snapshot records a successful local experiment using the original React `TasksProvider`, `LauncherContext`, `useTasks`, `CoreSession` typed methods and install reducer against real Rust Core subprocesses. Only session opening/closing and IPC transport were supplied by the test.

**This is not a turnkey replay package.** The published harness changes only four imports to repository-relative source paths. That adapted entrypoint has not undergone another business run. The results below belong to the original frozen harness, whose SHA-256 is recorded in `evidence/summary.json`. No production source or CI configuration is changed.

## Recorded contract

1. A synthetic instance had an already selected Fabric loader and a deliberately mismatched cached `inheritsFrom`. Original `startValidate` received real Core `VERSION_RESOLUTION_FAILED`, committed an error task and closed its session. No installation followed that failure.
2. Only the owned profile cache parent and freshness timestamp changed. The same mounted provider retried validation on a fresh session and succeeded.
3. Original `startInstall` called `install.execute` then `install.prepare`. A held-open promise barrier proved that a concurrent duplicate call opened no additional session or RPC.
4. Repeating installation after completion opened a new session and succeeded, demonstrating release of the provider's private in-flight key. Both inert client/library files were read-only CAS hardlinks with matching bytes and SHA-1. Receipt identity and bytes were unchanged.
5. A fifth, fresh Core session called `instance.get` and `instance.list`, reading `installed=true`, `version_id=synthetic` and `fabric_loader=0.0.0-owned` from disk.

Counts were resolve 2, execute 2, prepare 2, get 1, list 1. All five sessions exited zero and drained output. There were four cached file events, each attempts=0 and hard_link, zero downloads or transferred bytes, and no retry, Java or processor events. Sixteen committed React snapshots were recorded via `useLayoutEffect`; `act` awaited asynchronous work and genuine event updates used `flushSync`.

Snapshots show validation error→success and installation running/download→success with `task.stage.prepare`. **No separate prepare-running render was observed.** Both prepare RPCs are evidenced in stdout; preparing-state UI is not claimed.

## Exact scope

The fixture contains a fresh official metadata cache, a synthetic base version, a nonempty synthetic Fabric profile with explicit library SHA-1/size, an owned instance manifest, and two inert text blobs totaling 84 bytes. The files have JAR-shaped names but are not archives or real Fabric/game distributions. The profile has no assets/native archives or processor chain. No Java or game is executed.

This is a local React/ReactDOM/happy-dom test container, not a browser acceptance test. It does not cover native `Session`, Tauri IPC, WebView, packaged GUI, original `LauncherProvider` initialization, loader catalogue HTTP, `CreateInstanceDialog`, real providers/accounts, real Fabric distribution, Java, game launch, or application restart. The instance manifest is preseeded; creation is not tested.

Core errors naturally contain code/message, not the native transport's kind field. Frozen frontend `src-tauri/src/session.rs` serializes `SessionError` with `kind` and maps Core errors to `SessionError::Rpc`. The harness emulates that wrapping using the original `RpcError` with kind=rpc and unchanged code/message. This is not execution of the native session implementation and not a Core error-wire defect.

## Published evidence and provenance

- `evidence/session-1.stdout.jsonl` through `session-5.stdout.jsonl` are **unchanged raw Core stdout bytes**, containing only synthetic fixture data. Their hashes are recorded in the summary.
- `evidence/committed-states.json` is a clearly labeled derived projection of the real committed snapshots. It keeps only task kind/status/stage/message/progress/installProgress and omits filesystem-scoped keys, instance directories and unrelated fields. It does not invent snapshots.
- `evidence/summary.json` is a new path-free report of verified facts, not an original runner log.
- `task_flow.tsx` retains all successful assertions; its only change from the tested source is four import prefixes from the source staging layout to `../../../src/lib/`.
- `seed.py`, `stdio_relay.py`, `run_owned.py`, `stdio_relay_probe.ts` and `relay_fixtures.py` are unchanged generated test helpers from the successful execution.
- `source-lock.json` identifies public upstream commits/blobs, guard/probe hashes and observed dependency versions. It is not the full local execution lock.

No raw stdin requests, original absolute-path state keys, PID/supervisor records, absolute-path pin map, environment records, binary, archive or node_modules contents are published. No private identity, account, credential or actual user instance is used by this fixture.

## Reproduction requirements and limits

Source commits are frontend `9c0fd81ce8109c1e35229560fee31308ca114ef5` and Core `bdd6cb3e55d69cb9e0e02037d251635e289207a8`. Observed tools were Rust/Cargo 1.99.1, Bun 1.4.4, React/ReactDOM 19.2.7, happy-dom 20.14.5, ws 8.21.3 and Tauri API 2.12.4. Obtain matching source, dependencies and trusted tools separately; these files do not install or download anything.

The original full gate launcher and its 816 absolute-path input map are deliberately not published. Therefore this snapshot preserves inspectable logic and raw evidence but does **not** claim one-command reproduction or complete environment reconstruction. The fixed guard and spawn probe come from the pinned public Core checkout, not this directory. A future replay needs a separately reviewed launcher and local source/tool/dependency hashes. Merely running `task_flow.tsx` directly skips required gates and is not equivalent to the recorded experiment.

Any equivalent replay must preserve this order and boundary:

1. Verify source/tool/dependency bytes before execution and again afterward. Prepare a fresh owned output directory; do not overwrite prior evidence.
2. Check the byte relay's child FD 0/1/2 are FIFOs with the supplied fstat probe. Bun's `pipe` stdio may actually be sockets.
3. Run the unchanged Core guard's complete selftest, then both success/missing controls from the unchanged compiled spawn probe. Do not skip or weaken the guard.
4. Seed only after those gates, so the metadata/profile cache remains fresh within its 600-second TTL.
5. Run the harness under an owned process-group/subreaper supervisor, with a 90-second business limit. Its five arguments are the new owned fixture root, built Core executable, fixed guard, Python executable and byte relay. Core itself must always be launched through the relay and guard.
6. Drain stdout/stderr before close, verify ECHILD/no_children and no remaining owned process group, check all assertions and final hashes. Stop on any failed gate, unknown cleanup, import failure, hash change or network/cache failure; no automatic fallback or unguarded retry.

Only Core and descendants are kernel-network-confined by the guard. Outer Bun, Python relay, happy-dom and build tools are not. The harness makes no network request, navigation or resource loading; happy-dom still contains unused network capabilities. This is not hostile-code or filesystem confinement.

The recorded run passed all six gates and all 816 before/after pins; every supervisor confirmed cleanup. Those are prior execution facts, not a claim that this later publication entrypoint was rerun. No remote service, CI run, workflow dispatch or pull request is part of this experiment.
