#!/usr/bin/env bash
# Read-only check: is this verification instance worth driving?
# Usage: doctor.sh [PORT]
set -u
RUN_DIR="/tmp/opencode/tantalus-verify"
PID_FILE="$RUN_DIR/run.pid"
PORT_FILE="$RUN_DIR/run.port"
PORT="${1:-}"
if [ -z "$PORT" ] && [ -f "$PORT_FILE" ]; then
  PORT="$(cat "$PORT_FILE")"
fi
PORT="${PORT:-1421}"
fail=0

echo "== tantalus doctor (port $PORT) =="

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE")"
  if kill -0 "$PID" 2>/dev/null; then
    echo "OK pid $PID from $PID_FILE is alive"
    echo "   cmd: $(ps -o args= -p "$PID" 2>/dev/null | head -c 160)"
  else
    echo "WARN pid $PID from $PID_FILE is not alive"
    fail=1
  fi
else
  echo "WARN no pidfile at $PID_FILE (no instance started by launch.sh?)"
  fail=1
fi

HTTP_CODE="$(curl -s -o /tmp/opencode-tantalus-doctor.html -w "%{http_code}" "http://localhost:$PORT/" 2>/dev/null || echo "000")"
if [ "$HTTP_CODE" = "200" ]; then
  echo "OK http://localhost:$PORT/ answers 200"
else
  echo "FAIL http://localhost:$PORT/ answers $HTTP_CODE"
  fail=1
fi
if grep -q "<title>Tantalus</title>" /tmp/opencode-tantalus-doctor.html 2>/dev/null; then
  echo "OK served page is Tantalus"
else
  echo "FAIL served page is not Tantalus (wrong server on this port?)"
  fail=1
fi
rm -f /tmp/opencode-tantalus-doctor.html

if grep -q '"productName": "Tantalus"' src-tauri/tauri.conf.json 2>/dev/null; then
  echo "OK tauri.conf.json productName is Tantalus"
else
  echo "FAIL tauri.conf.json productName mismatch (wrong repo root?)"
  fail=1
fi
if [ -d dist ] && [ -f dist/index.html ]; then
  echo "OK dist/index.html exists (run vp build if stale)"
else
  echo "WARN dist/ missing (run vp build before Tauri checks)"
fi

if [ -n "${CODEX_HOME:-}" ]; then
  echo "INFO CODEX_HOME=$CODEX_HOME (verification must use a temp dir, never the real home)"
else
  echo "INFO CODEX_HOME unset"
fi
if [ -f "$HOME/.codex/auth.json" ]; then
  echo "INFO real $HOME/.codex/auth.json exists (do not read or print it)"
else
  echo "INFO no real $HOME/.codex/auth.json (expect Loading/AuthMissing outside Tauri)"
fi

if command -v ss >/dev/null 2>&1; then
  owner="$(ss -ltnp 2>/dev/null | grep ":$PORT " | head -n 1 || true)"
  [ -n "$owner" ] && echo "INFO port owner: $owner"
fi

if [ "$fail" -ne 0 ]; then
  echo "DOCTOR: not worth driving (see FAIL/WARN above)"
  exit 1
fi
echo "DOCTOR: worth driving"
