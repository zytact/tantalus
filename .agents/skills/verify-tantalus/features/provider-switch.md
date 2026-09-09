# Provider switch

Settings holds an on/off switch per provider. It decides whether Tantalus polls
that provider at all and whether the allowance view shows it.

## Sub-features

- `role=switch[name="Codex"]` and `role=switch[name="Claude"]` with
  `aria-checked`, on the Settings page (`src/settings-page.tsx` `ProviderRow`)
- Off removes that provider from the allowance view entirely: no header row, no
  Short window, Long window, or Extras (`src/main.tsx` `App`)
- With both off, the allowance view reads `No providers are on. Turn one on in
  Settings.`
- Off means not polled: `read_enabled` returns `None`, so no credential file
  is opened and no request is sent (`src-tauri/src/lib.rs`)
- Off drops that provider's tray line and clears its stored figures
  (`update_tray_menu`, `set_provider_enabled`)
- On refreshes that provider immediately
- The choice persists to `providers.json` in the app config directory and is
  read back at startup (`src-tauri/src/settings.rs`)
- The header `updated HH:MM` only counts enabled providers

## How to get to it (user POV)

Click `Settings`, then the Codex or Claude switch. The knob slides and the state
word becomes `Off`. Click `Back` and that provider is gone from the allowance
view. Restart the app and it is still off.

## Driving it with browser tab

Mock-driven (Drive step 3 in `SKILL.md`): after the remount, click `Settings`,
then a provider switch. The knob slides and the state word becomes `Off`. Click
`Back` and confirm that provider's block is gone while the other keeps
refreshing. Read back localStorage `tantalus-mock-enabled`: it holds the
`{"codex":true,"claude":false}`-shaped choice, the mock's stand-in for
`providers.json`. Switch back on and the block returns with a fresh fetch.
`window.__TANTALUS_MOCK__.reset()` clears the stored choice.

1. Launch on an isolated port and run `scripts/check-ui.sh <PORT>` for the
   static shell.
2. In a bare browser tab, `cached_usage` rejects and the app shows `Could not
   load provider settings`. Settings then renders the provider rows as
   `Unavailable` with no switch, so do not click or assert one there.
3. Logic proof without Tauri: `cargo test` covers the `providers.json` round
   trip (`settings::tests`) and that a disabled provider is never read
   (`a_disabled_provider_is_never_read`)
4. Real proof needs `vp run tauri dev` on a desktop or the mock in any browser:
   switch Claude off, confirm its block vanishes from the allowance view, its
   tray line disappears (Tauri only), `providers.json` reads
   `{"codex":true,"claude":false}`, and Codex keeps refreshing. Switch it
   back on and confirm an immediate refresh.

## Gotchas

- The switches used to live on each provider's header row in the allowance
  view. That row is now a plain heading with a status word, so any selector
  expecting `role=switch` there is stale.
- Switching off discards that provider's figures. After switching back on,
  expect a fresh fetch rather than the old numbers.
- A failure to write `providers.json` returns an error. The command leaves
  the switch, settings, and usage snapshot unchanged, and Settings shows
  `Could not save the Claude setting.`
