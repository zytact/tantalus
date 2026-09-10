---
name: verify-tantalus
description: Drive the Tantalus Codex, Claude and Opencode usage tray app (React webview plus Rust backend) through an isolated Vite server, vitest and cargo tests, a browser tab, and a single live refresh of the real usage APIs. Use when verifying the allowance view, refresh, the provider switches, tray behavior, or usage parsing.
---

# Verify Tantalus

Tantalus is a Tauri 2 desktop app. Rust reads the Codex, Claude and Opencode
credential files and polls the usage APIs every 5 minutes. The React webview
in `src/main.tsx` receives a token-free `UsageSnapshot` and renders one block
per enabled provider: a header row with a status word, then Short window
(5h), Long window (7d), a Monthly window (30d, Opencode only), and Reset
credits (Codex) or Extra usage (Claude), above a shared Refresh button.
Opencode has neither kind of extras. Codex and Claude default on; Opencode
defaults off, so switch it on in Settings before verifying its block. The per-provider on/off switches live on the
Settings page in `src/settings-page.tsx`; a provider switched off is not
polled at all and does not appear in the allowance view. That same Settings
page shows the bundle version and controls the operating system's
open-at-login registration.

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
`vp dev --port <PORT> --strictPort false` in the background, waits up to
30s for `curl http://localhost:<PORT>/` to return 200 with
`<title>Tantalus</title>`, and writes the pid and port to
`/tmp/opencode/tantalus-verify/run.pid` and `run.port`. The launch itself
never touches `~/.codex/auth.json` and never calls the network. Live API
calls happen only through `.agents/skills/verify-tantalus/scripts/live-check.sh`
(Drive step 4).

Ready means: HTTP 200 on `/`, HTML contains `<div id="root">`, and the dev
server process from the pidfile is alive. A bare tab without the mock is
only the error baseline: `invoke("cached_usage")` rejects without Tauri
IPC, so the app shows `Could not load provider settings` with no provider
sections and a disabled Refresh. The full webview is driven headless
through the mock in Drive step 3, which installs the same IPC surface the
app touches and remounts it, so the tab renders every enabled provider, its
entries, and the Settings switches like a user sees them.

Full desktop launch (`vp run tauri dev`) is manual-only, on a real Linux, macOS,
or Windows desktop with tray support. It needs the Tauri system deps
(`webkit2gtk4.1`, GTK, tray implementation; `vp run tauri info` currently
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
  `devUrl http://localhost:1420`) and `dist/` exists after `vp build`
- auth check is read-only: notes whether `CODEX_HOME` is set and whether
  `$HOME/.codex/auth.json` exists, but never prints the token. It does not
  cover the Claude or Opencode login;
  `.agents/skills/verify-tantalus/scripts/live-check.sh` reports those.
- fails closed when the port answers but the pid is not ours: stop and pick
  another port instead of driving someone else's server

## Drive

Harness order: existing test suites first, then the browser tab, then one
live refresh, then manual Tauri only on a real desktop.

1. Logic suites (no network, no tokens):

```sh
vp test
cargo test --manifest-path src-tauri/Cargo.toml
```

`vp test` covers `src/presentation.ts`: null stays `Unavailable`, zero
stays `0%`, countdown coarse buckets (`3h 29m`, `4d 20h`), credit expiry
contains the month and day. `cargo test` covers `src-tauri/src/usage.rs`
(window mapping by exact 18000 and 604800 seconds, the three named Opencode
windows, millisecond and RFC 3339 resets, credit container alternatives),
`src-tauri/src/auth.rs` (token field alternatives including the Opencode
`opencode-go` key, WSL encoding handling), and `src-tauri/src/settings.rs`
(a `providers.json` written before Opencode existed keeps its recorded
choice).

2. Static shell check (no browser needed):

```sh
PORT=$(cat /tmp/opencode/tantalus-verify/run.port)
.agents/skills/verify-tantalus/scripts/check-ui.sh "$PORT"
```

It curls the dev server and asserts the served HTML has the root div and the
client bundle references the real handles: `Short window`, `Long window`,
`Monthly window`, `Reset credits`, `Opencode`, `Refresh`,
`Auto-refreshes every 5 minutes`.

