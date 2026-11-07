# Actual Tauri command / RustCore contract candidate

Status: **prepared, not compiled or executed**. Local Linux host is missing
`gtk+-3.0`, `webkit2gtk-4.1`, `javascriptcoregtk-4.1`, `libsoup-3.0`, and `dbus-1`
pkg-config packages. No local dependencies were installed and no alternate local environment was
used. A separately authorized standard Linux CI lane is prepared pending review;
no CI has yet been triggered. Existing Tauri compile/unit/LocalRPC/package
coverage is separate evidence, not validation of this new test.

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

## Prepared invocation (not executed)

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

Independent review, then compile and execute this one test on an authorized host
with the listed dependencies. If using CI, prepare a separate opt-in bounded job
with an artifact manifest and this exact filter; obtain the required authorization
before any remote write or workflow dispatch. Do not alter existing CI, main,
production pin, or claim real UI/package acceptance from this result.

Prepared CI template: `docs/acceptance/tauri-rust-core-linux.yml.example`.
It is deliberately outside `.github/workflows`, installs official Ubuntu native
build dependencies on a standard public runner, builds only the pinned RustCore
binary, overlays reviewed fixtures onto the frozen frontend, and runs the one
contract. It has not been published, triggered, or validated by execution.

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
seven-entry SHA-256 manifest. It has not yet been published or triggered.
