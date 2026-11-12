#!/usr/bin/env bash
# Sourced by run-dir.sh on WSL. The preview runs on Windows from a copy under %LOCALAPPDATA%, on a hidden
# desktop, and the harness reaches its DevTools and web ports through windows-relay.mjs (see wsl.md).
WINDOWS=1
BIN="$ROOT/release/tantalus-preview/win-unpacked/tantalus-preview.exe"
STATE_DIR="$(wslpath "$(cd /mnt/c && cmd.exe /d /c 'echo %LOCALAPPDATA%' | tr -d '\r')")/tantalus-verify/$(basename "$RUN_DIR")"
APP="$STATE_DIR/app/tantalus-preview.exe"
DESKTOP="tantalus-verify-$(basename "$RUN_DIR")"

# Replaces the built exe at $1 with the stock Electron exe the builder downloaded. The builder writes the
# app bundle's hash into its exe, so every code change makes an exe Windows has never seen, which Smart
# App Control blocks. The stock exe is the same for every build and loads the same resources/app.asar.
stock_electron() {
  local version zip
  version="$(node -p "require('$ROOT/node_modules/electron/package.json').version")"
  zip="$(find "${ELECTRON_CACHE:-$HOME/.cache/electron}" -name "electron-v$version-win32-x64.zip" 2>/dev/null | head -n 1 || true)"
  [ -n "$zip" ] || { echo "No Windows Electron $version download to take the stock exe from." >&2; return 1; }
  python3 -c 'import sys, zipfile; open(sys.argv[2], "wb").write(zipfile.ZipFile(sys.argv[1]).read("electron.exe"))' "$zip" "$1"
}

# Windows tools warn or fail when their working directory is inside WSL.
powershell() { (cd /mnt/c && powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass "$@" | tr -d '\r'); }

# Succeeds when the Windows process ID runs the harness's copy of the preview.
preview_owned() {
  [ -n "$1" ] && [ "$(powershell -Command "(Get-Process -Id $1 -ErrorAction SilentlyContinue).Path")" = "$(wslpath -w "$APP")" ]
}

# Stops a Windows process ID and its children, only while it runs the harness's copy.
windows_stop() {
  preview_owned "$1" || return 1
  (cd /mnt/c && taskkill.exe /PID "$1" /T /F >/dev/null)
  for _ in $(seq 1 10); do
    preview_owned "$1" || return 0
    sleep 1
  done
  return 1
}

# Starts the preview copy with the given arguments on the hidden desktop and prints its Windows process ID.
# Each NAME=VALUE before `--` reaches the preview's environment through WSLENV.
windows_launch() {
  local vars=() names=()
  while [ "$1" != -- ]; do
    vars+=("$1")
    names+=("${1%%=*}")
    shift
  done
  shift
  local command_line="\"$(wslpath -w "$APP")\" $*"
  (
    export "${vars[@]}" WSLENV="$(IFS=:; echo "${names[*]}")"
    powershell -File "$(wslpath -w "$(dirname "${BASH_SOURCE[0]}")/hidden-desktop.ps1")" "$DESKTOP" \
      "$(printf '%s' "$command_line" | base64 -w0)"
  )
}
