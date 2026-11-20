#!/usr/bin/env python3
"""Audit only the synthetic qualification bundle on an isolated native runner."""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = "JMCL Rust Qualification"
IDENTIFIER = "page.mjoe.jmcl.rustqualification"
HOST = "jmcl-rust-qualification"
TARGETS = ("aarch64-apple-darwin", "x86_64-pc-windows-msvc")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--trusted-verifier", type=Path, required=True)
    ap.add_argument("--target", choices=TARGETS, required=True)
    ap.add_argument("--output-dir", type=Path, required=True)
    args = ap.parse_args()

    # Workflow checks the independently pinned Git blob before importing it.
    sys.dont_write_bytecode = True
    spec = importlib.util.spec_from_file_location("pinned_verifier", args.trusted_verifier)
    pinned = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(pinned)
    require, only, digest = pinned.require, pinned.only, pinned.digest

    overlay = json.loads((ROOT / "src-tauri/tauri.rust-qualification.conf.json").read_text())
    base = json.loads((ROOT / "src-tauri/tauri.conf.json").read_text())
    require(overlay["productName"] == PRODUCT and overlay["identifier"] == IDENTIFIER
            and overlay["mainBinaryName"] == HOST, "Unexpected qualification identity")
    require(not overlay["app"]["windows"] and overlay["bundle"]["createUpdaterArtifacts"] is False,
            "Qualification overlay is not headless or enables updater artifacts")
    require(overlay["bundle"]["windows"]["nsis"]["installMode"] == "currentUser",
            "Unexpected qualification installer scope")
    require(not overlay["plugins"]["updater"]["pubkey"], "Unexpected updater key")
    windows = args.target.endswith("windows-msvc")
    require((windows and os.name == "nt") or (not windows and sys.platform == "darwin"), "Run only on the package's native host")
    suffix = ".exe" if windows else ""
    version = base["version"]
    bundle = ROOT / "src-tauri/target/release/bundle"
    binary = ROOT / f".ci-core/rust/target/release/jmcl-core-rust{suffix}"
    stage = ROOT / f"src-tauri/binaries/jmcl-core-{args.target}{suffix}"

    with tempfile.TemporaryDirectory(prefix="jmcl-headless-package-") as temp:
        work = Path(temp)
        unpacked = work / "unpacked"
        unpacked.mkdir()
        if windows:
            package = only((bundle / "nsis").glob("*-setup.exe"))
            require(package.name == f"{PRODUCT}_{version}_x64-setup.exe", "Unexpected NSIS filename")
            sevenzip = shutil.which("7z") or str(Path(os.environ["ProgramFiles"]) / "7-Zip/7z.exe")
            require(Path(sevenzip).is_file(), "Missing runner-provided 7-Zip")
            pinned.run(sevenzip, "x", "-y", f"-o{unpacked}", package)
            escaped = str(package).replace("'", "''")
            metadata = json.loads(pinned.run(
                "pwsh", "-NoProfile", "-NonInteractive", "-Command",
                f"(Get-Item -LiteralPath '{escaped}').VersionInfo | "
                "Select-Object ProductName,ProductVersion | ConvertTo-Json",
            ).decode("utf-8-sig"))
            require(metadata["ProductName"] == PRODUCT
                    and metadata["ProductVersion"] in (version, version + ".0"),
                    "Unexpected NSIS product metadata")
        else:
            app = only((bundle / "macos").glob("*.app"))
            require(app.name == PRODUCT + ".app", "Unexpected .app name")
            info = plistlib.loads((app / "Contents/Info.plist").read_bytes())
            require(info["CFBundleIdentifier"] == IDENTIFIER
                    and info["CFBundleShortVersionString"] == version
                    and info["CFBundleExecutable"] == HOST, "Unexpected app identity")
            package = work / f"jmcl-rust-qualification_{version}_{args.target}.app.tar.gz"
            with tarfile.open(package, "w:gz") as archive:
                archive.add(app, arcname=app.name)
            with tarfile.open(package, "r:gz") as archive:
                for name in (HOST, "jmcl-core"):
                    member = archive.getmember(f"{app.name}/Contents/MacOS/{name}")
                    require(member.isfile() and member.mode & 0o111, f"Non-executable {name}")
                archive.extractall(unpacked, filter="data")
        host = only(unpacked.rglob(HOST + suffix))
        core = only(unpacked.rglob("jmcl-core" + suffix))
        require(core.parent == host.parent, "Host and Core are not adjacent")
        require(all(x.is_file() and not x.is_symlink() for x in (host, core)), "Linked executable")
        pinned.architecture(host, args.target)
        pinned.architecture(core, args.target)
        hashes = {key: digest(path) for key, path in
                  (("compiled_core", binary), ("staged_core", stage), ("packaged_core", core))}
        require(len(set(hashes.values())) == 1, "Unexpected mutation in no-sign qualification")
        # Executing only the newly built verified headless host, not the installer or full GUI.
        env = os.environ.copy()
        for key in ("JMCL_CORE", "VITE_JMCL_TRANSPORT", "JMCL_REVIEWED_LARGE_MRPACK_SIDECAR_SHA256"):
            env.pop(key, None)
        run = subprocess.run([str(host.resolve()), "--synthetic-smoke"], cwd=work, env=env,
                             capture_output=True, timeout=35, check=False)
        require(run.returncode == 0, f"Headless packaged smoke exit={run.returncode}")
        args.output_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(package, args.output_dir / package.name)
        manifest = {
            "variant": "rust-headless-qualification-not-for-distribution",
            "frontend_base": os.environ["FRONTEND"],
            "frontend_revision": pinned.run("git", "-C", ROOT, "rev-parse", "HEAD").decode().strip(),
            "core_revision": os.environ["CORE"],
            "core_tree": os.environ["CORE_TREE"],
            "core_lock_sha256": digest(ROOT / ".ci-core/rust/Cargo.lock"),
            "target": args.target,
            "package": package.name,
            "package_sha256": digest(package),
            "host_sha256": digest(host),
            "unsigned_qualification_hashes": hashes,
            "headless_packaged_host_smoke": "passed",
            "not_verified": ["installer execution", "Windows visible console", "full GUI",
                             "real accounts/providers/game", "developer signing", "notarization"],
        }
        (args.output_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n",
                                                      encoding="utf-8")
        print(json.dumps(manifest))


if __name__ == "__main__":
    main()
