# Windows pack activation adapter — 2026-10-24

## Implementation and scope

Rebased on frontend `cfd04807cbdaea9f4d83376064f10b2d10fd4957` (merged PR #15).
Windows now has a native adapter for the existing modern `options.txt`
resource-pack selection and explicitly selected Iris/Oculus configuration
subset. This is implementation evidence, **not Windows execution or game
acceptance**. Unknown/legacy formats and other shader runtimes remain unsupported.
No real accounts, game installations, credentials, registry values, release
artifacts, or personal-machine settings were used.

The same shared activation/request gate, explicit stopped confirmation, shader
runtime confirmation, bounded single-use revisions, selection validation, and
byte-preserving text transformations are used on Unix and Windows. Reads are
bounded at 1 MiB; manifests additionally at 64 KiB. Only existing fixed targets
are edited. Unknown text and line endings remain intact.

Windows admits local drive-absolute roots (including canonical `\\?\C:\...`
syntax); UNC/device namespaces, dot traversal, alternate streams, reserved
aliases, and ambiguous trailing dots/spaces are refused. A volume-GUID root check also
rejects mapped network drives and SUBST subtree roots. Each subsequent leaf
is opened with `NtCreateFile` relative to the already-held directory handle,
with `FILE_OPEN_REPARSE_POINT`; handle metadata rejects every reparse tag,
directory/file mismatch, and hardlinked configuration. Ancestor handles remain
alive without delete sharing. Enumeration is also handle-based. Installed ZIP
packs may be hardlinked, matching Core's storage model.

Staging uses exclusive `FILE_CREATE` relative to the target directory and the
original owner/group/DACL descriptor, without security-error fallback or
privilege elevation. Encrypted configurations are refused before staging; there
is no plaintext fallback. Arbitrary extra streams, SACL/audit rules, compression,
and other custom metadata are not promised to be copied. The staged handle is flushed, original contents are checked
again, and `NtSetInformationFile(FileRenameInformation)` performs a
same-directory fixed-leaf replacement. Cleanup marks the staged object for
deletion by handle, never by an unchecked pathname. Unsupported filesystems/API
operations and sharing conflicts fail closed; no path-based fallback exists.

**Concurrency boundary:** this is compare-before-rename, not an operating-system
compare-and-swap. Ordinary Windows replacement requires closing the destination
handle immediately before rename. An external program which ignores the stopped
confirmation can change the destination in that final interval. As with the
existing Unix compare/rename implementation, observed conflicts are refused;
absolute exclusion of hostile external writers is not claimed. The atomic
rename avoids partially written configuration but is not a crash-durability
or malicious-writer transaction guarantee. The GUI gate only covers GUI-owned
requests. Permission changes by another actor and filesystem/OS failures also
remain outside an application-level transaction.

## Primary API review

- [NtCreateFile (user-mode)](https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile): directory-relative counted names, exclusive creation, synchronous handles, and opening reparse points themselves.
- [NtSetInformationFile](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntsetinformationfile) and [FILE_RENAME_INFORMATION](https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_rename_information): DELETE access and NULL-root/simple-name same-directory rename.
- [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) and [FSCTL_SET_REPARSE_POINT](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-fsa/4aeefef8-92c3-4abc-af7a-a610caf8a165): sharing restrictions alone are insufficient to prohibit attribute-only reparse edits. The implementation therefore does not rely on checked full paths plus sharing locks.
- [GetFinalPathNameByHandleW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfinalpathnamebyhandlew): local volume-GUID verification, with no network-drive fallback.
- [GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/desktop/api/winbase/nf-winbase-getfileinformationbyhandleex), [FILE_ID_BOTH_DIR_INFO](https://learn.microsoft.com/en-us/windows/win32/api/winbase/ns-winbase-file_id_both_dir_info), and [GetKernelObjectSecurity](https://learn.microsoft.com/en-us/windows/win32/api/securitybaseapi/nf-securitybaseapi-getkernelobjectsecurity): handle-based enumeration and security descriptor retrieval.

Uses the already-locked `windows-sys 0.61.2` crate with additional feature flags;
no new crate or hand-written FFI ABI declarations.

## Executable evidence

Local environment: Linux x86_64, workspace-local Rust and existing native sysroot.

- `bun run test`: 471 passed, 0 failed.
- `bun run build`: passed (existing large-chunk warning only).
- `bun run test:e2e`: blocked before browser execution: Playwright Chromium
  executable is absent locally (3 launch failures, not application assertions).
  The existing standard public-runner CI installs Chromium and must pass.
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`: passed.
- `cargo check --offline --manifest-path src-tauri/Cargo.toml`: passed.
- `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib pack_activation`: 17 passed, 0 failed (Unix adapter/state tests).
- `cargo test --offline --manifest-path src-tauri/Cargo.toml --lib`: 55 passed, 0 failed.
- Full `cargo test --offline --manifest-path src-tauri/Cargo.toml`: passed,
  including isolated real-Core RPC and fake-SSH process tests; no real SSH host.
- Windows GNU cross-target `cargo check --tests` of a temporary harness containing
  the unchanged adapter, shared state/parsers, and tests (only Tauri IPC wrappers
  replaced by a minimal error type): passed. This establishes Rust/Windows API
  type checking, **not linking, full Tauri compilation, or Windows execution**.

Shared tests now compile on Windows too: roundtrip/order/unknown bytes,
confirmation and request gate, revision scope/single-use/conflict, unsupported
formats and manifests, Iris/Oculus isolation and selection. Windows-only
synthetic tempfile tests cover junctions in root/instance/game/packs/config,
late file symlinks and hardlinks, unmodified outside sentinels, pack junction
filtering and allowed hardlinked ZIPs, pinned ancestor rename attempts,
staging-name collisions, namespace aliases, bounded reads, and a competing
write handle. Tests do not silently skip symlink failures: the Windows CI runner
must provide its normal symlink capability.

Windows native CI execution is pending. macOS/Windows visual acceptance, real
Minecraft loading, custom filesystem/ACL deployment compatibility, and external
client/process acceptance remain pending. Do not infer those from Linux tests or
cross-target checking.
