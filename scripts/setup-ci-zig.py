#!/usr/bin/env python3
"""Install the pinned official Zig archive in RUNNER_TEMP, never system-wide.

SHA-256 values: https://ziglang.org/download/index.json (0.16.0).
Only the four explicitly supported native CI host architectures are accepted.
"""
import hashlib
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tempfile
import urllib.request
import zipfile

VERSION = "0.16.0"
ARCHIVES = {
    ("Linux", "x86_64"): ("x86_64-linux", "tar.xz", "70e49664a74374b48b51e6f3fdfbf437f6395d42509050588bd49abe52ba3d00"),
    ("Darwin", "x86_64"): ("x86_64-macos", "tar.xz", "0387557ed1877bc6a2e1802c8391953baddba76081876301c522f52977b52ba7"),
    ("Darwin", "arm64"): ("aarch64-macos", "tar.xz", "b23d70deaa879b5c2d486ed3316f7eaa53e84acf6fc9cc747de152450d401489"),
    ("Windows", "AMD64"): ("x86_64-windows", "zip", "68659eb5f1e4eb1437a722f1dd889c5a322c9954607f5edcf337bc3684a75a7e"),
}


def main():
    target, extension, digest = ARCHIVES[(platform.system(), platform.machine())]
    name = f"zig-{target}-{VERSION}"
    root = Path(tempfile.mkdtemp(prefix="jmcl-zig-", dir=os.environ["RUNNER_TEMP"]))
    archive = root / f"{name}.{extension}"
    url = f"https://ziglang.org/download/{VERSION}/{archive.name}"
    with urllib.request.urlopen(url, timeout=120) as response, archive.open("wb") as output:
        shutil.copyfileobj(response, output)
    if hashlib.sha256(archive.read_bytes()).hexdigest() != digest:
        raise RuntimeError("Official Zig archive SHA-256 mismatch; refusing to extract or execute")
    if extension == "zip":
        with zipfile.ZipFile(archive) as compressed:
            compressed.extractall(root)
    else:
        subprocess.run(["tar", "-xJf", str(archive), "-C", str(root)], check=True)
    binary = root / name / ("zig.exe" if platform.system() == "Windows" else "zig")
    actual = subprocess.check_output([str(binary), "version"], text=True).strip()
    if actual != VERSION:
        raise RuntimeError(f"Unexpected Zig version: {actual}")
    with open(os.environ["GITHUB_PATH"], "a", encoding="utf-8") as output:
        output.write(str(binary.parent) + "\n")
    print(f"Verified Zig {actual} for {target}: sha256={digest}")


if __name__ == "__main__":
    main()
