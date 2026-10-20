# Devin Cloud development

This is the current environment guide for JMCL-frontend. Development runs in
Devin Cloud, not in a fixed Raspberry Pi or personal macOS workspace. Determine
the actual session OS and architecture before choosing setup commands or a core
binary. This guide changes environment instructions only, not the roadmap's
product scope, stage order, or acceptance gates.

## Platform boundaries

| Cloud platform | What it can establish |
| --- | --- |
| Linux | Frontend tests/builds, browser Mock interactions, Rust/core checks with the required native dependencies, and Linux server behavior when explicitly authorized |
| macOS | The same frontend checks plus native macOS Tauri, Keychain, dialogs, sidecar and system OpenSSH behavior |
| Windows | The same frontend checks plus native Windows Tauri/WebView2, Credential Manager, paths, `.exe` sidecar and `ssh.exe` behavior |

These are verification boundaries, not a mandatory platform schedule. A Linux
build does not establish macOS or Windows behavior. Preparing or compiling an
environment does not establish UI acceptance, authentication, or game launch.
Cloud desktop availability does not by itself prove Minecraft graphics support.

## Blueprint and snapshots

The repository-scoped Devin blueprint is the source for Cloud provisioning.
Read the effective blueprint in Devin before changing it. Each platform has its
own `runs-on` block and snapshot; changing the repository setup does not require
changing the organization's default platform.

- `initialize` installs toolchains and prepares required local artifacts without
  starting long-lived processes or contacting game servers.
- `maintenance` incrementally installs locked project dependencies.
- `knowledge` records the actual startup/check commands and project constraints.

Only publish setup commands verified on their target platform. A blueprint
suggestion needs approval before it applies to future sessions. Installing a
tool in a running session does not update its underlying snapshot. New sessions
must not depend on uncommitted helper files from an earlier session.

## Dependencies and core

The frontend requires Bun (which also runs Vite when Node is not installed), Rust
with rustfmt, and the target platform's
[Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).
Building JMCLCore requires Zig 0.16.0. Use a pinned compatible core revision,
and build for the current platform/architecture rather than reusing another
platform's executable. Keep an environment-managed core checkout separate from
any editable JMCLCore checkout.

Development core input:

```text
backend-binaries/jmcl-core       # Linux/macOS
backend-binaries/jmcl-core.exe   # Windows
```

On Linux/macOS, stage that input with `bun run sidecar:prepare`. On Windows,
run the existing script in Git Bash with the explicit executable path:

```bash
./scripts/prepare-sidecar.sh backend-binaries/jmcl-core.exe
```

The default staging script input has no `.exe` suffix, so do not use its default
input on Windows. `src-tauri/binaries/` is generated staging output, not the
source of the core executable. Neither directory's binaries belong in Git.

## Working in a session

Frontend-only development needs no running core:

```bash
bun install --frozen-lockfile
bun run dev:mock --host 127.0.0.1
```

For native development, first prepare the matching core/sidecar, then run:

```bash
bun run tauri dev
```

Use a browser preview to try the web Mock, or the Cloud desktop to inspect the
native app. Start servers in the active session, not during snapshot creation.
Check for an existing process before starting another copy.

Common checks:

```bash
bun run test
bun run build
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo check --manifest-path src-tauri/Cargo.toml
```

`cargo check` and Rust tests need the staged sidecar in `src-tauri/binaries/`
because Tauri validates `externalBin`. Rust tests additionally need their
documented fixtures/core dependencies. Do not
claim native tests passed just because frontend tests or formatting passed.

## Real services and historical evidence

Cloud setup does not configure real SSH endpoints, accept host keys, supply
account credentials, or authorize Minecraft installation/launch. Real-server
tests need an approved target, known connectivity, sufficient resources, and a
cleanup plan. A Cloud VM is not implicitly a persistent server host. Historical
restrictions on a particular Pi are not resource measurements of a Cloud VM.

Existing plans and verification records retain their original evidence and
stage gates. Their machine names, old worker instructions, local paths, and
desktop tools do not select today's environment. Record new Cloud evidence
separately with the frontend/core revisions and actual OS/architecture.

See [contributor rules](../CONTRIBUTING.md) for roadmap ownership and
[Devin environment documentation](https://docs.devin.ai/onboard-devin/environment)
for snapshot configuration.
