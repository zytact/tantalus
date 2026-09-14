#!/usr/bin/env bash
# Read-only check that the isolated preview is worth driving.
set -u
RUN_DIR="/tmp/opencode/tantalus-verify"
BIN="release/tantalus-preview/linux-unpacked/tantalus-preview"
fail=0

if grep -q 'productName: "Tantalus Preview"' src/main/identity.ts &&
  grep -q 'appId: "dev.arnab.tantalus.preview"' src/main/identity.ts &&
  grep -q 'executableName: "tantalus-preview"' src/main/identity.ts; then
  echo "OK preview name, identifier, and binary name are isolated from release"
else
  echo "FAIL preview identity config is incomplete"
  fail=1
fi

preview_pid="$(cat "$RUN_DIR/run.pid" 2>/dev/null || true)"
if [ -n "$preview_pid" ] && kill -0 "$preview_pid" 2>/dev/null &&
  [ "$(readlink -f "/proc/$preview_pid/exe" 2>/dev/null)" = "$(readlink -f "$BIN")" ]; then
  echo "OK pid $preview_pid is the built preview binary"
else
  echo "FAIL preview process is missing or foreign"
  fail=1
fi

xvfb_pid="$(cat "$RUN_DIR/xvfb.pid" 2>/dev/null || true)"
xvfb_exe="$(cat "$RUN_DIR/xvfb.exe" 2>/dev/null || true)"
display="$(cat "$RUN_DIR/run.display" 2>/dev/null || true)"
if [ -n "$xvfb_pid" ] && [ -n "$xvfb_exe" ] && kill -0 "$xvfb_pid" 2>/dev/null &&
  [ "$(readlink -f "/proc/$xvfb_pid/exe" 2>/dev/null)" = "$xvfb_exe" ] &&
  DISPLAY="$display" xprop -root >/dev/null 2>&1; then
  echo "OK isolated display $display belongs to harness Xvfb pid $xvfb_pid"
else
  echo "FAIL isolated display is missing or foreign"
  fail=1
fi

cdp_port="$(cat "$RUN_DIR/run.cdp" 2>/dev/null || true)"
if [ -n "$cdp_port" ] && curl -fsS "http://127.0.0.1:$cdp_port/json/list" 2>/dev/null | grep -q '"type": "page"'; then
  echo "OK DevTools port $cdp_port serves the preview window"
else
  echo "FAIL DevTools port is missing or has no window; open the window from the tray or relaunch"
  fail=1
fi

# Chromium rewrites its own /proc environ, so the usage mode is proved by traffic rather than by
# reading the preview's environment: the launch refreshes at once, and only fixture credentials get a 200.
mode="$(cat "$RUN_DIR/run.mode" 2>/dev/null || echo real)"
fixture_pid="$(cat "$RUN_DIR/fixture.pid" 2>/dev/null || true)"
fixture_alive=0
[ -n "$fixture_pid" ] && kill -0 "$fixture_pid" 2>/dev/null &&
  [ "$(readlink -f "/proc/$fixture_pid/exe" 2>/dev/null)" = "$(cat "$RUN_DIR/fixture.exe" 2>/dev/null)" ] && fixture_alive=1
if [ "$mode" = mock ]; then
  if [ "$fixture_alive" = 1 ] && grep -q "GET /" "$RUN_DIR/fixture-requests.log" 2>/dev/null; then
    echo "OK mock usage: harness fixture pid $fixture_pid has served the preview's reads"
  else
    echo "FAIL mock usage: fixture server is missing or the preview has not read from it"
    fail=1
  fi
elif [ "$fixture_alive" = 0 ]; then
  echo "OK real usage: no harness fixture server is running"
else
  echo "FAIL real usage: a fixture server is still running from an earlier mock launch"
  fail=1
fi

[ "$fail" -eq 0 ] && echo "DOCTOR: worth driving" || { echo "DOCTOR: not worth driving"; exit 1; }
