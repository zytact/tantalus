# Provider switch

Each provider's header row is an on/off switch that decides whether Tantalus
polls that provider at all.

## Sub-features

- `role=switch[name="Codex"]` and `role=switch[name="Claude"]` with
  `aria-checked` (`src/main.tsx` `ProviderSection`)
- Off hides that provider's Short window, Long window, and Extras, and its
  status word reads `Off` (`src/presentation.ts` `statusLine`)
- Off means not polled: `read_enabled` returns `None`, so no credential file
  is opened and no request is sent (`src-tauri/src/lib.rs`)
- Off drops that provider's tray line and clears its stored figures
  (`update_tray_menu`, `set_provider_enabled`)
- On refreshes that provider immediately
- The choice persists to `providers.json` in the app config directory and is
  read back at startup (`src-tauri/src/settings.rs`)
- The header `updated HH:MM` only counts enabled providers

## How to get to it (user POV)

Open the window and click the Codex or Claude row. The switch knob slides,
the status word becomes `Off`, and everything below that row disappears.
Restart the app and it is still off.

## Driving it with browser tab

1. Launch on an isolated port, navigate, snapshot
2. Assert two `role=switch` rows named `Codex` and `Claude`, both
   `aria-checked=true`, each showing `LOADING`
3. Click a switch. Headless the DOM does not change: `set_provider_enabled`
   rejects without the Rust side, exactly like `Refresh`. That is the harness
   limit, not an app bug.
4. Logic proof without Tauri: `pnpm test` covers `statusLine(..., false)`
   returning `Off`; `cargo test` covers the `providers.json` round trip
   (`settings::tests`) and that a disabled provider is never read
   (`a_disabled_provider_is_never_read`)
5. Real proof needs `pnpm tauri dev` on a desktop: switch Claude off, confirm
   its entries vanish, its tray line disappears, `providers.json` reads
   `{"codex":true,"claude":false}`, and Codex keeps refreshing. Switch it
   back on and confirm an immediate refresh.

## Gotchas

- The row used to be an expand/collapse control (`aria-expanded`). It is now
  a real switch, so any selector using `aria-expanded` is stale.
- Switching off discards that provider's figures. After switching back on,
  expect a fresh fetch rather than the old numbers.
- A failure to write `providers.json` is logged to stderr and the switch
  still applies for the session.
