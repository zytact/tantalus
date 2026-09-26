#!/usr/bin/env python3
# Serve fixture usage responses on the providers' own paths for a mock preview launch.
import json
import sys
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOUR = 3600
DAY = 86_400
TOKENS = {"Bearer fixture-codex", "Bearer fixture-claude", "Bearer fixture-opencode"}
MANAGEMENT_TOKEN = "Bearer fixture-management"


def rfc3339(epoch):
    return datetime.fromtimestamp(epoch, timezone.utc).isoformat()


def codex_window(used, seconds, resets_in):
    return {"used_percent": used, "limit_window_seconds": seconds, "reset_after_seconds": resets_in}


def claude_window(used, resets_in, locked=False):
    window = {"utilization": used, "resets_at": rfc3339(time.time() + resets_in)}
    if locked:
        window["locked_reason"] = "rate_limited"
    return window


def claude_resets(*days_left):
    grants = [{"id": f"fixture-grant-{index}", "resets_left": 1, "ends_at": rfc3339(time.time() + days * DAY)}
              for index, days in enumerate(days_left)]
    return {"eligible": True, "grants": grants}


def opencode_window(used, resets_in):
    return {"percent": used, "resetsAt": int((time.time() + resets_in) * 1000), "status": "ok"}


def ready():
    return {
        "codex_usage": {
            "rate_limit": {
                "allowed": True,
                "limit_reached": False,
                "primary_window": codex_window(40, 5 * HOUR, 3 * HOUR),
                "secondary_window": codex_window(12, 7 * DAY, 5 * DAY),
            }
        },
        "codex_subscription": {"active_until": rfc3339(time.time() + 22 * DAY)},
        "codex_credits": {
            "available_count": 2,
            "credits": [
                {"expires_at": int(time.time() + 20 * DAY)},
                {"expires_at": int(time.time() + 27 * DAY)},
            ],
        },
        "claude_usage": {
            "five_hour": claude_window(91, 1 * HOUR),
            "seven_day": claude_window(55, 3 * DAY),
            "cedar_ember": claude_resets(30),
            "extra_usage": {"is_enabled": True, "used_credits": 1250, "monthly_limit": 5000, "currency": "USD", "decimal_places": 2},
        },
        "claude_profile": {
            "account": {"email": "claude@direct.test"},
            "organization": {"organization_type": "claude_max", "rate_limit_tier": "default_claude_max_5x"},
        },
        "opencode_usage": {
            "usage": {
                "rolling": opencode_window(5, 4 * HOUR),
                "weekly": opencode_window(70, 6 * DAY),
                "monthly": opencode_window(33, 20 * DAY),
            }
        },
    }


def monthly_only():
    fixture = ready()
    fixture["codex_usage"] = {
        "rate_limit": {
            "allowed": True,
            "limit_reached": False,
            "primary_window": codex_window(58, 30 * DAY, 12 * DAY),
        }
    }
    fixture["codex_credits"] = {"credits": []}
    return fixture


def blocked():
    return {
        "codex_subscription": {"active_until": rfc3339(time.time() + 22 * DAY)},
        "codex_usage": {
            "rate_limit": {
                "allowed": False,
                "limit_reached": True,
                "primary_window": codex_window(100, 5 * HOUR, 1 * HOUR),
                "secondary_window": codex_window(74, 7 * DAY, 1 * DAY),
            }
        },
        "codex_credits": {"available_count": 0, "credits": []},
        "claude_usage": {
            "five_hour": claude_window(100, 1 * HOUR, locked=True),
            "seven_day": claude_window(80, 2 * DAY),
            "cedar_ember": claude_resets(),
            "extra_usage": None,
        },
        "claude_profile": {
            "account": {"email": "claude@direct.test"},
            "organization": {"organization_type": "claude_max", "rate_limit_tier": "default_claude_max_5x"},
        },
        "opencode_usage": {
            "usage": {
                "rolling": opencode_window(100, 2 * HOUR),
                "weekly": opencode_window(60, 3 * DAY),
                "monthly": opencode_window(40, 10 * DAY),
            }
        },
    }


def no_windows():
    return {
        "codex_subscription": {"active_until": None},
        "codex_usage": {"rate_limit": {}},
        "codex_credits": {},
        "claude_usage": {},
        "claude_profile": {
            "account": {"email": "claude@direct.test"},
            "organization": {"organization_type": "claude_max", "rate_limit_tier": "default_claude_max_5x"},
        },
        "opencode_usage": {"usage": {}},
    }


