# Tantalus feature map

Maintained verification source. One file per user-facing feature, from
the `src/` UI handles, `src-tauri/src/lib.rs` tray menu, and the README
behavior list. A proof that drives one convenient entry point is incomplete
when this index lists others.

- [short-window](short-window.md) - 5-hour consumption ledger entry
- [long-window](long-window.md) - 7-day consumption ledger entry
- [monthly-window](monthly-window.md) - 30-day ledger entry, Opencode only
- [reset-credits](reset-credits.md) - banked reset credits
- [manual-refresh](manual-refresh.md) - Refresh button, Refresh now, stale and error states
- [tray-and-autorefresh](tray-and-autorefresh.md) - tray menu, polling, status line, token privacy
- [provider-switch](provider-switch.md) - per-provider on/off switch in Settings, persistence
- [settings](settings.md) - provider choice, app version, open-at-login preference

Headless static checks prove that Vite serves the app shell and that its
bundle contains the expected labels. In a plain browser, `cached_usage`
rejects without Tauri IPC, so the app shows `Could not load provider settings`
with no provider sections, window entries, or extras, and Settings renders its
provider rows as `Unavailable`. Formatter
contracts come from the suites. Ready, Stale, AuthMissing, switch, and tray
behavior need `vp run tauri dev` on a real desktop with credentials. Fixture suites
(`vp test`, `cargo test`) prove the parsing edges; one redacted live
refresh via `.agents/skills/verify-tantalus/scripts/live-check.sh` (WHAM
first, Codex fallback, credits
separately, Claude usage from `api.anthropic.com`, Opencode Go usage from
`opencode.ai/zen/go`, 12s timeout, single pass)
proves all three real credential files and the Ready path. It is the only step
that touches the network or the real logins, and it never logs or stores a
token.

Every window and extras entry is rendered once per enabled provider only
after a snapshot arrives: from Tauri on a desktop, or from
`scripts/tauri-mock.js` headless (Drive step 3 in `SKILL.md`). A
bare-browser snapshot without the mock shows only the load error, so never
use it to assert entries or to touch Refresh or a provider switch. Status
words (`Live`, `Blocked until reset`, `Cached`, `Not signed in`, `Could
not refresh`) are mock scenarios plus a Refresh click away; the
tray menu, tooltip, and 5-minute polling stay manual-only.
