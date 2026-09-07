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

Mock-driven (Drive step 3 in `SKILL.md`): after the remount, click the
Codex or Claude row (`role=switch`). The knob slides, the status word
becomes `Off`, and everything below that row disappears; the other
provider keeps refreshing. Read back localStorage
`tantalus-mock-enabled`: it holds the `{"codex":true,"claude":false}`-shaped
choice, the mock's stand-in for `providers.json`. Switch back on and the
entries return with a fresh fetch. `window.__TANTALUS_MOCK__.reset()`
clears the stored choice.

1. Launch on an isolated port and run `scripts/check-ui.sh <PORT>` for the
   static shell.
2. In a bare browser tab, `cached_usage` rejects and the app shows `Could not
load provider settings`. It renders no switches, so do not click or assert
   a provider switch there.
3. Logic proof without Tauri: `pnpm test` covers `statusLine(..., false)`
   returning `Off`; `cargo test` covers the `providers.json` round trip
   (`settings::tests`) and that a disabled provider is never read
   (`a_disabled_provider_is_never_read`)
4. Real proof needs `pnpm tauri dev` on a desktop or the mock in any browser: switch Claude off, confirm
   its entries vanish, its tray line disappears (Tauri only), `providers.json` reads
   `{"codex":true,"claude":false}`, and Codex keeps refreshing. Switch it
   back on and confirm an immediate refresh.

## Gotchas

- The row used to be an expand/collapse control (`aria-expanded`). It is now
  a real switch, so any selector using `aria-expanded` is stale.
- Switching off discards that provider's figures. After switching back on,
  expect a fresh fetch rather than the old numbers.
- A failure to write `providers.json` returns an error. The command leaves
  the switch, settings, and usage snapshot unchanged, and the UI shows
  `Could not save provider setting.`
