#!/usr/bin/env bash
# Sourced by the other scripts. Each checkout gets its own run directory, so agents in separate worktrees
# can verify at the same time. drive.ts derives the same path.
# On WSL the preview runs on Windows (see wsl.md) unless TANTALUS_VERIFY_LINUX=1 keeps it in WSL.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd -P)"
RUN_DIR="/tmp/opencode/tantalus-verify/$(basename "$ROOT")-$(printf %s "$ROOT" | sha1sum | cut -c1-8)"
if [ -n "${WSL_DISTRO_NAME:-}" ] && [ -z "${TANTALUS_VERIFY_LINUX:-}" ]; then
  source "$(dirname "${BASH_SOURCE[0]}")/wsl.sh"
else
  WINDOWS=0
  BIN="$ROOT/release/tantalus-preview/linux-unpacked/tantalus-preview"
  STATE_DIR="$RUN_DIR"
fi
MOCK_HOME="$STATE_DIR/mock-home"
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "$RUN_DIR"
fi
