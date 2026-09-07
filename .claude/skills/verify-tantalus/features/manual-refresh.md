# Manual refresh

User-initiated re-read of credentials plus usage and credits fetch, for every
enabled provider at once.

## Sub-features

- `role=button[name="Refresh"]`, disabled with `Refreshing` text and
  `aria-busy=true` while in flight (`src/main.tsx`)
- Tauri commands `cached_usage` (initial paint), `refresh_usage` (button),
  and `set_provider_enabled` (switch), snapshot event `usage-snapshot`
- A switched-off provider is skipped: no credential read, no request
  (`src-tauri/src/lib.rs` `read_enabled`)
- Rust tracks refresh state with an AtomicU8. An overlapping trigger returns
  the cached snapshot to that caller and queues one follow-up pass after the
  active pass. Network requests never overlap.
- 12-second network timeout (`src-tauri/src/api.rs` `client()`)
- Failure keeps the last successful reading and labels it stale; without any
  success the status becomes `auth_missing` (missing file) or `error`
- Degraded notice `role=status` with `error_message` or the fallback
  `The last successful reading remains visible.`

## How to get to it (user POV)

Click **Refresh** in the window header, or tray **Refresh now**. Each
provider's switch row carries its own status word: `Live`,
`Blocked until reset`, `Loading`, `Cached`, `Not signed in`,
`Could not refresh`, or `Off`. Separately, the line under `Allowance` reads
`updated HH:MM` or `no successful update yet`, computed from enabled
providers only.

## Driving it with browser tab

Mock-driven (Drive step 3 in `SKILL.md`): after the remount, click
**Refresh** and read the button flipping to `Refreshing` with
`aria-busy=true` (the mock answers after ~350ms, so click and read from
the same tick). Each status word is one scenario plus a Refresh click
away: `ready` gives `Live` with an advancing `updated` time, `stale`
gives `Cached` with old figures and the `role=status` notice, `blocked`
gives `Blocked until reset`, `auth_missing` gives `Not signed in` with
`no successful update yet`, `error` gives `Could not refresh`. The
figures after a mock refresh match the mock snapshot; the figures after
a live refresh match `live-usage.json`.

1. Launch on an isolated port and run `scripts/check-ui.sh <PORT>` for the
   static shell.
2. In a bare browser tab, wait for `cached_usage` to reject. Snapshot the
   disabled Refresh button and `Could not load provider settings`. Do not
   click Refresh: without a snapshot it is disabled.
3. Logic proof headless: `pnpm test` plus
   `cargo test --manifest-path src-tauri/Cargo.toml`
4. Live proof (necessary, single pass):
   `.agents/skills/verify-tantalus/scripts/live-check.sh "$EVIDENCE"`
   performs exactly one refresh against the real APIs with the real
   credential files. It mirrors `api.rs` (WHAM first, Codex fallback,
   credits separately, Claude usage from `api.anthropic.com`, 12s timeout,
   no loop) and logs only the endpoint used, HTTP statuses, window key
   names, and credit counts. The exit code reports the Codex leg: 0 is the
   Ready path, 1 the usage-failed path, 2 the auth-missing path. The Claude
   leg is reported on its own line and in `live-claude-usage.json`. To prove
   auth-missing without touching a real login, point both
   `CODEX_HOME` and `CLAUDE_CONFIG_DIR` at
   `/tmp/opencode/tantalus-verify/coverage-home` (empty dir): expect
   `Not signed in` / exit 2.
5. Real UI proof needs `pnpm tauri dev` on a desktop or the mock in any browser: click Refresh, watch
   the button flip to `Refreshing`, then confirm each provider's status word
   and the `updated` time advance. The figures should match the latest
   `live-usage.json` from step 4 (Tauri) or the mock snapshot (headless).
6. Optional stale proof: disconnect network after one success under Tauri
   and refresh: expect `Cached` with the old figures intact.

## Gotchas

- Each refresh re-reads both credential files; `CODEX_HOME` wins over
  `~/.codex/auth.json` and `CLAUDE_CONFIG_DIR` over
  `~/.claude/.credentials.json`. Never point either at the real home in a
  test.
- WHAM usage is tried first, Codex usage second, reset credits separately,
  Claude usage from `api.anthropic.com/api/oauth/usage`. One endpoint
  failing does not have to fail the others the same way, and the two
  providers fail independently.
- A trigger during an active refresh receives the current cached snapshot.
  It also queues one follow-up pass, so wait for that pass before judging the
  final state. The app still makes no overlapping network requests.
- Do not assert token or account ID strings anywhere in the webview. Tokens
  stay in Rust memory only and are never emitted to the frontend.
