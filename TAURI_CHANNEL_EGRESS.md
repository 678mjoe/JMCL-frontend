# Guarded Tauri Channel serialization outlet

This is a Linux x86_64 LP64 test-only candidate, not a production change. It overlays the frozen frontend `9c0fd81ce8109c1e35229560fee31308ca114ef5` and runs the frozen RustCore `bdd6cb3e55d69cb9e0e02037d251635e289207a8`.

The single ignored Rust test dispatches through `generate_handler!`, `core_open`, and `core_request`. The official `__CHANNEL__:731` argument is decoded by Tauri into a Channel. A `channel_interceptor` captures the original serialized response-body bytes, callback ID, label, and per-channel index. No direct call to `core_request` or replacement `Channel::new` is used. Session request `req-0` is the open handshake; the installation uses `req-1`.

The self-owned fixture has one nonempty file, an ordinary mrpack ZIP containing its manifest, and a preseeded SHA1 CAS object. Its only declared URL is `https://127.0.0.1:9/owned-fixture.txt`; no proxy is allowed. The command specifies one worker, zero retries, no CurseForge credentials, and no compact events. The test requires a cached file event with zero attempts, a completed progress event with zero transferred bytes, a terminal install summary, and matching CAS and installed bytes. It does not download or launch Java, a loader, a game, or a server.

Network isolation comes from the immutable reviewed `launch_network_guard.py`, not from trusting the cache or the URL. The runner first requires the full original guard selftest and both original private Rust spawn gates to succeed. The entire Tauri inventory and actual test executable run below the guard. The controller remains unfiltered and bounds each owned process group, adopts/reaps its descendants, and retains failure logs. Build and ordinary dependency preparation occur outside the filter.

Core constructs two HTTP clients before verifying the CAS. Any resulting socket syscall or any other unexpected SIGSYS in the actual candidate is a failure, not an expected negative control. A tool/environment denial is an infrastructure blocker. Neither permits weakening the filter, switching to an unprotected run, or silently retrying elsewhere.

## Boundaries

- The mock context, real `window.url()`, original ACL/capabilities, and wrong-origin rejection remain unchanged from the earlier command lane.
- This proves the Rust serialization outlet only if the single guarded test passes. It does not prove JavaScript delivery, eval/fetch, Channel end messages, callback removal, real WebView/React UI, complete production setup, production context, a shipping package, or other platforms.
- Captured bytes are printed after failures that return through `catch_unwind`. SIGSYS, timeout, or forced process termination can prevent an in-memory collector from being printed; absence of wire output in such a run is not proof that no events occurred.
- The interceptor consumes the captured messages. Channel drop/end uses mock eval rather than this interceptor and is not covered.
- No intentionally corrupted-cache or real cache-miss integration is run. Guard selftests are not a substitute for claiming that integration.
- Static checks and pure runner tests do not establish that the Tauri binary compiled or executed. Read the run's exact status, tested commit, complete guard gates, test count, hashes, raw logs, and cleanup results before accepting a run.

## Source provenance

The production Cargo manifest/lock and lib module overlay are derived from the public frozen frontend and the previously published opt-in command test. The test fixture and runner/workflow changes are generated specifically for this candidate. The guard and spawn gate are exact copies of the separately reviewed owned launch guard sources, pinned to SHA256 `2790712aaf757536329cc1ac87c73931f04bf1a1f6dc3f375f782db08423e719` and `77b2f1569434d5e0a7779e32f8dd6a66a7badddf9040dfccb9a5436679273767`. Evidence emission uses the previously published bounded lossless chunk helper. These files contain no account secrets, real user fixtures, production instance data, or user logs.
