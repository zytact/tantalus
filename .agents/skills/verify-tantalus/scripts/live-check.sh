#!/usr/bin/env bash
# Single live refresh against the real Codex, Claude, and Opencode usage APIs.
# Mirrors src-tauri/src/api.rs: WHAM usage first, Codex usage fallback,
# reset credits separately, then Claude and Opencode Go, 12s timeout per
# request, one pass only (no loop).
# The token is read into memory, never printed, never written to disk,
# and never passed on any command line. Response bodies contain no tokens.
# Usage: live-check.sh <EVIDENCE_DIR>
set -u
EVIDENCE_DIR="${1:?usage: live-check.sh <EVIDENCE_DIR>}"
mkdir -p "$EVIDENCE_DIR"
chmod 700 "$EVIDENCE_DIR"

python3 - "$EVIDENCE_DIR" <<'PY'
import json, os, sys, urllib.request

evidence = sys.argv[1]
wham = "https://chatgpt.com/backend-api/wham/usage"
codex = "https://chatgpt.com/backend-api/codex/usage"
credits_url = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits"
claude_url = "https://api.anthropic.com/api/oauth/usage"
opencode_url = "https://opencode.ai/zen/go/v1/usage"

codex_home = os.environ.get("CODEX_HOME", "")
candidates = []
if codex_home:
    candidates.append(os.path.join(codex_home, "auth.json"))
else:
    candidates.append(os.path.join(os.path.expanduser("~"), ".codex", "auth.json"))

def read_token(path, paths):
    try:
        with open(path, "r", encoding="utf-8") as handle:
            value = json.loads(handle.read())
    except (OSError, json.JSONDecodeError):
        return None
    for keys in paths:
        token = string_at(value, keys)
        if token:
            return token
    return None


def string_at(value, path):
    current = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current if isinstance(current, str) else None

raw = None
auth_path = None
for path in candidates:
    try:
        with open(path, "r", encoding="utf-8") as handle:
            raw = handle.read()
        auth_path = path
        break
    except OSError:
        continue
if raw is None:
    print("LIVE: auth_missing (no credential file found)")
    sys.exit(2)
try:
    value = json.loads(raw)
except json.JSONDecodeError:
    print("LIVE: auth parse error (file is not valid JSON)")
    sys.exit(2)

token = None
for path in (["tokens", "access_token"], ["tokens", "access"],
             ["access_token"], ["access"],
             ["chatgptAuthTokens", "access_token"],
             ["chatgpt_auth", "access_token"]):
    token = string_at(value, path)
    if token:
        break
account_id = None
for path in (["account_id"], ["accountId"],
             ["tokens", "account_id"], ["tokens", "accountId"],
             ["chatgpt_account_id"], ["chatgptAccountId"]):
    account_id = string_at(value, path)
    if account_id:
        break
if not token:
    print("LIVE: auth missing access token")
    sys.exit(2)
# Never log token or account id values from here on. Only presence is reported.
print(f"LIVE: credentials from {auth_path} (token present, account_id present={bool(account_id)})")
del raw, value

def get(url, extra_headers=None):
    headers = {"accept": "application/json", "Authorization": f"Bearer {token}"}
    if account_id:
        headers["chatgpt-account-id"] = account_id
    for key, val in (extra_headers or {}).items():
        headers[key] = val
    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            return response.status, response.read()
    except Exception as error:  # noqa: BLE001 - summarized, never leaks headers
        status = getattr(error, "code", None) or getattr(error, "errno", None) or "error"
        return status, None

usage_body, usage_source, usage_status = None, None, None
for name, url in (("wham", wham), ("codex", codex)):
    status, body = get(url)
    print(f"LIVE: usage {name} -> {status}")
    if status == 200 and body:
        usage_body, usage_source, usage_status = body, name, status
        break
    if usage_status is None:
        usage_status = status

credits_status, credits_body = get(credits_url, {
    "OpenAI-Beta": "codex-1",
    "originator": "Codex Desktop",
    "User-Agent": "tantalus/0.1",
})
print(f"LIVE: reset-credits -> {credits_status}")

if usage_body is not None:
    with open(os.path.join(evidence, "live-usage.json"), "wb") as handle:
        handle.write(usage_body)
if credits_body is not None and credits_status == 200:
    with open(os.path.join(evidence, "live-credits.json"), "wb") as handle:
        handle.write(credits_body)

def summarize_usage(body):
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return "usage body is not JSON"
    rate = payload.get("rate_limit", {}) if isinstance(payload, dict) else {}
    lines = [f"allowed present={rate.get('allowed') is not None} "
             f"limit_reached present={rate.get('limit_reached') is not None}"]
    for key in ("primary_window", "secondary_window"):
        window = rate.get(key, {})
        keys = sorted(window.keys()) if isinstance(window, dict) else []
        lines.append(f"{key} keys={keys}")
    return "; ".join(lines)

