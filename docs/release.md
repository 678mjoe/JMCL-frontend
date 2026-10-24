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

## Automatic updates: code available, release channel disabled

The official Tauri updater plugin and narrow native check/download/install bridge
are implemented; [implementation and verification](verification/2026-10-24-updater.md)
remain distinct from production readiness. Default builds have **no channel**:
Settings cannot check/download/install and never claims they are current.
No production endpoint, public signing key, signed feed or accepted update was
provisioned by this change. `createUpdaterArtifacts` remains false.

A release maintainer must separately verify endpoint ownership, target mappings,
key custody, channel policy, signed artifacts and native recovery acceptance.
Only then may the build process supply all four public build-time variables:

- `JMCL_UPDATE_ENDPOINT`: verified HTTPS manifest URL (no credentials/fragments).
- `JMCL_UPDATE_PUBLIC_KEY`: Tauri-format base64 public-key **content**, not a path
  or private key. Public keys are not secrets.
- `JMCL_UPDATE_CHANNEL`: `stable` or `beta`, matching the verified endpoint's feed.
- `JMCL_UPDATE_VERIFIED`: `release-maintainer-verified`, an explicit maintainer
  attestation, **not automated proof** of ownership or platform acceptance.

All absent means disabled; partial or invalid values fail the native build.
These values are embedded during Rust compilation, not read at runtime. The
frontend cannot supply URLs, keys, bytes, headers or channel overrides. Changing
localStorage or a running process's environment cannot enable a default build.
A syntactically valid configuration is not sufficient evidence of release safety.

HTTPS is enforced on native requests and redirects, including debug builds.
The plugin checks artifact signatures on download and again on installation;
`requireSignedVersion` rejects signatures without a bound version and mismatched
versions, and downgrade allowance stays off. A future authorized signing pipeline
must use a compatible Tauri CLI that signs the app version (or its supported
`signer sign --app-version` path); older unbound signatures are not accepted.
Do not weaken these checks or generate real signing keys for tests.

Every network check, download, install and restart requires an explicit UI
confirmation. Download completion does not install. Cancel dismisses an unstarted
confirmation; discard drops the available/verified in-memory update. Active
checks/downloads/installations have **no user cancellation claim**; navigating
away does not cancel. Checks time out after 60 seconds, downloads after 600.
Only an explicit new check retries a failure. No automatic polling of the feed,
background update, persistent artifact cache or automatic retry is implemented.

Save work and stop games/servers before installing. Installation clears launcher
Core sessions; Windows exits to the installer with automatic relaunch disabled; reopen the launcher manually afterward.
Linux/macOS offer a separately confirmed restart after install. A failed install
may require repair: neither atomic rollback nor clean-machine recovery is claimed.
Real signed installation, tamper rejection end-to-end, offline/interruption,
unsupported targets, platform dialogs, restart and recovery acceptance are still
required under a separately approved release/test scope. See the official
[Tauri updater guide](https://v2.tauri.app/plugin/updater/) and
[plugin API](https://docs.rs/tauri-plugin-updater/2.14.0/tauri_plugin_updater/struct.Update.html).

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
