# Actual Tauri command / RustCore contract candidate

Status: **revision 2 is prepared and not yet executed**. The first real Linux CI
attempt compiled the actual Tauri crate and ran exactly one test, which failed at
its first IPC request because the fixture supplied the wrong platform origin.
The original rejection and its evidence are retained below. The authorized
revision preserves that denial as a negative control and reads the actual
MockRuntime window URL for normal requests. It is pending final review/retry.

The local workspace still lacks GTK/WebKit/JavaScriptCore/libsoup/DBus pkg-config
packages; nothing was installed locally. The first standard Ubuntu CI runner did
successfully install those official dependencies. Existing UI/package coverage
remains separate from this command-layer test.

## Exact scope

Frontend baseline `9c0fd81ce8109c1e35229560fee31308ca114ef5`
(tree `48ea91981bdb7b375bca8e9bc47738b6c3dde4d1`). RustCore baseline
`bdd6cb3e55d69cb9e0e02037d251635e289207a8`
(tree `0e8e901bc587cf3c6d7dc1ba78821c4701785e20`).

The opt-in unit test stays in the actual src-tauri crate and dispatches the
original `core_open`, `core_request`, and `core_close` command wrappers through
`tauri::generate_handler!`. It creates real SessionPool, Diagnostics, and
PackActivationState state, with the real local process transport and an explicit
absolute RustCore executable. Tauri 2.12.5's MockRuntime supplies app/window/IPC
objects. No production function body or dependency version changes.

Two sessions must have distinct nonzero IDs and matching pool membership. Each
must return ping, reject an unknown method with METHOD_NOT_FOUND, and then return
ping again. Closing the first must remove its pool state, reject further requests
with SESSION_CLOSED, and leave the second usable. The second is closed twice to
check idempotence; pool membership must be empty. Assertion failures still call
pool.clear(). The parent runner enforces an independent deadline and reaps only
its owned process group, including on hung invoke/cleanup paths.

This does **not** validate a real WebView, JavaScript Channel callbacks, frontend
routing, production app/plugin setup, a packaged application, Java, accounts,
network, game/server launch, or archive operations. Channel parsing participates
in command argument decoding; no JS event delivery claim is made. Linux x86_64 is the
only supported runner host; do not extrapolate to four-platform acceptance.

## Invocation (revision 2 not yet executed)

Use a permitted Linux x86_64 host with all native build dependencies and a complete
Cargo cache. Supply a separately verified RustCore artifact and its SHA-256:

```
python scripts/test-tauri-rust-core.py \
  --core-source /absolute/path/to/pinned/JMCLCore \
  --core-binary /absolute/path/to/verified/jmcl-core \
  --expected-core-sha256 VERIFIED_ARTIFACT_SHA256 \
  --output /absolute/path/to/new-evidence-directory
```

The runner refuses other source HEADs and hash mismatches, records source trees,
fixture and test binary hashes checked before and after execution, host/rustc metadata and raw logs with byte counts and SHA-256, and requires
exactly one listed test and one passed test. It runs `cargo test --offline
--locked --lib --features tauri-rust-core-contract --no-run` before executing only
the one ignored acceptance test. Cargo compilation includes the crate's other
unit-test code, but no other tests execute. Timeout limits are 900 seconds for
compilation, 60 seconds for the one test, and 10 seconds for metadata commands.
It overrides only the test build's externalBin config to avoid staging any
production Zig sidecar. Production Tauri defaults remain enabled.

The binary/source association is caller-provided provenance, not proven by
recording a source HEAD beside a binary hash; retain the prior verified artifact
manifest or build the RustCore from that clean pinned tree. Missing cache entries
are a blocker, not permission to download or run unrelated build steps.

## Next verification gate

Finish independent review of revision 2, then repeat only this test through the
already-authorized isolated Linux lane. Do not alter existing CI, main, the
production sidecar pin, or claim real UI/package acceptance from the result.

`docs/acceptance/tauri-rust-core-linux.yml.example` is an inactive example. The
active branch-scoped workflow is `.github/workflows/tauri-rust-core-command-linux.yml`.
Its initial revision was published and executed in run 42394126182. The updated
revision shown here, including the chunked evidence emitter, is not yet run.

Guard validation: nine pure/fake Python tests pass, including zero/multiple test
inventories, missing/duplicate marker, wrong binary hash, production source drift,
nonzero/invalid UTF-8 output, timeout raw bytes with an owned child, parent exit
with a surviving child, and cleanup failure evidence preservation. These are
runner tests only, not execution of Tauri or RustCore. The runner also verifies
all tracked src-tauri inputs against the frozen baseline plus the exact allowed
test additions, clears inherited JMCL/cross-target flags, checks native ELF64
x86_64 artifacts, and requires the test executable inside its new target dir.
The example template prints lossless base64/length/hash evidence. The separately
authorized active candidate `.github/workflows/tauri-rust-core-command-linux.yml`
is restricted to the exact `tauri-rust-core-command-linux-20261107` branch and
fixture paths, and reads the immutable `github.sha` overlay after checking its
nine-entry SHA-256 manifest (the initial run used seven entries).

## First real CI attempt and authorized fixture correction

Run https://github.com/678mjoe/JMCL-frontend/actions/runs/42394126182 compiled
the actual Tauri crate successfully, listed exactly one test, then failed that
one test at the first IPC request: `core_open not allowed. Plugin not found`.
The immutable initial execution commit was
`cca42c8d8a987384414a59f9457fa18d8698da4b`, tree
`89853ac6f659373c65c5feb1dcd6a0667136df34`. No Core session was opened.
The original 581-byte test log SHA-256 is
`debb4b4d0f0df7e1cf65ea0100601d828f537136ab020c41e68d900b4d42bc39`.
The native test exited 101, without timeout or leftover owned processes.

Read-only review of Tauri 2.12.5 proved the fixture's hardcoded
`http://tauri.localhost` was a remote origin on Linux, whose actual MockRuntime
window uses `tauri://localhost`. The ACL rejection was correct, and was retained.
It was not a RustCore error or a missing production plugin. Production ACLs do
not authorize that remote origin; loading production config alone would not fix
this fixture error.

The explicitly authorized correction reads the actual window URL through
`window.url()`, asserts its Linux local scheme/host and absence of credentials
or port, and does not navigate or change any config/permission. Before the same
two-session lifecycle, it retains the original remote request as an explicit
rejection negative control and requires an empty Pool. Both negative-control
and completion markers are required. No ACL is disabled or expanded and no
command is replaced by a direct Rust function call. This revision is pending
independent review and execution, not yet an acceptance pass.

Evidence emission is separately changed to 12 KiB raw-byte chunks with explicit
group/file/index/count, per-chunk and full-file lengths/SHA-256, report/test first,
and a two-minute step timeout. Missing groups, oversized files or symlinks fail
explicitly after emitting other available evidence. The first run's complete
raw evidence was recovered and hash-verified; its large-line output delay is
recorded separately from the functional test failure.
