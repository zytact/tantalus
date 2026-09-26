#!/usr/bin/env bash
# Build the separately identified preview app, unpacked, without installing or packaging it.
set -euo pipefail
RUN_DIR="/tmp/opencode/tantalus-verify"
BIN="release/tantalus-preview/linux-unpacked/tantalus-preview"

# Replacing the binary under a running preview leaves a process the harness no longer recognizes as its own.
pid="$(cat "$RUN_DIR/run.pid" 2>/dev/null || true)"
if [ -n "$pid" ] && [ "$(readlink -f "/proc/$pid/exe" 2>/dev/null)" = "$(readlink -f "$BIN")" ]; then
  echo "Refusing: a harness preview is running. Run cleanup.sh first." >&2
  exit 1
fi

vp build
vp pack
node scripts/package.ts --preview --dir

[ -x "$BIN" ] || { echo "Preview build did not produce $BIN" >&2; exit 1; }
echo "PREVIEW-BUILD: pass ($BIN)"
