# Stage 8 quality and release preparation — 2026-10-24

Base frontend: `d7e3e402423d0d70e6ccae6f4dd031f47e29d627` (PR #14).
Core: `97b65186d7882c415220969d8dcd264b6c3353bd`. Local OS: Linux x86_64.
This record does not change roadmap ordering or waive real/native acceptance.

## Implementation

- React interaction coverage and strict replay of checked-in protocol-v1 examples;
  fixture correspondence with authoritative `gui-handoff.md` is tested.
- Three isolated browser Mock E2Es for default/empty/errors: navigation/detail
  back, cancel/reopen/Escape, pending failure/retry and disabled updater status.
- Least-privilege CI: immutable action refs, frozen frontend lockfile, pinned
  toolchains/Core, official Zig SHA-256 verification, public standard runners,
  no credentials, no artifacts uploaded, no release/tag/signing step.
- Native compile/sidecar matrix: Linux x64, macOS ARM64 and Intel, Windows x64.
  Host architecture is asserted; no unverified binary is reused across targets.
- CSP defaults deny; production scripts are self only, no unsafe-eval or inline
  script. Native IPC and specific image origins allowed. Dynamic inline CSS is
  retained for UI overlays/themes. Development has a separate loopback HMR policy.
  Native HTTP/Core permissions are separate from WebView CSP.
- Updater status is explicitly unconfigured, immutable and disabled; no updater
  plugin, endpoint, public key, network check, download or install exists.
- Bilingual user guide, corrected README scope, and release/signing/installer
  prerequisite checklist. No release operation is performed.

## Local executed checks

- Frontend suite: **471 passed, zero failed**, 64 files.
- TypeScript + Vite production build: **PASS**; existing >500 kB chunk warning.
- Frozen-lockfile install and Playwright spec discovery: **PASS**, 3 specs.
- Rust fmt/check/test: **PASS** using existing workspace native sysroot and pinned
  synthetic Core fixture. 55 unit + 7 local RPC + 25 fake-SSH tests = **87 passed**.
- Zig setup helper: Python/YAML/bash syntax checks, official Linux cached archive
  checksum/extract/version test and corruption rejection: **PASS**.
- Browser interactions locally: **BLOCKED before tests** by Chromium singleton
  socket permission; standard escalation failed in read-only runtime. No bypass
  or subsequent equivalent local attempt. CI results must be recorded separately.

## CI evidence

Pending first PR run. No matrix or browser execution is claimed from workflow YAML.

## Roadmap completion matrix

`IMPLEMENTED` describes code, `VERIFIED` describes the named evidence layer only,
`BLOCKED` means prerequisites/acceptance unavailable, `NOTSUPPORTED` means an
intentional unsupported implementation path. These are not interchangeable.

| Roadmap area | Status and remaining boundary |
| --- | --- |
| Stages 0–1 baseline, server model/Mock | IMPLEMENTED; Linux automated coverage VERIFIED; historical visual gates remain distinct |
| Stage 2 SSH | IMPLEMENTED; fake-SSH tests VERIFIED; real approved host and native OS acceptance BLOCKED |
| Stage 3 server lifecycle | IMPLEMENTED; synthetic flow/state checks VERIFIED; real game server workload and reconnect acceptance BLOCKED |
| Stages 4–6 controls, worlds, content | IMPLEMENTED; Linux tests VERIFIED; native/real RCON/Query/world/content acceptance BLOCKED |
| Stage 7 client features | IMPLEMENTED with documented guards; Linux tests VERIFIED; real accounts/catalogs/archive/game/native acceptance BLOCKED |
| Stage 7 Windows activation | NOTSUPPORTED pending reparse-safe adapter; not a passing platform check |
| Stage 7 OptiFine/unknown formats | NOTSUPPORTED; use in-game UI, no guessed adapter |
| Stage 8 React and RPC fixtures | IMPLEMENTED, Linux automated tests VERIFIED |
| Stage 8 browser E2E | IMPLEMENTED; local execution BLOCKED; CI evidence pending |
| Stage 8 Actions/native/sidecar matrix | IMPLEMENTED; CI evidence pending; compile never proves native UI |
| Stage 8 CSP | IMPLEMENTED; static regressions/build VERIFIED; actual native enforcement/visual acceptance BLOCKED |
| Stage 8 code signing | Preparation IMPLEMENTED; keys/accounts/approval and platform checks BLOCKED |
| Stage 8 installers | Configuration/checklist present; signed installer creation/testing/publication BLOCKED, not executed |
| Stage 8 automatic updating | Disabled status IMPLEMENTED and tested; updater itself BLOCKED/unimplemented pending signed channel and integration |
| Stage 8 user documentation | IMPLEMENTED; release-specific acceptance still required |
| Stage 8 first release tag | BLOCKED on explicit release approval and prerequisites; no tag/release created |

The end of feasible authorized development is not the end of acceptance. Follow
[release gates](../release.md) before any publication. No real service/account,
SSH trust change, Minecraft workload, paid runner, signing key or installer on a
user machine was used in this stage.
