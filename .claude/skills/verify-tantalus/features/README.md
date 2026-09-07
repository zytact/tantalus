# Tantalus feature map

Maintained verification source. One file per user-facing feature, from
`src/main.tsx` handles, `src-tauri/src/lib.rs` tray menu, and the README
behavior list. A proof that drives one convenient entry point is incomplete
when this index lists others.

- [short-window](short-window.md) - 5-hour consumption ledger entry
- [long-window](long-window.md) - 7-day consumption ledger entry
- [reset-credits](reset-credits.md) - banked reset credits
- [manual-refresh](manual-refresh.md) - Refresh button, Refresh now, stale and error states
- [tray-and-autorefresh](tray-and-autorefresh.md) - tray menu, polling, status line, token privacy
- [provider-switch](provider-switch.md) - per-provider on/off switch, persistence

Headless static checks prove that Vite serves the app shell and that its
bundle contains the expected labels. In a plain browser, `cached_usage`
rejects without Tauri IPC, so the app shows `Could not load provider settings`
with no provider sections, switches, window entries, or extras. Formatter
contracts come from the suites. Ready, Stale, AuthMissing, switch, and tray
behavior need `pnpm tauri dev` on a real desktop with credentials. Fixture suites
(`pnpm test`, `cargo test`) prove the parsing edges; one redacted live
refresh via `.agents/skills/verify-tantalus/scripts/live-check.sh` (WHAM
first, Codex fallback, credits
separately, Claude usage from `api.anthropic.com`, 12s timeout, single pass)
proves both real credential files and the Ready path. It is the only step
that touches the network or the real logins, and it never logs or stores a
token.

Every window and extras entry is rendered once per enabled provider only
after a snapshot arrives: from Tauri on a desktop, or from
`scripts/tauri-mock.js` headless (Drive step 3 in `SKILL.md`). A
bare-browser snapshot without the mock shows only the load error, so never
use it to assert entries or to touch Refresh or a provider switch. Status
words (`Live`, `Blocked until reset`, `Cached`, `Not signed in`, `Could
not refresh`, `Off`) are mock scenarios plus a Refresh click away; the
tray menu, tooltip, and 5-minute polling stay manual-only.
