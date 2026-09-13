#!/usr/bin/env bash
# Build the separately identified preview app without installing or packaging it.
set -euo pipefail

vp run tauri build --config src-tauri/tauri.preview.conf.json --no-bundle

BIN="src-tauri/target/release/tantalus-preview"
[ -x "$BIN" ] || { echo "Preview build did not produce $BIN" >&2; exit 1; }
echo "PREVIEW-BUILD: pass ($BIN)"
