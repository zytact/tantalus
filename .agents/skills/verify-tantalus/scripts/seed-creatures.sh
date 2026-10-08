#!/usr/bin/env bash
# Seed a moving pace stretch so a dragon (Codex 5h, fast) and a tortoise
# (Claude 5h, slow + recent local session) ride the allowance bars.
# Mock mode only: it never touches a real pace log.
# Run launch.sh --restart afterwards, since the preview reads the log once at startup.
set -euo pipefail
source "$(dirname "$0")/run-dir.sh"
LOG="$RUN_DIR/mock-home/config/dev.arnab.tantalus.preview/pace-log.json"
[ "$(cat "$RUN_DIR/run.mode" 2>/dev/null)" = mock ] || { echo "Refusing: seed-creatures.sh needs a mock launch." >&2; exit 1; }
mkdir -p "$(dirname "$LOG")"
python3 - "$LOG" <<'PY'
import hashlib, json, sys, time
now = int(time.time())
DAY = 86_400

def sha(parts):
    return hashlib.sha256(json.dumps(parts, separators=(",", ":")).encode()).hexdigest()

codex_id = sha(["account", "fixture-account"])
claude_id = sha(["email", "claude@direct.test"])
usual_readings = [1.5, 2, 2.5, 3, 2, 8]  # median 2.25 %/h; normal preset: dragon >= 5.625, tortoise <= 0.9

def usual():
    return {"firstSeen": now - 30 * DAY, "last": {"epoch": now - 600, "used": 40, "resetAt": None},
            "stretch": None, "readings": list(usual_readings)}

log = {}
for provider, tier, durations in [("codex", "plus", [18000, 604800]),
                                  ("claude", "max 5x", [18000, 604800]),
                                  ("opencode", "go", [18000, 604800, 2592000])]:
    for duration in durations:
        log[json.dumps(["usual", provider, tier, duration], separators=(",", ":"))] = usual()

# Dragon: Codex 5h fixture sits at 40% used; a 10-point rise over ~28 min reads ~21 %/h.
dragon_ticks = [{"epoch": now - 1800, "used": 30}, {"epoch": now - 1200, "used": 33.3},
                {"epoch": now - 600, "used": 36.6}, {"epoch": now - 120, "used": 40}]
log[json.dumps(["current", "codex:18000", "plus", codex_id], separators=(",", ":"))] = {
    "firstSeen": now - 30 * DAY,
    "last": {"epoch": now - 120, "used": 40, "resetAt": now + 3 * 3600},
    "stretch": {"ticks": dragon_ticks, "pending": 0, "activeAt": None},
    "readings": []}

# Tortoise: Claude 5h fixture sits at 91% used; a 1.5-point rise over ~2 h reads ~0.75 %/h.
# It also needs the provider in use (see the session file below).
tortoise_ticks = [{"epoch": now - 7200, "used": 89.5}, {"epoch": now - 5400, "used": 89.9},
                  {"epoch": now - 3600, "used": 90.4}, {"epoch": now - 300, "used": 91}]
log[json.dumps(["current", "claude:18000", "max 5x", claude_id], separators=(",", ":"))] = {
    "firstSeen": now - 30 * DAY,
    "last": {"epoch": now - 60, "used": 91, "resetAt": now + 3600},
    "stretch": {"ticks": tortoise_ticks, "pending": 0, "activeAt": now - 30},
    "readings": []}

json.dump(log, open(sys.argv[1], "w"))
print(f"Seeded dragon (codex 5h) + tortoise (claude 5h) stretches in {sys.argv[1]}")
PY
# Recent Claude session activity, so the slow Claude window reads as in use (tortoise),
# not idle. Mirrors src/main/activity.ts: claude watches <CLAUDE_CONFIG_DIR>/projects/* files.
SESSION_DIR="$RUN_DIR/mock-home/claude/projects/fixture-session"
mkdir -p "$SESSION_DIR"
echo '{"type":"session","provider":"claude"}' >"$SESSION_DIR/session.jsonl"
touch "$SESSION_DIR/session.jsonl"
echo "Touched recent Claude session in $SESSION_DIR/session.jsonl"
echo "Next: launch.sh --restart, then doctor.sh"
