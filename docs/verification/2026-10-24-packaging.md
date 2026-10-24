# Stage 8 — non-distributed package generation

## Scope

The existing native CI matrix now requests a debug-profile `.deb` on Linux
x86_64, `.dmg`/`.app` on each macOS architecture, and NSIS installer on Windows
x86_64. The goal is to close the previous `--no-bundle` generation gap, not to
claim a release or installed application works. Build with `--ci --no-sign`;
no signing credentials, updater artifacts, upload, tag or GitHub Release.

The package inspector checks version/product metadata, binary architecture and
the exact SHA256 of packaged Core against the staged host-target sidecar from
Core `97b65186d7882c415220969d8dcd264b6c3353bd`. Debian and NSIS are extracted
with archive tools; DMGs are mounted read-only and detached in `finally`. No
installer, packaged app or packaged sidecar is executed. Existing Rust tests
remain isolated synthetic tests, not real game/account/server acceptance.

## Evidence

Based on merged updater main `05937157436d16b0c4e5cc50c4c4ebd9f933eb51`
(tree `b6b1e66632ddf1bb8d5ce00a68af754550d4ed01`). The
[final PR #18 evidence](https://github.com/678mjoe/JMCL-frontend/pull/18#issuecomment-6379482236)
records the published head/tree, package hashes and actual matrix run.
All five jobs in [run 40057904328](https://github.com/678mjoe/JMCL-frontend/actions/runs/40057904328)
passed on PR head `10df8109168e4855a6a834504602ffc28f95e901`, tree
`089bf589f5d402c7dde4ce96631c4477b7c69f23`, identical to merged main
`8d68d00983634359f2f6425e2297bad372f2cb12`. This is exact-head PR evidence,
not a claim about any subsequent post-merge run or native installation acceptance.

- Local Python synthetic tests: 5 passed, including all four target headers,
  architecture mismatches, missing/duplicate files and sidecar hash mismatch.
- Local Linux x86_64 debug Debian generation and inspection passed with the
  authorized workspace-local native sysroot/cache (Bun 1.4.4, Rust 1.99.1).
  Command: `bun run tauri build --debug --ci --no-sign --bundles deb`, then
  `python scripts/verify-ci-package.py --target x86_64-unknown-linux-gnu`.
  This local check is Linux-only evidence; subsequent PR CI results are linked above.
- Generated local Debian SHA256:
  `6f531173098029309fa74ae8c0f91a824de79273b9c11748ff0b87d26baf71e3`.
  Matching embedded/staged Core SHA256:
  `06d5718984e142da0706dd5f2230f35a2bc66d25fc107e29f63bd2e44ba4d940`.
  Bundles contain build metadata, so other builds need not have this package hash.
- Rebased full frontend suite: 479 passed, 0 failed; production TypeScript/Vite
  build passed as part of the Tauri build. Existing browser and Rust checks
  continue unchanged in CI.

## Still pending

Release-profile builds, formal Developer ID/Authenticode signing, notarization,
clean-machine installation/opening/upgrade/uninstall, WebView2 prerequisites,
Gatekeeper/SmartScreen behavior, GUI/keychain/dialog/real account/game/server
acceptance, signed update/restart/recovery, and the first approved release/tag.
MSI and other unselected package types are not verified. Debug packages stay on
the ephemeral runner and are not suitable release artifacts. Local linker ad-hoc
Mach-O signatures, if present, are not formal publisher signatures.
