#!/usr/bin/env bash
# Stop only the preview, fixture server, and virtual display started by launch.sh.
set -u
RUN_DIR="/tmp/opencode/tantalus-verify"
BIN="release/tantalus-preview/linux-unpacked/tantalus-preview"
SCAFFOLDING=("$RUN_DIR/coverage-home" "$RUN_DIR/mock-home")

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
stop_owned "fixture server" "$RUN_DIR/fixture.pid" "$(cat "$RUN_DIR/fixture.exe" 2>/dev/null || true)"
stop_owned Xvfb "$RUN_DIR/xvfb.pid" "$(cat "$RUN_DIR/xvfb.exe" 2>/dev/null || true)"
rm -f "$RUN_DIR/run.pid" "$RUN_DIR/xvfb.pid" "$RUN_DIR/xvfb.exe" "$RUN_DIR/run.display" "$RUN_DIR/run.cdp" \
  "$RUN_DIR/run.mode" "$RUN_DIR/fixture.pid" "$RUN_DIR/fixture.exe" "$RUN_DIR/fixture.port"

for scaffolding in "${SCAFFOLDING[@]}"; do
  if [ -d "$scaffolding" ]; then
    echo "Removing verification scaffolding $scaffolding"
    rm -rf "$scaffolding"
  fi
done
echo "CLEANUP: done (evidence preserved)"