SCENARIOS = {
    "ready": ready,
    "monthly-only": monthly_only,
    "blocked": blocked,
    "no-windows": no_windows,
    "error": None,
}
ROUTES = {
    "/backend-api/wham/usage": "codex_usage",
    "/backend-api/codex/usage": "codex_usage",
    "/backend-api/wham/rate-limit-reset-credits": "codex_credits",
    "/backend-api/subscriptions": "codex_subscription",
    "/api/oauth/usage": "claude_usage",
    "/api/oauth/profile": "claude_profile",
    "/zen/go/v1/usage": "opencode_usage",
}


class Handler(BaseHTTPRequestHandler):
    scenario = "ready"
    request_log = None

    def send_json(self, status, body):
        payload = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self):
        if self.path == "/__fixture/health":
            return self.send_json(200, {"scenario": Handler.scenario})
        if self.path == "/v0/management/auth-files":
            with open(Handler.request_log, "a") as log:
                log.write(f"{int(time.time())} {Handler.scenario} GET {self.path}\n")
            if self.headers.get("authorization") != MANAGEMENT_TOKEN:
                return self.send_json(401, {"error": "fixture management key required"})
            return self.send_json(200, {
                "files": [
                    {
                        "id": "hub-codex.json",
                        "auth_index": "hub-codex",
                        "provider": "codex",
                        "email": "codex@hub.test",
                        "id_token": {"chatgpt_account_id": "fixture-hub-account", "plan_type": "pro"},
                    },
                    {
                        "id": "hub-claude.json",
                        "auth_index": "hub-claude",
                        "provider": "claude",
                        "email": "claude@hub.test",
                    },
                ]
            })
        key = ROUTES.get(urlparse(self.path).path)
        with open(Handler.request_log, "a") as log:
            log.write(f"{int(time.time())} {Handler.scenario} GET {self.path}\n")
        if key is None:
            return self.send_json(404, {"error": "unknown path"})
        if self.headers.get("authorization") not in TOKENS:
            return self.send_json(401, {"error": "fixture token required"})
        build = SCENARIOS[Handler.scenario]
        if build is None:
            return self.send_json(500, {"error": "fixture error scenario"})
        self.send_json(200, build()[key])

    def do_POST(self):
        prefix = "/__fixture/scenario/"
        name = self.path[len(prefix):] if self.path.startswith(prefix) else None
        if name in SCENARIOS:
            Handler.scenario = name
            return self.send_json(200, {"scenario": name})
        if self.path != "/v0/management/api-call":
            return self.send_json(404, {"error": "unknown path"})
        with open(Handler.request_log, "a") as log:
            log.write(f"{int(time.time())} {Handler.scenario} POST {self.path}\n")
        if self.headers.get("authorization") != MANAGEMENT_TOKEN:
            return self.send_json(401, {"error": "fixture management key required"})
        try:
            size = int(self.headers.get("content-length", "0"))
            request = json.loads(self.rfile.read(size))
            key = ROUTES.get(urlparse(request["url"]).path)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            return self.send_json(400, {"error": "invalid management request"})
        if request.get("header", {}).get("Authorization") != "Bearer $TOKEN$" or key is None:
            return self.send_json(400, {"error": "invalid upstream request"})
        build = SCENARIOS[Handler.scenario]
        status = 500 if build is None else 200
        body = {"error": "fixture error scenario"} if build is None else build()[key]
        if build is not None and key == "codex_credits":
            body = {
                "credits": [
                    {
                        **credit,
                        "id": f"fixture-credit-{index}",
                        "status": "available",
                        "reset_type": "codex_rate_limits",
                    }
                    for index, credit in enumerate(body.get("credits", []))
                ]
            }
        self.send_json(200, {"status_code": status, "body": json.dumps(body)})

    def log_message(self, *_):
        pass


def main():
    port_file, Handler.request_log, Handler.scenario = sys.argv[1], sys.argv[2], sys.argv[3]
    if Handler.scenario not in SCENARIOS:
        sys.exit(f"unknown scenario {Handler.scenario}; choose from {sorted(SCENARIOS)}")
    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    with open(port_file, "w") as handle:
        handle.write(str(server.server_address[1]))
    server.serve_forever()


if __name__ == "__main__":
    main()
