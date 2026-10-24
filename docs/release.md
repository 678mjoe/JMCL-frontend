# Release preparation — not release approval

Stage 8 prepares reproducible quality gates and documents the remaining release
work. No tag, installer publication, signing key, paid account, credential or
release service is created by this work. Version `0.1.0` in source is not evidence
of a published or accepted release. Follow the roadmap's original acceptance
gates; blocked native acceptance is not waived by a CI pass.

## Build inputs and evidence

- Record the exact frontend commit, lockfiles, Rust/Bun/Zig versions, runner image,
  OS and architecture. Core baseline: `97b65186d7882c415220969d8dcd264b6c3353bd`.
- Build Core and the Tauri host for the same target. Stage the host-suffixed sidecar
  using `scripts/prepare-sidecar.sh`; pass the `.exe` input explicitly on Windows.
- Run frontend tests, production build, browser Mock E2E, Rust formatting/checks
  and applicable native tests. Distinguish tests skipped by platform conditions.
- CI is compile/test evidence only: it does not establish native WebView, dialog,
  keychain, SSH trust/agent, Minecraft graphics, or packaged installer behavior.
- Never ship Mock builds, local caches, development credentials, personal paths,
  stale sidecars, or unsigned assets labeled as signed releases.

## Installer and platform gates

These are preparation instructions, **not executed packaging results**. Future
packaging requires an explicitly approved scope. Standard CI does not publish
installers or create GitHub Releases.

| Target | Required before release |
| --- | --- |
| macOS Apple Silicon and Intel | Matching sidecar; Tauri `.app`/DMG packaging; approved Developer ID signing and notarization; verify app and nested sidecar signature; Gatekeeper check on a clean machine; install/open/upgrade/uninstall and data preservation |
| Windows x86_64 | Matching `.exe` sidecar; WebView2 prerequisite behavior; chosen NSIS/MSI installer tested with ordinary-user permissions; approved Authenticode signing/timestamping; verify signature on clean Windows; install/upgrade/uninstall and data preservation |

Choose supported architectures from successful native evidence, not a guessed
cross-compile result. Do not claim Windows ARM or a universal macOS artifact from
one host build. Windows activation writes remain intentionally unsupported.

Tauri provides [macOS signing/notarization guidance](https://v2.tauri.app/distribute/sign/macos/)
and [Windows signing guidance](https://v2.tauri.app/distribute/sign/windows/).
Platform signing is separate from updater signing. Obtain the user's approval
before acquiring certificates/accounts, introducing secrets, or using a paid
signing service. Keep private material out of Git, PR jobs, logs and artifacts;
use a reviewed secret-handling release process with minimal permissions. Do not
bypass Gatekeeper, SmartScreen, or signature verification as an acceptance step.

## Automatic updates: deliberately unavailable

There is no configured production endpoint/public key, updater plugin, or signed
update feed. Disabled UI is a safe status path, **not a working updater**. No
network request, download, installation or false “latest version” result should
occur through that path.

Before enabling the [Tauri updater](https://v2.tauri.app/plugin/updater/), separately
approve and review all of these gates:

- Stable owned HTTPS endpoint, target/architecture mapping, version policy and
  publication authority; never use a placeholder endpoint in production.
- Approved signing-key custody, backup/recovery and rotation policy, an embedded
  public key, and signed artifacts matching each platform. Never generate or
  expose real signing keys merely to satisfy a test.
- Explicit user check/download/install decisions with progress/cancellation,
  restart/data-safety handling and actionable offline/error behavior.
- Tests for no update, valid update, network failure, malformed metadata,
  unsupported target, invalid/missing signatures and interrupted downloads.
- Reject tampered assets; independently verify clean-machine update/rollback
  recovery behavior. Do not weaken signature/TLS checks to make a test pass.

## First-release approval checklist

- [ ] Target-platform native UI/keychain/dialog/sidecar acceptance recorded.
- [ ] Authorized real account, game and server lifecycle acceptance recorded.
- [ ] Browser default/empty/errors and production CSP behavior accepted.
- [ ] Installer and signing/notarization evidence recorded per architecture.
- [ ] Data backup/migration/uninstall behavior and known limitations reviewed.
- [ ] User documentation and release notes match the exact tested commit.
- [ ] Updater either fully verified or explicitly unavailable in release notes.
- [ ] User approves exact release version/tag, artifacts, destination and cost.
- [ ] Only then create tag/release, publish approved artifacts, and verify their
      hashes, signatures and download destinations.

None of the unchecked gates is satisfied by this document. No release operation
is automatically triggered by adding or merging the quality workflow.
