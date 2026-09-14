#!/usr/bin/env bash
# Switch the fixture scenario a mock preview launch is served. The preview picks it up on its next read.
set -euo pipefail
NAME="${1:?usage: mock-scenario.sh <ready|monthly-only|blocked|no-windows|error>}"
RUN_DIR="/tmp/opencode/tantalus-verify"
PORT="$(cat "$RUN_DIR/fixture.port" 2>/dev/null)" || { echo "No mock launch is running." >&2; exit 1; }
curl -fsS -X POST "http://127.0.0.1:$PORT/__fixture/scenario/$NAME" || {
  echo "Unknown scenario $NAME." >&2
  exit 1
}
echo
