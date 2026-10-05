#!/usr/bin/env bash
# Copy the harness preview's exported tray icon to a destination PNG. The preview inherits the real
# session bus, so it registers its StatusNotifierItem there while its window sits on the isolated
# Xvfb display. Electron writes the icon into IconThemePath and leaves IconPixmap unset, so read
# that directory and copy its newest PNG.
set -euo pipefail
source "$(dirname "$0")/run-dir.sh"
PID="${2:-$(cat "$RUN_DIR/run.pid" 2>/dev/null || true)}"
DEST="${1:?usage: tray-icon.sh <dest.png> [preview-pid]}"
[ -n "$PID" ] || { echo "No preview pid: pass one or run launch.sh first." >&2; exit 1; }
SVC="org.freedesktop.StatusNotifierItem-$PID-1"
THEME_PATH="$(gdbus call --session --dest "$SVC" --object-path /StatusNotifierItem \
  --method org.freedesktop.DBus.Properties.Get org.kde.StatusNotifierItem IconThemePath)"
DIR="$(printf '%s' "$THEME_PATH" | grep -o "/[^']*" || true)"
[ -n "$DIR" ] && [ -d "$DIR" ] || { echo "No icon directory for $SVC (got: $THEME_PATH)." >&2; exit 1; }
newest=""
for png in "$DIR"/*.png; do
  [ -e "$png" ] || continue
  if [ -z "$newest" ] || [ "$png" -nt "$newest" ]; then newest="$png"; fi
done
[ -n "$newest" ] || { echo "No PNG in $DIR." >&2; exit 1; }
mkdir -p "$(dirname "$DEST")"
cp "$newest" "$DEST"
echo "TRAY-ICON: $newest -> $DEST"
