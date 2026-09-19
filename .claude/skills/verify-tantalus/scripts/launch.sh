#!/usr/bin/env bash
# Launch the built preview on an isolated virtual display with its DevTools protocol open for drive.ts.
# --mock serves fixture usage instead of the live APIs. --restart relaunches only the preview, keeping the
# display, the usage mode, the fixture server, and every saved setting, to prove what survives a restart.
set -euo pipefail
RUN_DIR="/tmp/opencode/tantalus-verify"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MOCK_HOME="$RUN_DIR/mock-home"
MODE="real"
SCENARIO="ready"
RESTART=0
case "${1:-}" in
  "") ;;
  --mock) MODE="mock"; SCENARIO="${2:-ready}" ;;
  --restart) RESTART=1; MODE="$(cat "$RUN_DIR/run.mode" 2>/dev/null || echo real)" ;;
  *) echo "usage: launch.sh [--mock [SCENARIO] | --restart]" >&2; exit 1 ;;
esac
BIN="release/tantalus-preview/linux-unpacked/tantalus-preview"
XVFB="${TANTALUS_XVFB:-$(command -v Xvfb || true)}"
mkdir -p "$RUN_DIR"

[ -x "$BIN" ] || { echo "Preview binary missing. Run scripts/build-preview.sh first." >&2; exit 1; }
[ -x "$XVFB" ] || { echo "Xvfb is required. Install it or set TANTALUS_XVFB." >&2; exit 1; }

preview_running() {
  local pid
  pid="$(cat "$RUN_DIR/run.pid" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null &&
    [ "$(readlink -f "/proc/$pid/exe" 2>/dev/null)" = "$(readlink -f "$BIN")" ]
}

if [ "$RESTART" = 1 ]; then
  [ -s "$RUN_DIR/run.display" ] || { echo "Nothing to restart. Run launch.sh first." >&2; exit 1; }
  if preview_running; then
    kill "$(cat "$RUN_DIR/run.pid")"
    for _ in $(seq 1 10); do
      preview_running || break
      sleep 1
    done
    preview_running && { echo "The preview did not quit. Run cleanup.sh." >&2; exit 1; }
  fi
  rm -f "$RUN_DIR/run.pid"
elif [ -f "$RUN_DIR/run.pid" ]; then
  if preview_running; then
    echo "Refusing: a preview from this harness is still running. Run cleanup.sh first." >&2
    exit 1
  fi
  rm -f "$RUN_DIR/run.pid"
fi

if [ "$RESTART" = 1 ]; then
  display="$(cat "$RUN_DIR/run.display")"
else
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
fi

echo "$MODE" >"$RUN_DIR/run.mode"
cdp_port="$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])')"
echo "$cdp_port" >"$RUN_DIR/run.cdp"
# A shell inside another Electron app can carry ELECTRON_RUN_AS_NODE, which starts a bare Node instead.
preview_env=(env -u TANTALUS_USAGE_BASE_URL -u ELECTRON_RUN_AS_NODE DISPLAY="$display")
if [ "$MODE" = mock ] && [ "$RESTART" = 0 ]; then
  rm -rf "$MOCK_HOME"
  mkdir -p "$MOCK_HOME/codex" "$MOCK_HOME/claude" "$MOCK_HOME/data/opencode" "$MOCK_HOME/config" "$MOCK_HOME/home"
  echo '{"tokens":{"access_token":"fixture-codex","account_id":"fixture-account","id_token":"e30.eyJlbWFpbCI6ImNvZGV4QGRpcmVjdC50ZXN0IiwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImNoYXRncHRfcGxhbl90eXBlIjoicGx1cyJ9fQ.signature"}}' >"$MOCK_HOME/codex/auth.json"
  echo '{"claudeAiOauth":{"accessToken":"fixture-claude","subscriptionType":"max","rateLimitTier":"default_claude_max_5x"}}' >"$MOCK_HOME/claude/.credentials.json"
  echo '{"opencode-go":{"key":"fixture-opencode"}}' >"$MOCK_HOME/data/opencode/auth.json"
  rm -f "$RUN_DIR/fixture.port"
  : >"$RUN_DIR/fixture-requests.log"
  setsid python3 "$SCRIPT_DIR/fixture-server.py" "$RUN_DIR/fixture.port" "$RUN_DIR/fixture-requests.log" "$SCENARIO" \
    >"$RUN_DIR/fixture.log" 2>&1 &
  echo $! >"$RUN_DIR/fixture.pid"
  readlink -f "$(command -v python3)" >"$RUN_DIR/fixture.exe"
  for _ in $(seq 1 10); do
    [ -s "$RUN_DIR/fixture.port" ] && break
    sleep 0.5
  done
  [ -s "$RUN_DIR/fixture.port" ] || { echo "Fixture server did not start:" >&2; cat "$RUN_DIR/fixture.log" >&2; exit 1; }
fi
if [ "$MODE" = mock ]; then
  preview_env+=(
    TANTALUS_USAGE_BASE_URL="http://127.0.0.1:$(cat "$RUN_DIR/fixture.port")"
    CODEX_HOME="$MOCK_HOME/codex"
    CLAUDE_CONFIG_DIR="$MOCK_HOME/claude"
    XDG_DATA_HOME="$MOCK_HOME/data"
    XDG_CONFIG_HOME="$MOCK_HOME/config"
    HOME="$MOCK_HOME/home"
  )
fi

"${preview_env[@]}" setsid "$BIN" --ozone-platform=x11 --remote-debugging-port="$cdp_port" </dev/null >"$RUN_DIR/preview.log" 2>&1 &
preview_pid=$!
echo "$preview_pid" >"$RUN_DIR/run.pid"

for _ in $(seq 1 30); do
  kill -0 "$preview_pid" 2>/dev/null || {
    echo "Preview exited early. Log tail:" >&2
    tail -n 20 "$RUN_DIR/preview.log" >&2
    exit 1
  }
  if curl -fsS "http://127.0.0.1:$cdp_port/json/list" 2>/dev/null | grep -q '"type": "page"'; then
    echo "Ready: Tantalus Preview ($MODE usage) on isolated display $display (pid $preview_pid, DevTools port $cdp_port)"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for the preview window." >&2
exit 1
