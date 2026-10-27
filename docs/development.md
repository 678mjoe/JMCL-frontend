# Development environments

This is the current environment guide for JMCL-frontend. Contributors and
assistants can use an authorized cloud, remote, or local workspace; no particular
provider, Raspberry Pi, or personal macOS workspace is assumed. Verify the
selected environment is available and determine its actual OS and architecture
before choosing setup commands or a core binary. This guide changes environment
instructions only, not the roadmap's product scope, stage order, or acceptance gates.

## Platform boundaries

| Platform | What it can establish |
| --- | --- |
| Linux | Frontend tests/builds, browser Mock interactions, Rust/core checks with the required native dependencies, and Linux server behavior when explicitly authorized |
| macOS | The same frontend checks plus native macOS Tauri, Keychain, dialogs, sidecar and system OpenSSH behavior |
| Windows | The same frontend checks plus native Windows Tauri/WebView2, Credential Manager, paths, `.exe` sidecar and `ssh.exe` behavior |

These are verification boundaries, not a mandatory platform schedule. A Linux
build does not establish macOS or Windows behavior. Preparing or compiling an
environment does not establish UI acceptance, authentication, or game launch.
Cloud desktop availability does not by itself prove Minecraft graphics support.

## Provisioning and snapshots

Use the selected environment's supported setup workflow. A connected machine
must be explicitly available and authorized; historical instructions do not
select it. If no connected machine is available, an authorized cloud workspace
can establish only the checks supported by its actual platform and dependencies.

For Devin sessions, the repository-scoped Devin blueprint is the source for
provisioning. Read the effective blueprint in Devin before changing it. Each
platform has its own `runs-on` block and snapshot; changing the repository setup
does not require changing the organization's default platform. In that workflow:

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
platform's executable. Pin the frontend and core commits before verification,
and use a separate checkout or worktree for a PR comparison. Keep an
environment-managed core checkout separate from any editable JMCLCore checkout.

Toolchains and caches may be isolated inside a writable workspace rather than
installed globally. Where system packages cannot be installed, a workspace-local
sysroot from verified official packages may support native compilation; record
its provenance and required environment variables. This is not evidence that
Rust checks, linking, or native UI behavior passed. Do not bypass network or
filesystem restrictions to provision dependencies.

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

Use a browser preview to try the web Mock, or an available authorized desktop
to inspect the native app. Start servers in the active session, not during
snapshot creation. Check for an existing process before starting another copy.

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

Environment setup does not configure real SSH endpoints, accept host keys, supply
account credentials, or authorize Minecraft installation/launch. Real-server
tests need an approved target, known connectivity, sufficient resources, and a
cleanup plan. A Cloud VM is not implicitly a persistent server host. Historical
restrictions on a particular Pi are not resource measurements of a Cloud VM.

Minecraft may be launched for scoped acceptance in isolated test instances when
the required runtime, game files and platform prerequisites are available.
There is no project-wide prohibition on launching Minecraft. Follow applicable
environment access and account authorization requirements; this permission does
not implicitly authorize additional network access or downloads, changes to daily
instances, releases, or promotion to `main`. Record actual launch results
separately from synthetic tests and historical evidence; fixture-specific
no-process guards remain valid. A successful launch does not itself establish
completion of Java runtime acquisition implementation.

Existing plans and verification records retain their original evidence and
stage gates. Their machine names, old worker instructions, local paths, and
desktop tools do not select today's environment. Record new verification evidence
separately with the frontend/core revisions and actual OS/architecture. See the
[2026-10-23 Linux handoff](verification/2026-10-23-linux-handoff.md) for that
session's results and remaining verification limits.

See [contributor rules](../CONTRIBUTING.md) for roadmap ownership and
[Devin environment documentation](https://docs.devin.ai/onboard-devin/environment)
for Devin-specific snapshot configuration.

## Stage 8 quality workflow

`bun run test` runs the `src` Bun/React/contract suites. Browser tests are separate:

```bash
bunx --no-install playwright install --with-deps chromium
bun run test:e2e
```

Playwright starts its own loopback-only development Mock server and denies
external requests in the fixtures. It is not a Tauri WebView test. On a compatible
local system an existing Chromium can be selected explicitly with
`PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`; sandbox/network failures are blockers, not
permission to bypass environment restrictions. Test reports/traces are ignored
and should be reviewed for diagnostic/private data before sharing.

The GitHub quality workflow uses public-repository standard runners only, pinned
action commits and toolchain versions, read-only repository permissions, no
secrets, and no signing/upload/release step. Its native matrix asserts the host
architecture, builds the pinned Core, stages its sidecar, and compiles Tauri
without bundling. Runtime/keychain/SSH/game/installer acceptance remains separate.

Production CSP defaults to deny: bundled scripts/fonts, Tauri IPC, and explicit
avatar/catalog image hosts only. Existing native HTTP capabilities remain scoped
to catalog hosts; WebView CSP does not constrain native HTTP or Core. Inline CSS
is retained for runtime positioning/theme styles, not inline scripts. Development
adds React-refresh inline script and loopback HMR only. Remote `TAURI_DEV_HOST`
needs a separately reviewed development policy adjustment; do not broaden the
production policy. Native WebView enforcement must still be tested on each OS.
See [Tauri CSP documentation](https://v2.tauri.app/security/csp/).
