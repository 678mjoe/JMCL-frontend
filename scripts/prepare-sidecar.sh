#!/usr/bin/env bash
# Prepare the Tauri jmcl-core sidecar for the current host target.
# Usage: scripts/prepare-sidecar.sh [core-binary]

set -euo pipefail

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SRC="${1:-$ROOT/backend-binaries/jmcl-core}"
if [[ ! -f "$SRC" ]]; then
  echo "jmcl-core not found at $SRC" >&2
  echo "Pass an explicit path: scripts/prepare-sidecar.sh /path/to/jmcl-core" >&2
  exit 1
fi

DEST_DIR="$ROOT/src-tauri/binaries"
EXT=""
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*|Windows_NT) EXT=".exe" ;;
esac

TRIPLE="$(rustc -Vv | sed -n 's/^host: //p')"
if [[ -z "$TRIPLE" ]]; then
  echo "failed to determine the Rust host target triple" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
install -m 755 "$SRC" "$DEST_DIR/jmcl-core-$TRIPLE$EXT"
printf 'staged sidecar: %s\n' "$DEST_DIR/jmcl-core-$TRIPLE$EXT"