3. Browser tab, mock-driven. This is the real user path, headless:
`scripts/tauri-mock.js` answers `cached_usage`, `refresh_usage`, and
`set_provider_enabled`, the three `plugin:autostart` commands, and the
`plugin:event|listen/emit/unlisten` wiring. It uses synthetic Ready figures in
Rust's shapes and no tokens or network. Two evaluates install it; both must be
promise chains, since
this harness has no top-level await and a dynamic import of the mock
fails on MIME, so fetch plus indirect eval:

```js
fetch('/.agents/skills/verify-tantalus/scripts/tauri-mock.js').then(r => r.text()).then(src => { (0,eval)(src); return !!window.__TANTALUS_MOCK__; })
```

```js
window.__TANTALUS_MOCK__.remount().then(() => 'remounted')
```

The remount swaps `#root` for a fresh node and re-imports
`/src/main.tsx` cache-busted, so a new App mounts against the mock
(the first error-state tree stays detached). Then drive it like a user:
snapshot shows `Allowance` with an `updated` time, the Codex and Claude
blocks, four `role=progressbar` entries, `Reset credits` (Codex) and
`Extra usage` (Claude) regions, and an enabled Refresh. Switch Opencode on in
Settings to add a third block with three progressbars, the extra one named
`Monthly window usage`, and no extras region of either kind. Click `Settings`, the switches, and Refresh,
not coordinates where a role target exists. Status words come from
`window.__TANTALUS_MOCK__.scenario(...)` followed by a Refresh click:
`stale` reads `Cached` with the figures intact and a `role=status`
notice, `blocked` reads `Blocked until reset`, `auth_missing` reads
`Not signed in` with `Window unavailable` fallbacks and a `no successful
update yet` header, `error` reads `Could not refresh`, and `ready`
returns to `Live`. Switching a provider off in Settings drops its block from
the allowance view and persists the
`{"codex":true,"claude":false,"opencode":false}`-shaped
choice to localStorage (the mock's stand-in for `providers.json`); switching
it back on refreshes that provider immediately. The Refresh click flips the
button to `Refreshing` with `aria-busy=true` mid-flight; the mock
answers after ~350ms, so read that state from the same tick (click, then
a 100ms `setTimeout` read in one expression).

For the Settings page, follow `features/settings.md`. The mock proves the
provider switches, the visible version, the accessible startup switch,
persistence, and failure state. It
does not register the app with the operating system, so it cannot prove the
`--hidden` launch.

Without the mock the tab stays on the error baseline (`Could not load
provider settings`, disabled Refresh, no sections). Landing there means
the mock was not installed before the remount: reinstall and remount
rather than asserting entries.

The tray menu (one line per enabled provider formatted
`Codex  5h 42%  7d 8%`, with a third `30d N%` column for Opencode only, then
`Show usage`, `Refresh now`, `Quit`), the
tooltip, the 5-minute polling cadence, and the real `providers.json`
write have no browser surface and stay manual-only under `vp run tauri dev`
on a real desktop. There, drive with the keyboard and menu, not
coordinates: Tab to Refresh, Enter, and read each provider's status word
(`Live`, `Blocked until reset`, `Cached`, `Not signed in`,
`Could not refresh`, `Off`).

Never point `CODEX_HOME`, `CLAUDE_CONFIG_DIR`, or `XDG_DATA_HOME` at the
real home during
verification. When a credential fixture is needed, create
`/tmp/opencode/tantalus-verify/coverage-home/` with a fake `auth.json`
(marked verification scaffolding) and let the cleanup helper delete it. Never
send a real token to the dev server or paste one into the browser tab.
Tokens stay in Rust memory only per `src-tauri/src/lib.rs` and `api.rs`.

4. Live refresh (necessary, single pass, redacted). This is the only step
that touches the network or the real credential files, and it mirrors
`src-tauri/src/api.rs` exactly: WHAM usage first, Codex usage fallback,
reset credits separately, Claude usage from `api.anthropic.com`, Opencode Go
usage from `opencode.ai/zen/go/v1/usage`, 12s timeout per request, no loop:

```sh
EVIDENCE=/tmp/opencode/tantalus-verify/<YYYYMMDD-HHMMSS>
.agents/skills/verify-tantalus/scripts/live-check.sh "$EVIDENCE" 2>&1 | tee "$EVIDENCE/live-check.log"
```

It resolves credentials the same way Rust does (`CODEX_HOME/auth.json` wins,
else `~/.codex/auth.json`; `CLAUDE_CONFIG_DIR/.credentials.json` wins, else
`~/.claude/.credentials.json`; `XDG_DATA_HOME/opencode/auth.json` wins, else
`~/.local/share/opencode/auth.json`, reading its `opencode-go` key), reads
each token into memory only, and never
prints it, writes it, or passes it on a command line. The log records only
presence (`account_id present=True/False`), endpoint choice, HTTP statuses,
window key names, and credit counts. Response bodies go to
`live-usage.json`, `live-credits.json`, `live-claude-usage.json`, and
`live-opencode-usage.json`; they contain usage figures, not tokens. Run it
exactly once per proof run. The exit code reports the Codex leg: 0 means
usage plus credits are 200 and JSON, 1 the usage-failed error path, 2 the
auth-missing path. The Claude and Opencode legs are reported on their own
`LIVE: claude usage -> <status>` and `LIVE: opencode usage -> <status>`
lines. A 401/403 is a credential outcome, not a helper bug:
record it and stop.

## Evidence

Write every run to `/tmp/opencode/tantalus-verify/<YYYYMMDD-HHMMSS>/`:

- `doctor.log` (doctor output)
- `vitest.log` and `cargo-test.log` (full suite output plus exit codes)
- `index.html` (`curl http://localhost:<PORT>/` body)
- `check-ui.log` (static shell assertions)
- `visible-text.txt` (browser snapshot visible text) and `snapshot.json`
  (navigation, switches, version, progressbars, Refresh state, status words) from the
  mock-driven tab; without the mock the same files capture only the
  `Could not load provider settings` baseline
- `live-usage.json`, `live-credits.json`, `live-claude-usage.json`,
  `live-opencode-usage.json` (raw API bodies, no tokens), and
  `live-check.log` (redacted summary: endpoint, statuses, window keys,
  credit counts) from the single live refresh
- `screenshot.png` when the harness captures one

Proof standards: exercise the real user path, not internal setters or
test-only endpoints. The mock-driven tab is that path for the webview:
click the actual switches and Refresh and read the resulting state, not
just the final screen. Verify side effects alongside what is visible: `dist/` from
`vp build`, suite exit codes, the live HTTP statuses and figures, the
mock's localStorage persistence stand-in, and (under Tauri only) the tray
tooltip and menu labels. Fixture suites prove the parsing edges; the single live refresh proves the real credential files, the
WHAM-first fallback, and the Ready path against
`https://chatgpt.com/backend-api/*`,
`https://api.anthropic.com/api/oauth/usage`, and
`https://opencode.ai/zen/go/v1/usage`. Reads only: one GET per
endpoint, no writes, no polling loop. The provider switches write
`providers.json` for real, so the on-disk write itself is proven under
`vp run tauri dev` only; the webview half (block leaves the allowance view,
`Off` state word, immediate refresh on re-enable) is proven headless through
the mock.
Tantalus has no dry-run flag, so there is nothing to second-guess by name.

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

All helpers live in `scripts/`; the shell ones are executable:

- `scripts/doctor.sh [PORT]` - read-only instance check described above
- `scripts/launch.sh [PORT]` - isolated vite start plus readiness wait
- `scripts/check-ui.sh <PORT>` - curl assertions for the served shell
- `scripts/tauri-mock.js` - browser-loaded Tauri IPC mock for Drive step 3
  (fetched plus indirect-evaled from the tab, never run under node)
- `.agents/skills/verify-tantalus/scripts/live-check.sh <EVIDENCE_DIR>` -
  single redacted live refresh
- `scripts/cleanup.sh` - kill only what launch started, keep evidence

Feature map is in `features/`: `README.md` plus one file per user-facing
feature, including `provider-switch.md` for the per-provider on/off switch in
Settings and `monthly-window.md` for the Opencode-only third window. Drive the map entry named in the task; one mapped feature per proof
run is enough because the map lists the rest.
