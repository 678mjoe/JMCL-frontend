# Guarded Tauri Channel outlet: passed

The only execution run completed successfully on Linux x86_64:
https://github.com/678mjoe/JMCL-frontend/actions/runs/42399164806

- Execution commit: bcf7efbfac0843c3f5ae3e0aed4c859f32857bdc
- Execution tree: f1367e2c0bb1f7b548610e343fbc3f934e062ead
- Branch: tauri-channel-egress-linux-20261107
- Job: 128482992387; run attempt: 1
- Frozen production frontend: 9c0fd81ce8109c1e35229560fee31308ca114ef5
- Frozen Core: bdd6cb3e55d69cb9e0e02037d251635e289207a8

## Verified runtime result

Exactly one ignored, exact-name Tauri test was selected and passed. Both inventory and the actual executable ran under the unchanged pinned network guard. The complete original selftest and both original private Rust spawn gates passed before either Tauri invocation; their expected stdout and empty stderr were verified. The controller used isolated stdin, file-backed stdout/stderr, owned process groups and subreaper cleanup. All 13 recorded phases exited zero without timeout; each phase recorded PID=PGID and empty group membership before and after cleanup.

The original command dispatcher opened the real Core, preserving the actual mock window URL and wrong-origin rejection. A single-file cached mrpack install emitted two messages through the official Channel decoding/serialization/interceptor path:

1. Callback 731, index 0, label main: lowercase SessionEvent envelope, inner request req-1, cached file mods/owned-fixture.txt, size 35, attempts 0. Placement happened to be hard_link; the assertion did not require that platform-dependent choice.
2. Callback 731, index 1, label main: progress 1/1 files completed, 35 bytes verified/processed/total, zero bytes transferred.

The terminal invoke result reported one installed file, no skipped files, no overrides and no loader. CAS and installed file bytes both exactly matched the owned 35-byte payload. The session pool was empty after close. Source, guard, spawn source and binary hashes matched before and after execution.

Binary SHA256 values:

- Core: 07fcbf083222fc48ec5491c2a7f60749739cee3c30e22ba3f82ae7332cc8b935
- Tauri test: 4b18266e957d25f9ee729d9d48f542ac42c044ff3d9341842e8f8c331dc07ce2
- Private spawn gate: 8b0a1519448bb281921f52a1a477c94ccc4af0d619045c3f54e7ee49d3a1bcee

The workflow built the Core from a clean frozen checkout. Its build log, empty status file, source references and binary checksum are preserved, rather than inferring provenance from a nearby source folder.

## Evidence and limits

All 44 emitted evidence files were reconstructed from 65 bounded chunks. Chunk order, uniqueness, byte counts, per-chunk SHA256 and complete-file SHA256 were verified. Original stdout/stderr bytes are preserved in the adjacent raw-evidence.json as base64 chunks, with each chunk index, length and SHA256 plus the complete-file length and SHA256 for reconstruction. The source was the connector-decoded outer Actions job log, retained locally under the name ci-job-decoded.log; that outer framing is not claimed to be a byte-perfect download and is not included in this three-file documentation commit. Binary hashes were recorded inside the runner; no distributable executable artifact is included.

This establishes the guarded Linux Rust Channel serialization outlet only. It does not establish JavaScript/WebView delivery, Channel drop/end, callback removal, React UI, production context/setup, shipping packages, other platforms, or a real corrupted-cache/cache-miss integration. The collector's post-panic printing applies only to failures returning through catch_unwind; forced termination can prevent printing in-memory captures. Phase process-group observations are not a complete per-Core-child lifecycle ledger. An extreme raw-log hash I/O error may prevent a phase JSON from being written, while the runner still fails and preserves the overall report where writable.
