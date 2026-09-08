#!/usr/bin/env bash
# Static shell assertions against the served dev server. No browser needed.
# Usage: check-ui.sh <PORT>
set -u
PORT="${1:?usage: check-ui.sh <PORT>}"
fail=0
body="$(curl -s --max-time 5 "http://localhost:$PORT/")"
check() {
  local label="$1" needle="$2"
  if printf '%s' "$body" | grep -q "$needle"; then
    echo "OK $label"
  else
    echo "FAIL $label (missing $needle)"
    fail=1
  fi
}
check "root div" '<div id="root">'
check "title" '<title>Tantalus</title>'

bundle_url="$(printf '%s' "$body" | grep -o '/src/main.tsx[^"]*' | head -n 1)"
if [ -z "$bundle_url" ]; then
  echo "FAIL entry script /src/main.tsx not referenced"
  fail=1
else
  echo "OK entry script $bundle_url"
fi

for needle in "Short window" "Long window" "Reset credits" "Extra usage" "Refresh" "Auto-refreshes every 5 minutes" "Settings" "Open at login" "Version" "usage-snapshot" "cached_usage" "refresh_usage" "set_provider_enabled" "@tauri-apps/plugin-autostart" "--hidden" 'role="switch"'; do
  if grep -rq -- "$needle" src/main.tsx src/settings-page.tsx src/presentation.ts src-tauri/src/lib.rs 2>/dev/null; then
    echo "OK repo contains handle: $needle"
  else
    echo "FAIL repo handle missing: $needle"
    fail=1
  fi
done

[ "$fail" -eq 0 ] && echo "CHECK-UI: pass" || { echo "CHECK-UI: fail"; exit 1; }
