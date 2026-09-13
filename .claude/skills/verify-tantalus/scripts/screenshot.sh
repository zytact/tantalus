#!/usr/bin/env bash
# Capture and trim the native preview window from its isolated display.
set -euo pipefail
EVIDENCE_DIR="${1:?usage: screenshot.sh <EVIDENCE_DIR> [NAME]}"
NAME="${2:-screenshot}"
RUN_DIR="/tmp/opencode/tantalus-verify"
DISPLAY_ID="$(cat "$RUN_DIR/run.display")"
OUTPUT="$EVIDENCE_DIR/$NAME.png"
TEMP="$EVIDENCE_DIR/.$NAME-root.png"

mkdir -p "$EVIDENCE_DIR"
DISPLAY="$DISPLAY_ID" import -window root "$TEMP"
magick "$TEMP" -trim "$OUTPUT"
rm -f "$TEMP"

dimensions="$(magick identify -format '%w %h' "$OUTPUT")"
printf '%s\n' "$dimensions" | awk '$1 >= 360 && $2 >= 500 { found=1 } END { exit !found }' || {
  echo "Captured image is too small to be the preview window: $dimensions" >&2
  exit 1
}
echo "SCREENSHOT: $OUTPUT ($dimensions)"
