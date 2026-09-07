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

Headless (`pnpm vite` plus a browser tab) proves the Loading shell and the
formatter contracts. Ready, Stale, AuthMissing, and tray behavior need
`pnpm tauri dev` on a real desktop with credentials. Fixture suites
(`pnpm test`, `cargo test`) prove the parsing edges; one redacted live
refresh via `scripts/live-check.sh` (WHAM first, Codex fallback, credits
separately, Claude usage from `api.anthropic.com`, 12s timeout, single pass)
proves both real credential files and the Ready path. It is the only step
that touches the network or the real logins, and it never logs or stores a
token.

Every window and extras entry is rendered once per provider, so a headless
snapshot has two of each. Reaching any of them assumes that provider's
switch is on.
