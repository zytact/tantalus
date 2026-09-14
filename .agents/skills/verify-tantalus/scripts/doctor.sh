#!/usr/bin/env bash
# Read-only check that the isolated preview is worth driving.
set -u
RUN_DIR="/tmp/opencode/tantalus-verify"
BIN="src-tauri/target/release/tantalus-preview"
fail=0

if grep -q '"productName": "Tantalus Preview"' src-tauri/tauri.preview.conf.json &&
  grep -q '"identifier": "dev.arnab.tantalus.preview"' src-tauri/tauri.preview.conf.json &&
  grep -q '"mainBinaryName": "tantalus-preview"' src-tauri/tauri.preview.conf.json; then
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

mode="$(cat "$RUN_DIR/run.mode" 2>/dev/null || echo real)"
origin="$(tr '\0' '\n' <"/proc/$preview_pid/environ" 2>/dev/null | sed -n 's/^TANTALUS_USAGE_BASE_URL=//p')"
if [ "$mode" = mock ]; then
  fixture_pid="$(cat "$RUN_DIR/fixture.pid" 2>/dev/null || true)"
  if [ -n "$fixture_pid" ] && kill -0 "$fixture_pid" 2>/dev/null &&
    [ "$(readlink -f "/proc/$fixture_pid/exe" 2>/dev/null)" = "$(cat "$RUN_DIR/fixture.exe" 2>/dev/null)" ] &&
    [ -n "$origin" ] && curl -fsS "$origin/__fixture/health" >/dev/null 2>&1; then
    echo "OK mock usage: preview reads $origin from harness fixture pid $fixture_pid"
  else
    echo "FAIL mock usage: fixture server is missing or the preview does not point at it"
    fail=1
  fi
elif [ -z "$origin" ]; then
  echo "OK real usage: preview has no fixture origin"
else
  echo "FAIL real usage: preview still points at $origin"
  fail=1
fi

[ "$fail" -eq 0 ] && echo "DOCTOR: worth driving" || { echo "DOCTOR: not worth driving"; exit 1; }
