#!/usr/bin/env bash
# Write a learned pace log for the mock preview's Codex and Claude windows, so the dragon and tortoise
# details and Reset learning have something to show. Mock mode only: it never touches a real pace log.
# Run launch.sh --restart afterwards, since the preview reads the log once at startup.
set -euo pipefail
source "$(dirname "$0")/run-dir.sh"
LOG="$RUN_DIR/mock-home/config/dev.arnab.tantalus.preview/pace-log.json"
[ "$(cat "$RUN_DIR/run.mode" 2>/dev/null)" = mock ] || { echo "Refusing: seed-pace.sh needs a mock launch." >&2; exit 1; }
mkdir -p "$(dirname "$LOG")"
python3 - "$LOG" <<'PY'
import json, sys, time
now = int(time.time())
learned = lambda used: {"firstSeen": now - 30 * 86_400, "last": {"epoch": now - 600, "used": used, "resetAt": None},
                        "stretch": None, "readings": [1.5, 2, 2.5, 3, 2, 8]}
log = {}
for provider, tier, durations in [
    ("codex", "plus", [18000, 604800]),
    ("claude", "max 5x", [18000, 604800]),
    ("opencode", "go", [18000, 604800, 2592000]),
]:
    for duration in durations:
        # Compact separators match JSON.stringify, which names the app's log keys.
        log[json.dumps(["usual", provider, tier, duration], separators=(",", ":"))] = learned(40)
json.dump(log, open(sys.argv[1], "w"))
print(f"Seeded {len(log)} learned windows in {sys.argv[1]}")
PY
