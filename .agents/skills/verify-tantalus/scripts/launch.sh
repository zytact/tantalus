#!/usr/bin/env bash
# Isolated Vite start for verification. Never steals port 1420.
# Usage: launch.sh [PORT]
set -u
RUN_DIR="/tmp/opencode/tantalus-verify"
PID_FILE="$RUN_DIR/run.pid"
PORT_FILE="$RUN_DIR/run.port"
LOG_FILE="$RUN_DIR/vite.log"
mkdir -p "$RUN_DIR"

wanted="${1:-}"
pick_port() {
  for p in $(seq 1421 1450); do
    if ! curl -s -o /dev/null --max-time 1 "http://localhost:$p/" 2>/dev/null; then
      echo "$p"
      return 0
    fi
  done
  return 1
}

if [ -n "$wanted" ]; then
  if curl -s -o /dev/null --max-time 1 "http://localhost:$wanted/" 2>/dev/null; then
    echo "Refusing: port $wanted already answers (not stealing a shared instance)." >&2
    exit 1
  fi
  PORT="$wanted"
else
  PORT="$(pick_port)" || { echo "No free port in 1421-1450." >&2; exit 1; }
fi

if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "Refusing: an instance from a previous launch is still running (pid $(cat "$PID_FILE")). Run cleanup.sh first." >&2
  exit 1
fi

echo "Starting vite on port $PORT (log $LOG_FILE)..."
setsid vp dev --port "$PORT" --strictPort false </dev/null >"$LOG_FILE" 2>&1 &
PID=$!
echo "$PID" >"$PID_FILE"
echo "$PORT" >"$PORT_FILE"

for i in $(seq 1 30); do
  if curl -s --max-time 2 "http://localhost:$PORT/" 2>/dev/null | grep -q "<title>Tantalus</title>"; then
    echo "Ready on http://localhost:$PORT/ (pid $PID)"
    exit 0
  fi
  if ! kill -0 "$PID" 2>/dev/null; then
    echo "Vite exited early. Log tail:" >&2
    tail -n 20 "$LOG_FILE" >&2
    rm -f "$PID_FILE" "$PORT_FILE"
    exit 1
  fi
  sleep 1
done

echo "Timed out waiting for http://localhost:$PORT/ . Log tail:" >&2
tail -n 20 "$LOG_FILE" >&2
exit 1
