#!/usr/bin/env bash
# Launch the built preview on an isolated virtual display, or a hidden Windows desktop on WSL, with its
# DevTools protocol open for drive.ts.
# --mock serves fixture usage instead of the live APIs. --restart relaunches only the preview, keeping the
# display, the usage mode, the fixture server, and every saved setting, to prove what survives a restart.
set -euo pipefail
source "$(dirname "$0")/run-dir.sh"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
MODE="real"
SCENARIO="ready"
RESTART=0
case "${1:-}" in
  "") ;;
  --mock) MODE="mock"; SCENARIO="${2:-ready}" ;;
  --restart) RESTART=1; MODE="$(cat "$RUN_DIR/run.mode" 2>/dev/null || echo real)" ;;
  *) echo "usage: launch.sh [--mock [SCENARIO] | --restart]" >&2; exit 1 ;;
esac
XVFB="${TANTALUS_XVFB:-$(command -v Xvfb || true)}"
mkdir -p "$RUN_DIR"

if [ "$WINDOWS" = 1 ]; then
  [ -f "$APP" ] || { echo "Preview binary missing. Run build-preview.sh first." >&2; exit 1; }
else
  [ -x "$BIN" ] || { echo "Preview binary missing. Run build-preview.sh first." >&2; exit 1; }
  [ -x "$XVFB" ] || { echo "Xvfb is required. Install it or set TANTALUS_XVFB." >&2; exit 1; }
fi

preview_running() { preview_owned "$(cat "$RUN_DIR/run.pid" 2>/dev/null)"; }

free_port() { python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])'; }

# The preview reads paths in its own platform's form.
preview_path() { if [ "$WINDOWS" = 1 ]; then wslpath -w "$1"; else printf %s "$1"; fi; }

# Starts a relay from a free local port to a Windows port and prints the local port.
start_relay() {
  local name="$1" windows_port="$2" local_port
  local_port="$(free_port)"
  setsid node "$SCRIPT_DIR/windows-relay.mjs" "$windows_port" "$local_port" >"$RUN_DIR/$name.log" 2>&1 &
  echo $! >"$RUN_DIR/$name.pid"
  # The node on PATH can be a version manager shim that execs the real one.
  node -p "require(\"node:fs\").realpathSync(process.execPath)" >"$RUN_DIR/$name.exe"
  echo "$local_port"
}

if [ "$RESTART" = 1 ]; then
  [ -s "$RUN_DIR/run.display" ] || { echo "Nothing to restart. Run launch.sh first." >&2; exit 1; }
  if [ "$WINDOWS" = 1 ]; then
    windows_stop "$(cat "$RUN_DIR/run.pid" 2>/dev/null)" || true
    relay="$(cat "$RUN_DIR/cdp-relay.pid" 2>/dev/null)"
    [ -n "$relay" ] && [ "$(readlink -f "/proc/$relay/exe" 2>/dev/null)" = "$(cat "$RUN_DIR/cdp-relay.exe")" ] && kill "$relay"
  elif preview_running; then
    kill "$(cat "$RUN_DIR/run.pid")"
    for _ in $(seq 1 10); do
      preview_running || break
      sleep 1
    done
  fi
  preview_running && { echo "The preview did not quit. Run cleanup.sh." >&2; exit 1; }
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
elif [ "$WINDOWS" = 1 ]; then
  # The hidden desktop appears with the preview and goes away when it quits.
  display="$DESKTOP"
  echo "$display" >"$RUN_DIR/run.display"
  # Remote access listens on Windows, so the harness reaches the preview's web port through a relay.
  echo "$(start_relay web-relay 4748)" >"$RUN_DIR/run.web"
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
preview_vars=()
if [ "$MODE" = mock ] && [ "$RESTART" = 0 ]; then
  rm -rf "$MOCK_HOME"
  mkdir -p "$MOCK_HOME/codex" "$MOCK_HOME/claude" "$MOCK_HOME/data/opencode" "$MOCK_HOME/config" "$MOCK_HOME/home"
  echo '{"tokens":{"access_token":"fixture-codex","account_id":"fixture-account","id_token":"e30.eyJlbWFpbCI6ImNvZGV4QGRpcmVjdC50ZXN0IiwiaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS9hdXRoIjp7ImNoYXRncHRfcGxhbl90eXBlIjoicGx1cyJ9fQ.signature"}}' >"$MOCK_HOME/codex/auth.json"
  echo '{"claudeAiOauth":{"accessToken":"fixture-claude","subscriptionType":"max","rateLimitTier":"default_claude_max_5x"}}' >"$MOCK_HOME/claude/.credentials.json"
  echo '{"opencode-go":{"key":"fixture-opencode"}}' >"$MOCK_HOME/data/opencode/auth.json"
  if [ "$WINDOWS" = 1 ]; then
    # Fixture credentials stand in for the Windows sign-in only, so WSL sign-ins stay unread.
    mkdir -p "$MOCK_HOME/config/dev.arnab.tantalus.preview"
    echo '{"windows":true,"wsl":false}' >"$MOCK_HOME/config/dev.arnab.tantalus.preview/sign-ins.json"
  fi
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
# Settings, the single-instance lock and the autostart entry all follow XDG_CONFIG_HOME on Linux, so a
# private one lets previews from other worktrees, or an installed preview, run at the same time. Windows
# keeps settings and the lock under TANTALUS_APP_DATA, which only previews honor.
if [ "$MODE" = real ]; then
  config="$STATE_DIR/real-config"
