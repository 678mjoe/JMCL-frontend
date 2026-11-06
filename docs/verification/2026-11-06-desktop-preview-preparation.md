# Desktop preview preparation, 2026-11-06

## Sources and scope

- Base: merged frontend `90b9d5472e620255af740b55315e2cf75c1c9115`.
- Independent branch: `build/desktop-preview-20261106`; no changes to `main`.
- Reused preview workflow and package inspector from
  `5d837ffbdb4ba0200e2573592ffd2780b188d906`, previously exercised by
  [run 41622554548](https://github.com/678mjoe/JMCL-frontend/actions/runs/41622554548).
- Production Zig Core stays pinned to
  `5a4310debbcee26b3d2391bab2339f79cd6ec52e`. This is not a Rust-Core preview.
- Bun/Rust/Zig versions, Zig checksums, action pins, dependency locks, application
  source/configuration, and the existing quality workflow remain unchanged.

The preview matrix remains macOS ARM64 `.app.tar.gz`, macOS Intel `.app.tar.gz`,
and Windows x64 NSIS. Packages are unsigned, not notarized, not an official
release, and not updater artifacts. Artifact retention remains 14 days. The
inspector is byte-for-byte the prior preview inspector; only the workflow branch
and an added synthetic-inspector test step differ from the prior workflow.

## Action review

The workflow uses public standard runners and read-only repository permissions.
Official checksum-verified toolchains and locked dependencies build the pinned
Core and frontend. Existing Rust tests use isolated local fixtures, including
synthetic local modpack import. Account contract tests use temporary synthetic
metadata; Java-policy contract probes stop at input guards and list empty runtime
metadata. They do not acquire or execute Java.

The package inspector checks metadata, host/Core architectures and the exact
staged Core hash. macOS apps are archived with executable modes retained; NSIS
is read by runner-provided 7-Zip, never installed. Only the bundled Core's
`core.version` RPC is smoke-tested, in a temporary working directory. The
manifest records frontend/Core revisions, package/payload hashes, unsigned
status, smoke result, and acceptance limits.

## Local checks

- Existing package-inspector tests: 5 passed.
- New preview-inspector tests: 11 passed on Linux. Subprocess execution is
  blocked unless explicitly mocked. The POSIX executable-mode case runs on
  macOS and is intentionally skipped on Windows.
- Frontend tests: 584 passed, 0 failed; frontend production build passed.
- YAML parsing, Python AST parsing, all 12 Bash run-step syntax checks, and
  exact pin/lock/config/shared-script comparisons passed.
- The preview-only test change preserves the old Windows CRLF fix. A synthetic
  CRLF case fails with main's LF-only regex and passes with optional `\r`;
  LF and wrong-package-name cases remain covered. No lockfile is rewritten.

No native package was built or executed locally. No Java was downloaded or
executed. No remote branch push, workflow run, release, or artifact publication
was performed during this preparation. Actual three-platform packaging and
download availability require a subsequent successful preview CI run. Native
GUI behavior, real login, Minecraft launch, and installer execution remain
unverified by these checks.
