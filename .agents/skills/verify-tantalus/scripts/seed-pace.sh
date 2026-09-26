#!/usr/bin/env bash
# Write a learned pace log for the mock preview's Codex and Claude windows, so the dragon and tortoise
# details and Reset learning have something to show. Mock mode only: it never touches a real pace log.
# Run launch.sh --restart afterwards, since the preview reads the log once at startup.
set -euo pipefail
RUN_DIR="/tmp/opencode/tantalus-verify"
LOG="$RUN_DIR/mock-home/config/dev.arnab.tantalus.preview/pace-log.json"
[ "$(cat "$RUN_DIR/run.mode" 2>/dev/null)" = mock ] || { echo "Refusing: seed-pace.sh needs a mock launch." >&2; exit 1; }
mkdir -p "$(dirname "$LOG")"
python3 - "$LOG" <<'PY'
import json, sys, time
now = int(time.time())
learned = lambda used: {"firstSeen": now - 30 * 86_400, "last": {"epoch": now - 600, "used": used, "resetAt": None},
                        "stretch": None, "readings": [1.5, 2, 2.5, 3, 2, 8]}
keys = {"codex:18000": 40, "codex:604800": 12, "claude:18000": 91, "claude:604800": 55}
json.dump({key: learned(used) for key, used in keys.items()}, open(sys.argv[1], "w"))
print(f"Seeded {len(keys)} learned windows in {sys.argv[1]}")
PY