else
  config="$MOCK_HOME/config"
  preview_vars+=(
    TANTALUS_USAGE_BASE_URL="http://127.0.0.1:$(cat "$RUN_DIR/fixture.port")"
    CODEX_HOME="$(preview_path "$MOCK_HOME/codex")"
    CLAUDE_CONFIG_DIR="$(preview_path "$MOCK_HOME/claude")"
    XDG_DATA_HOME="$(preview_path "$MOCK_HOME/data")"
    HOME="$(preview_path "$MOCK_HOME/home")"
  )
fi
mkdir -p "$config"

if [ "$WINDOWS" = 1 ]; then
  devtools_file="$config/dev.arnab.tantalus.preview/DevToolsActivePort"
  rm -f "$devtools_file"
  preview_pid="$(windows_launch "${preview_vars[@]}" TANTALUS_APP_DATA="$(wslpath -w "$config")" -- --remote-debugging-port=0)"
  echo "$preview_pid" >"$RUN_DIR/run.pid"
  # The first launch of a fresh copy waits while Windows scans it.
  for _ in $(seq 1 60); do
    [ -s "$devtools_file" ] && break
    sleep 1
  done
  [ -s "$devtools_file" ] || { echo "The preview did not open its DevTools port." >&2; exit 1; }
  cdp_port="$(start_relay cdp-relay "$(head -n 1 "$devtools_file" | tr -d '\r')")"
else
  cdp_port="$(free_port)"
  # A shell inside another Electron app can carry ELECTRON_RUN_AS_NODE, which starts a bare Node instead.
  env -u TANTALUS_USAGE_BASE_URL -u ELECTRON_RUN_AS_NODE DISPLAY="$display" XDG_CONFIG_HOME="$config" "${preview_vars[@]}" \
    setsid "$BIN" --ozone-platform=x11 --remote-debugging-port="$cdp_port" </dev/null >"$RUN_DIR/preview.log" 2>&1 &
  preview_pid=$!
  echo "$preview_pid" >"$RUN_DIR/run.pid"
fi
echo "$cdp_port" >"$RUN_DIR/run.cdp"

for _ in $(seq 1 30); do
  # The recorded pid becomes the preview only once env and setsid exec it.
  sleep 1
  preview_running || {
    echo "Preview exited early." >&2
    [ -f "$RUN_DIR/preview.log" ] && tail -n 20 "$RUN_DIR/preview.log" >&2
    exit 1
  }
  if curl -fsS "http://127.0.0.1:$cdp_port/json/list" 2>/dev/null | grep -q '"type": "page"'; then
    echo "Ready: Tantalus Preview ($MODE usage) on isolated display $display (pid $preview_pid, DevTools port $cdp_port, run directory $RUN_DIR)"
    exit 0
  fi
done

echo "Timed out waiting for the preview window." >&2
exit 1
