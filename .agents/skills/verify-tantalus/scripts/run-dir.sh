#!/usr/bin/env bash
# Sourced by the other scripts. Each checkout gets its own run directory, so agents in separate worktrees
# can verify at the same time. drive.ts derives the same path.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd -P)"
RUN_DIR="/tmp/opencode/tantalus-verify/$(basename "$ROOT")-$(printf %s "$ROOT" | sha1sum | cut -c1-8)"
BIN="$ROOT/release/tantalus-preview/linux-unpacked/tantalus-preview"
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  echo "$RUN_DIR"
fi
