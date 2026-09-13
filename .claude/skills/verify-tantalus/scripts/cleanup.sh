#!/usr/bin/env bash
# Stop only the preview and virtual display started by launch.sh.
set -u
RUN_DIR="/tmp/opencode/tantalus-verify"
BIN="src-tauri/target/release/tantalus-preview"
FIXTURE_HOME="$RUN_DIR/coverage-home"

stop_owned() {
  local label="$1" pid_file="$2" expected_exe="$3"
  [ -f "$pid_file" ] || return 0
  local pid
  pid="$(cat "$pid_file")"
  if kill -0 "$pid" 2>/dev/null &&
    [ "$(readlink -f "/proc/$pid/exe" 2>/dev/null)" = "$expected_exe" ]; then
    echo "Stopping $label pid $pid..."
    kill "$pid" 2>/dev/null || true
    for _ in $(seq 1 5); do
      kill -0 "$pid" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$pid" 2>/dev/null; then
      echo "$label still alive, killing owned pid $pid"
      kill -9 "$pid" 2>/dev/null || true
    fi
  else
    echo "Recorded $label pid $pid is gone or foreign; leaving it alone."
  fi
}

stop_owned preview "$RUN_DIR/run.pid" "$(readlink -f "$BIN" 2>/dev/null)"
stop_owned Xvfb "$RUN_DIR/xvfb.pid" "$(cat "$RUN_DIR/xvfb.exe" 2>/dev/null || true)"
rm -f "$RUN_DIR/run.pid" "$RUN_DIR/xvfb.pid" "$RUN_DIR/xvfb.exe" "$RUN_DIR/run.display" "$RUN_DIR/readiness.png"

if [ -d "$FIXTURE_HOME" ]; then
  echo "Removing verification scaffolding $FIXTURE_HOME"
  rm -rf "$FIXTURE_HOME"
fi
echo "CLEANUP: done (evidence preserved)"
