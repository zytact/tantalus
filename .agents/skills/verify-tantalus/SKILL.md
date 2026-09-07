---
name: verify-tantalus
description: Drive the Tantalus Codex and Claude usage tray app (React webview plus Rust backend) through an isolated Vite server, vitest and cargo tests, a browser tab, and a single live refresh of the real usage APIs. Use when verifying the allowance view, refresh, the provider switches, tray behavior, or usage parsing.
---

# Verify Tantalus

Tantalus is a Tauri 2 desktop app. Rust reads the Codex and Claude
credential files and polls the usage APIs every 5 minutes. The React webview
in `src/main.tsx` receives a token-free `UsageSnapshot` and renders one block
per provider: an on/off switch row with a status word, then Short window
(5h), Long window (7d), and Reset credits (Codex) or Extra usage (Claude),
above a shared Refresh button. A provider whose switch is off is not polled
at all.

## Launch

Run everything from the repo root. Do not use port 1420 when it is already
taken. `vite.config.ts` sets `strictPort: true`, so a second instance on
1420 exits with `Port 1420 is already in use`. Refusing to double-drive a
shared instance beats corrupting the user's session.

Preferred headless launch for verification:

```sh
.agents/skills/verify-tantalus/scripts/launch.sh 1421
```

That helper picks the given port (or scans 1421-1450 when omitted), starts
`pnpm vite --port <PORT> --strictPort false` in the background, waits up to
30s for `curl http://localhost:<PORT>/` to return 200 with
`<title>Tantalus</title>`, and writes the pid and port to
`/tmp/opencode/tantalus-verify/run.pid` and `run.port`. The launch itself
never touches `~/.codex/auth.json` and never calls the network. Live API
calls happen only through `.agents/skills/verify-tantalus/scripts/live-check.sh`
(Drive step 4).

Ready means: HTTP 200 on `/`, HTML contains `<div id="root">`, and the dev
server process from the pidfile is alive. In a plain browser tab,
`invoke("cached_usage")` rejects because Tauri IPC does not exist outside
`pnpm tauri dev`. The app starts without a snapshot, then shows `Could not
load provider settings`. It renders no provider sections or switches, and
the Refresh button remains disabled. Headless verification proves only that
plain-browser error state and the static served shell.

Full desktop launch (`pnpm tauri dev`) is manual-only, on a real Linux, macOS,
or Windows desktop with tray support. It needs the Tauri system deps
(`webkit2gtk4.1`, GTK, tray implementation; `pnpm tauri info` currently
reports `rsvg2: not installed` on this Fedora box) plus a display. Do not run
it headless in CI and never run a second copy while the user runs one.

Teardown is always:

```sh
.agents/skills/verify-tantalus/scripts/cleanup.sh
```

It kills only the pid in the pidfile, removes the temp `CODEX_HOME` fixture
if one was created, and leaves the evidence directory alone.

## Doctor

One read-only check, run first whenever anything looks off:

```sh
.agents/skills/verify-tantalus/scripts/doctor.sh [PORT]
```

It answers "is this instance worth driving?" without changing state:

- vite process from `/tmp/opencode/tantalus-verify/run.pid` is alive, or
  reports which process owns the port when the pidfile is missing
- `curl http://localhost:<PORT>/` returns 200 and `<title>Tantalus</title>`
- repo version matches `src-tauri/tauri.conf.json` (`productName Tantalus`,
  `devUrl http://localhost:1420`) and `dist/` exists after `pnpm build`
- auth check is read-only: notes whether `CODEX_HOME` is set and whether
  `$HOME/.codex/auth.json` exists, but never prints the token. It does not
  cover the Claude login;
  `.agents/skills/verify-tantalus/scripts/live-check.sh` reports that one.
- fails closed when the port answers but the pid is not ours: stop and pick
  another port instead of driving someone else's server

## Drive

Harness order: existing test suites first, then the browser tab, then one
live refresh, then manual Tauri only on a real desktop.

1. Logic suites (no network, no tokens):

```sh
pnpm test
cargo test --manifest-path src-tauri/Cargo.toml
```

`pnpm test` covers `src/presentation.ts`: null stays `Unavailable`, zero
stays `0%`, countdown coarse buckets (`3h 29m`, `4d 20h`), credit expiry
contains the month and day. `cargo test` covers `src-tauri/src/usage.rs`
(window mapping by exact 18000 and 604800 seconds, millisecond and RFC 3339
resets, credit container alternatives) and `src-tauri/src/auth.rs`
(token field alternatives, WSL encoding handling).

2. Static shell check (no browser needed):

```sh
PORT=$(cat /tmp/opencode/tantalus-verify/run.port)
.agents/skills/verify-tantalus/scripts/check-ui.sh "$PORT"
```

It curls the dev server and asserts the served HTML has the root div and the
client bundle references the real handles: `Short window`, `Long window`,
`Reset credits`, `Refresh`, `Auto-refreshes every 5 minutes`.

3. Browser tab. Navigate a collaborative tab to `http://localhost:<PORT>/`
and snapshot after `cached_usage` rejects. Plain-browser proof is limited to
visible `Allowance`, `Could not load provider settings`, and
`AUTO-REFRESHES EVERY 5 MINUTES`, plus a disabled
`role=button[name="Refresh"]`. It has no provider switches, window regions,
progressbars, reset-credit regions, or interactive actions to drive.

