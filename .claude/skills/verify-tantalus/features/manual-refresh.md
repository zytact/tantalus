# Manual refresh

User-initiated re-read of credentials plus usage and credits fetch.

## Sub-features

- `role=button[name="Refresh"]`, disabled with `Refreshing` text and
  `aria-busy=true` while in flight (`src/main.tsx`)
- Tauri commands `cached_usage` (initial paint) and `refresh_usage`
  (button), snapshot event `usage-snapshot`
- No overlapping refreshes: Rust `refreshing` AtomicBool returns the cached
  snapshot when a refresh is already running
- 12-second network timeout (`src-tauri/src/api.rs` `client()`)
- Failure keeps the last successful reading and labels it stale; without any
  success the status becomes `auth_missing` (missing file) or `error`
- Degraded notice `role=status` with `error_message` or the fallback
  `The last successful reading remains visible.`

## How to get to it (user POV)

Click **Refresh** in the window header, or tray **Refresh now**. The status
line under `Allowance` changes: `Live`, `Blocked until the next reset`,
`Loading`, `Showing cached data`, `Authentication needed`,
`Could not refresh`, each followed by `updated HH:MM` or
`no successful update yet`.

## Driving it with browser tab

1. Launch on an isolated port, navigate, snapshot the Refresh button
2. Headless: click Refresh and confirm only a brief disabled state happens.
   `invoke("refresh_usage")` rejects without Rust, so no new data appears.
   That is expected.
3. Logic proof headless: `pnpm test` plus
   `cargo test --manifest-path src-tauri/Cargo.toml`
4. Live proof (necessary, single pass): `scripts/live-check.sh "$EVIDENCE"`
   performs exactly one refresh against the real APIs with the real
   credential file. It mirrors `api.rs` (WHAM first, Codex fallback,
   credits separately, 12s timeout, no loop) and logs only the endpoint
   used, HTTP statuses, window key names, and credit counts. Exit 0 is the
   Ready path; exit 1 is the usage-failed error path; exit 2 is the
   auth-missing path. To prove auth-missing without touching the real
   login, run with `CODEX_HOME=/tmp/opencode/tantalus-verify/coverage-home`
   (empty dir): expect `Authentication needed` / exit 2.
5. Real UI proof needs `pnpm tauri dev` on a desktop: click Refresh, watch
   the button flip to `Refreshing`, then confirm the status line and
   `updated` time advance. The figures should match the latest
   `live-usage.json` from step 4.
6. Optional stale proof: disconnect network after one success under Tauri
   and refresh: expect `Showing cached data` with the old figures intact.

## Gotchas

- Each refresh re-reads the credential file; `CODEX_HOME` wins over
  `~/.codex/auth.json`. Never set `CODEX_HOME` to the real home in a test.
- WHAM usage is tried first, Codex usage second, reset credits separately.
  One endpoint failing does not have to fail the others the same way.
- Do not assert token or account ID strings anywhere in the webview. Tokens
  stay in Rust memory only and are never emitted to the frontend.
