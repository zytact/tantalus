#!/usr/bin/env bash
# Build the separately identified preview app, unpacked, without installing it. --package also writes the
# installable deb and rpm beside it, for testing by hand next to the release app.
set -euo pipefail
case "${1:-}" in
  "") target=(--dir) ;;
  --package) target=() ;;
  *) echo "usage: build-preview.sh [--package]" >&2; exit 1 ;;
esac
source "$(dirname "$0")/run-dir.sh"

# Replacing the binary under a running preview leaves a process the harness no longer recognizes as its own.
pid="$(cat "$RUN_DIR/run.pid" 2>/dev/null || true)"
if [ -n "$pid" ] && [ "$(readlink -f "/proc/$pid/exe" 2>/dev/null)" = "$(readlink -f "$BIN")" ]; then
  echo "Refusing: a harness preview is running. Run cleanup.sh first." >&2
  exit 1
fi

vp build
vp pack
node scripts/package.ts --preview "${target[@]}"

[ -x "$BIN" ] || { echo "Preview build did not produce $BIN" >&2; exit 1; }
echo "PREVIEW-BUILD: pass ($BIN)"
if [ "${#target[@]}" -eq 0 ]; then
  ls "$ROOT"/release/tantalus-preview/*.{deb,rpm}
fi