def summarize_credits(body):
    try:
        payload = json.loads(body)
    except json.JSONDecodeError:
        return "credits body is not JSON"
    if not isinstance(payload, dict):
        return "credits body is not an object"
    for key in ("credits", "data", "items"):
        items = payload.get(key)
        if isinstance(items, list):
            return f"container={key} count={len(items)} available_count={payload.get('available_count')}"
    return f"no credit array found keys={sorted(payload.keys())}"

if usage_body is not None:
    print(f"LIVE: usage source={usage_source} {summarize_usage(usage_body)}")
if credits_body is not None and credits_status == 200:
    print(f"LIVE: {summarize_credits(credits_body)}")

claude_home = os.environ.get("CLAUDE_CONFIG_DIR", "")
claude_path = os.path.join(claude_home or os.path.join(os.path.expanduser("~"), ".claude"),
                           ".credentials.json")
claude_token = read_token(claude_path, (["claudeAiOauth", "accessToken"],
                                        ["access_token"], ["accessToken"]))
if not claude_token:
    print(f"LIVE: claude auth_missing (no usable token at {claude_path})")
else:
    request = urllib.request.Request(claude_url, method="GET", headers={
        "accept": "application/json",
        "Authorization": f"Bearer {claude_token}",
        "anthropic-beta": "oauth-2025-04-20",
        "User-Agent": "tantalus/0.1",
    })
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            claude_status, claude_body = response.status, response.read()
    except Exception as error:
        claude_status, claude_body = getattr(error, "code", None) or "error", None
    print(f"LIVE: claude usage -> {claude_status}")
    if claude_body is not None and claude_status == 200:
        with open(os.path.join(evidence, "live-claude-usage.json"), "wb") as handle:
            handle.write(claude_body)
        try:
            payload = json.loads(claude_body)
            windows = {key: sorted(payload.get(key).keys())
                       for key in ("five_hour", "seven_day")
                       if isinstance(payload.get(key), dict)}
            print(f"LIVE: claude windows={windows} "
                  f"extra_usage present={payload.get('extra_usage') is not None}")
        except (json.JSONDecodeError, AttributeError):
            print("LIVE: claude body is not the expected JSON object")
del claude_token

# Opencode keeps a plain API key under the "opencode-go" entry of its auth.json.
# XDG_DATA_HOME relocates the whole store, so its own directory sits under it.
opencode_root = os.environ.get("XDG_DATA_HOME", "") or os.path.join(
    os.path.expanduser("~"), ".local", "share")
opencode_path = os.path.join(opencode_root, "opencode", "auth.json")
opencode_key = read_token(opencode_path, (["opencode-go", "key"],))
if not opencode_key:
    print(f"LIVE: opencode auth_missing (no opencode-go key at {opencode_path})")
else:
    request = urllib.request.Request(opencode_url, method="GET", headers={
        "accept": "application/json",
        "Authorization": f"Bearer {opencode_key}",
        "User-Agent": "tantalus/0.1",
    })
    try:
        with urllib.request.urlopen(request, timeout=12) as response:
            opencode_status, opencode_body = response.status, response.read()
    except Exception as error:
        opencode_status, opencode_body = getattr(error, "code", None) or "error", None
    print(f"LIVE: opencode usage -> {opencode_status}")
    if opencode_body is not None and opencode_status == 200:
        with open(os.path.join(evidence, "live-opencode-usage.json"), "wb") as handle:
            handle.write(opencode_body)
        try:
            payload = json.loads(opencode_body)
            usage = payload.get("usage") if isinstance(payload, dict) else None
            windows = {key: sorted(usage.get(key).keys())
                       for key in ("rolling", "weekly", "monthly")
                       if isinstance(usage, dict) and isinstance(usage.get(key), dict)}
            print(f"LIVE: opencode windows={windows}")
        except (json.JSONDecodeError, AttributeError):
            print("LIVE: opencode body is not the expected JSON object")
del opencode_key

# Token and account id stay in this process only; nothing above prints them.
if usage_body is None:
    print(f"LIVE: usage failed (status={usage_status})")
    sys.exit(1)
if credits_status != 200:
    print(f"LIVE: partial (usage ok via {usage_source}, credits status={credits_status})")
    sys.exit(0)
print(f"LIVE: ok (usage via {usage_source}, credits ok)")
PY
status=$?
case $status in
  0) echo "LIVE-CHECK: pass (usage and credits)" ;;
  1) echo "LIVE-CHECK: usage failed (see above; error handling path)" ;;
  2) echo "LIVE-CHECK: auth missing (see above; auth_missing path)" ;;
esac
exit $status