The Ready, Stale, AuthMissing, and Error renderings, the real switch
behavior, and the tray menu (one line per enabled provider formatted
`Codex  5h 42%  7d 8%`, then `Show usage`, `Refresh now`, `Quit`) are only
drivable under `pnpm tauri dev` on a real desktop. There, drive with the
keyboard and menu, not coordinates: Tab to Refresh, Enter, and read each
provider's status word (`Live`, `Blocked until reset`, `Cached`,
`Not signed in`, `Could not refresh`, `Off`).

Never point `CODEX_HOME` or `CLAUDE_CONFIG_DIR` at the real home during
verification. When a credential fixture is needed, create
`/tmp/opencode/tantalus-verify/coverage-home/` with a fake `auth.json`
(marked verification scaffolding) and let the cleanup helper delete it. Never
send a real token to the dev server or paste one into the browser tab.
Tokens stay in Rust memory only per `src-tauri/src/lib.rs` and `api.rs`.

4. Live refresh (necessary, single pass, redacted). This is the only step
that touches the network or the real credential files, and it mirrors
`src-tauri/src/api.rs` exactly: WHAM usage first, Codex usage fallback,
reset credits separately, Claude usage from `api.anthropic.com`, 12s timeout
per request, no loop:

```sh
EVIDENCE=/tmp/opencode/tantalus-verify/<YYYYMMDD-HHMMSS>
.agents/skills/verify-tantalus/scripts/live-check.sh "$EVIDENCE" 2>&1 | tee "$EVIDENCE/live-check.log"
```

It resolves credentials the same way Rust does (`CODEX_HOME/auth.json` wins,
else `~/.codex/auth.json`; `CLAUDE_CONFIG_DIR/.credentials.json` wins, else
`~/.claude/.credentials.json`), reads each token into memory only, and never
prints it, writes it, or passes it on a command line. The log records only
presence (`account_id present=True/False`), endpoint choice, HTTP statuses,
window key names, and credit counts. Response bodies go to
`live-usage.json`, `live-credits.json`, and `live-claude-usage.json`; they
contain usage figures, not tokens. Run it exactly once per proof run. The
exit code reports the Codex leg: 0 means usage plus credits are 200 and
JSON, 1 the usage-failed error path, 2 the auth-missing path. The Claude leg
is reported on its own `LIVE: claude usage -> <status>` line. A 401/403 is a credential outcome, not a helper bug:
record it and stop.

## Evidence

Write every run to `/tmp/opencode/tantalus-verify/<YYYYMMDD-HHMMSS>/`:

- `doctor.log` (doctor output)
- `vitest.log` and `cargo-test.log` (full suite output plus exit codes)
- `index.html` (`curl http://localhost:<PORT>/` body)
- `check-ui.log` (static shell assertions)
- `visible-text.txt` (browser snapshot visible text) and `snapshot.json`
  (the disabled Refresh button plus ARIA) when the plain browser tab was used
- `live-usage.json`, `live-credits.json`, `live-claude-usage.json` (raw API
  bodies, no tokens), and `live-check.log` (redacted summary: endpoint,
  statuses, window keys, credit counts) from the single live refresh
- `screenshot.png` when the harness captures one

Proof standards: exercise the real user path, not internal setters or
test-only endpoints. Capture the action and the resulting state, not just the
final screen. Verify side effects alongside what is visible: `dist/` from
`pnpm build`, suite exit codes, the live HTTP statuses and figures, and
(under Tauri only) the tray tooltip and menu labels. Fixture suites prove the
parsing edges; the single live refresh proves the real credential files, the
WHAM-first fallback, and the Ready path against
`https://chatgpt.com/backend-api/*` and
`https://api.anthropic.com/api/oauth/usage`. Reads only: one GET per
endpoint, no writes, no polling loop. The provider switches do write
`providers.json`, so they are proven under `pnpm tauri dev` only, never by
the headless harness. Tantalus has
no dry-run flag, so there is nothing to second-guess by name.

## Cleanup

```sh
.agents/skills/verify-tantalus/scripts/cleanup.sh
```

Kills only the pid in `/tmp/opencode/tantalus-verify/run.pid`, removes the
pid and port files plus the temp `CODEX_HOME` fixture, and stops after 5s
with `kill -9` only against that same pid when it refuses to exit. Never
`pkill vite`, `pkill tauri`, or `killall node`: that would take down the
user's dev server on 1420. Cleanup removes instances and scratch state,
never the evidence. After cleanup, confirm the evidence directory for the run
still exists before reporting success. Run cleanup after every failed
iteration too, so broken attempts do not strand ports.

## Helpers

All helpers live in `scripts/` and are executable:

- `scripts/doctor.sh [PORT]` - read-only instance check described above
- `scripts/launch.sh [PORT]` - isolated vite start plus readiness wait
- `scripts/check-ui.sh <PORT>` - curl assertions for the served shell
- `.agents/skills/verify-tantalus/scripts/live-check.sh <EVIDENCE_DIR>` -
  single redacted live refresh
- `scripts/cleanup.sh` - kill only what launch started, keep evidence

Feature map is in `features/`: `README.md` plus one file per user-facing
feature, including `provider-switch.md` for the per-provider on/off switch. Drive the map entry named in the task; one mapped feature per proof
run is enough because the map lists the rest.
