# Development rules

## Roadmap ownership

The user and their dedicated planning agent own `ROADMAP.md`'s product scope,
milestones, priorities, stage ordering, and acceptance gates. Other contributors
and agents must not independently create or revise that planning. Offer advice
in conversation or ask the user for approval when a planning change is needed.

Factual implementation-status corrections are allowed when supported by code or
verification evidence. Keep implementation, automated tests, native builds, and
real UI acceptance distinct. Updating environment instructions does not authorize
changing product plans or declaring an acceptance gate complete.

## Development environment

Use [Development environments](docs/development.md) for current setup and platform
boundaries. Older plans and verification records describe the environment used
at the time; they are not instructions to access a personal machine or Pi.

Use the selected environment's supported provisioning workflow for reproducible
setup; Devin blueprints apply only to Devin sessions. Do not put real hosts,
credentials, SSH trust entries, or personal filesystem paths in repository
configuration. Generated core binaries and staged sidecars remain untracked.

## Verification

- Follow the core RPC contract in `gui-handoff.md`; check JMCLCore when the
  contract and implementation differ.
- Run focused tests for the change, then `bun run test` and `bun run build` for
  a completed frontend change. Format Rust changes with `cargo fmt
  --manifest-path src-tauri/Cargo.toml --all -- --check`.
- Native behavior must be checked on the relevant OS. Browser Mock tests do not
  establish Tauri, keychain, system SSH, or packaged-sidecar correctness.
- Record the frontend/core revisions, OS/architecture, commands or interactions,
  and any blocked or untested checks. Do not turn an environment blocker into a
  passing result.
- Real hosts, accounts, Minecraft workloads, and security configuration changes
  require an explicit test scope; environment setup alone does not authorize them.
