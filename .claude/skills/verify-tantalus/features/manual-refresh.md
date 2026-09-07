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
- No overlapping refreshes: Rust `refreshing` AtomicBool returns the cached
  snapshot when a refresh is already running
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

1. Launch on an isolated port, navigate, snapshot the Refresh button
2. Headless: click Refresh and confirm only a brief disabled state happens.
   `invoke("refresh_usage")` rejects without Rust, so no new data appears.
   That is expected.
3. Logic proof headless: `pnpm test` plus
   `cargo test --manifest-path src-tauri/Cargo.toml`
4. Live proof (necessary, single pass): `scripts/live-check.sh "$EVIDENCE"`
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
5. Real UI proof needs `pnpm tauri dev` on a desktop: click Refresh, watch
   the button flip to `Refreshing`, then confirm each provider's status word
   and the `updated` time advance. The figures should match the latest
   `live-usage.json` from step 4.
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
- Do not assert token or account ID strings anywhere in the webview. Tokens
  stay in Rust memory only and are never emitted to the frontend.
