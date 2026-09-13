#!/usr/bin/env bash
# Launch the built preview on an isolated virtual display.
set -euo pipefail
RUN_DIR="/tmp/opencode/tantalus-verify"
BIN="src-tauri/target/release/tantalus-preview"
XVFB="${TANTALUS_XVFB:-$(command -v Xvfb || true)}"
mkdir -p "$RUN_DIR"

[ -x "$BIN" ] || { echo "Preview binary missing. Run scripts/build-preview.sh first." >&2; exit 1; }
[ -x "$XVFB" ] || { echo "Xvfb is required. Install it or set TANTALUS_XVFB." >&2; exit 1; }

if [ -f "$RUN_DIR/run.pid" ]; then
  recorded_pid="$(cat "$RUN_DIR/run.pid")"
  if kill -0 "$recorded_pid" 2>/dev/null &&
    [ "$(readlink -f "/proc/$recorded_pid/exe" 2>/dev/null)" = "$(readlink -f "$BIN")" ]; then
    echo "Refusing: a preview from this harness is still running. Run cleanup.sh first." >&2
    exit 1
  fi
  rm -f "$RUN_DIR/run.pid"
fi

display_number=""
for candidate in $(seq 90 110); do
  if [ ! -e "/tmp/.X11-unix/X$candidate" ]; then
    display_number="$candidate"
    break
  fi
done
[ -n "$display_number" ] || { echo "No free virtual display from :90 to :110." >&2; exit 1; }
display=":$display_number"

setsid "$XVFB" "$display" -screen 0 800x800x24 -nolisten tcp >"$RUN_DIR/xvfb.log" 2>&1 &
xvfb_pid=$!
echo "$xvfb_pid" >"$RUN_DIR/xvfb.pid"
readlink -f "$XVFB" >"$RUN_DIR/xvfb.exe"
echo "$display" >"$RUN_DIR/run.display"

for _ in $(seq 1 30); do
  DISPLAY="$display" xprop -root >/dev/null 2>&1 && break
  kill -0 "$xvfb_pid" 2>/dev/null || { echo "Xvfb exited early." >&2; exit 1; }
  sleep 1
done

DISPLAY="$display" GDK_BACKEND=x11 WEBKIT_DISABLE_DMABUF_RENDERER=1 setsid "$BIN" </dev/null >"$RUN_DIR/preview.log" 2>&1 &
preview_pid=$!
echo "$preview_pid" >"$RUN_DIR/run.pid"

for _ in $(seq 1 30); do
  kill -0 "$preview_pid" 2>/dev/null || {
    echo "Preview exited early. Log tail:" >&2
    tail -n 20 "$RUN_DIR/preview.log" >&2
    exit 1
  }
  DISPLAY="$display" import -window root "$RUN_DIR/readiness.png" 2>/dev/null || true
  if [ -s "$RUN_DIR/readiness.png" ] &&
    magick "$RUN_DIR/readiness.png" -trim -format '%w %h' info: 2>/dev/null |
      awk '$1 >= 360 && $2 >= 500 { found=1 } END { exit !found }'; then
    rm -f "$RUN_DIR/readiness.png"
    echo "Ready: Tantalus Preview on isolated display $display (pid $preview_pid)"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for the preview window." >&2
exit 1
