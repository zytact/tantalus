#!/usr/bin/env bash
# Tear down only what launch.sh started. Never kills by process name.
# Evidence under /tmp/opencode/tantalus-verify/<timestamp>/ is left alone.
set -u
RUN_DIR="/tmp/opencode/tantalus-verify"
PID_FILE="$RUN_DIR/run.pid"
PORT_FILE="$RUN_DIR/run.port"
FIXTURE_HOME="$RUN_DIR/coverage-home"

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "Stopping pid $PID..."
    kill "$PID" 2>/dev/null || true
    for _ in $(seq 1 5); do
      kill -0 "$PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$PID" 2>/dev/null; then
      echo "Still alive, kill -9 pid $PID (same pid only)"
      kill -9 "$PID" 2>/dev/null || true
    fi
  else
    echo "Pid $PID already gone."
  fi
  rm -f "$PID_FILE" "$PORT_FILE"
else
  echo "No pidfile at $PID_FILE; nothing started by launch.sh to stop."
fi

if [ -d "$FIXTURE_HOME" ]; then
  echo "Removing verification scaffolding $FIXTURE_HOME"
  rm -rf "$FIXTURE_HOME"
fi
echo "CLEANUP: done (evidence preserved)"
