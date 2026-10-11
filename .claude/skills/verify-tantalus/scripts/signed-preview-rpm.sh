#!/usr/bin/env bash
# Build a preview rpm that trusts a throwaway key kept in the run directory, and sign it with that key,
# so the root update helper can be driven without the release signing key. RELEASE is the rpm release
# number: a higher one updates a lower one. Only the build output is patched, never the source.
set -euo pipefail
release="${1:?usage: signed-preview-rpm.sh RELEASE}"
source "$(dirname "$0")/run-dir.sh"
out="$RUN_DIR/update-proof"
key="$out/throwaway.key"
mkdir -p "$out"
cd "$ROOT"

signer() { node --input-type=module -e 'import { run } from "@tauri-apps/cli"; await run(process.argv.slice(1));' signer "$@"; }
[ -f "$key" ] || signer generate --ci -p "" -w "$key" >/dev/null

real="$(grep -o 'dW50cnVzdGVkIGNvbW1lbnQ6[A-Za-z0-9+/=]*' src/main/release.ts)"
# The next build must trust the release key again.
trap 'vp pack >/dev/null' EXIT
vp build
vp pack
sed -i "s|$real|$(tr -d '\n' <"$key.pub")|" dist-electron/main.mjs dist-electron/update-helper.mjs
grep -q "$(tr -d '\n' <"$key.pub")" dist-electron/update-helper.mjs || { echo "The helper bundle does not carry the release key to replace." >&2; exit 1; }
BUILD_NUMBER="$release" node scripts/package.ts --preview

rpm="$out/tantalus-preview-$release.rpm"
cp release/tantalus-preview/tantalus-preview-*.x86_64.rpm "$rpm"
TAURI_SIGNING_PRIVATE_KEY="$(cat "$key")" TAURI_SIGNING_PRIVATE_KEY_PASSWORD="" signer sign "$rpm" >/dev/null
echo "SIGNED-PREVIEW-RPM: pass ($(rpm -qp --qf '%{NAME}-%{VERSION}-%{RELEASE}' "$rpm"))"
echo "$rpm"
echo "$rpm.sig"
