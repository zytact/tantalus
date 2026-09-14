#!/usr/bin/env bash
# Build the separately identified preview app, unpacked, without installing or packaging it.
set -euo pipefail

vp build
vp pack
node scripts/package.ts --preview --dir

BIN="release/tantalus-preview/linux-unpacked/tantalus-preview"
[ -x "$BIN" ] || { echo "Preview build did not produce $BIN" >&2; exit 1; }
echo "PREVIEW-BUILD: pass ($BIN)"
