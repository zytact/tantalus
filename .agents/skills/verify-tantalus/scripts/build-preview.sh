#!/usr/bin/env bash
# Build the separately identified preview app, unpacked, without installing it. --package also writes the
# installable packages beside it, for testing by hand next to the release app: the deb and rpm on Linux,
# the setup exe on Windows.
set -euo pipefail
case "${1:-}" in
  "") target=(--dir) ;;
  --package) target=() ;;
  *) echo "usage: build-preview.sh [--package]" >&2; exit 1 ;;
esac
source "$(dirname "$0")/run-dir.sh"

# Replacing the binary under a running preview leaves a process the harness no longer recognizes as its own.
pid="$(cat "$RUN_DIR/run.pid" 2>/dev/null || true)"
if { [ "$WINDOWS" = 1 ] && windows_owned "$pid"; } ||
  { [ -n "$pid" ] && [ "$(readlink -f "/proc/$pid/exe" 2>/dev/null)" = "$(readlink -f "$BIN")" ]; }; then
  echo "Refusing: a harness preview is running. Run cleanup.sh first." >&2
  exit 1
fi

vp build
vp pack
if [ "$WINDOWS" = 1 ]; then
  node scripts/package.ts --preview --windows "${target[@]}"
else
  node scripts/package.ts --preview "${target[@]}"
fi

[ -x "$BIN" ] || { echo "Preview build did not produce $BIN" >&2; exit 1; }
if [ "$WINDOWS" = 1 ]; then
  # Windows runs the preview from its own disk, since an app on \\wsl.localhost loads slowly.
  rm -rf "$(dirname "$APP")"
  mkdir -p "$STATE_DIR"
  cp -r "$(dirname "$BIN")" "$(dirname "$APP")"
  echo "PREVIEW-BUILD: pass ($BIN, copied to $(wslpath -w "$APP"))"
else
  echo "PREVIEW-BUILD: pass ($BIN)"
fi
if [ "${#target[@]}" -eq 0 ]; then
  ls "$ROOT"/release/tantalus-preview/*.{deb,rpm,exe} 2>/dev/null
fi
