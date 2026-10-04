# Monthly window (30 days)

The main process maps Codex's exact 2,592,000-second window and Opencode's `usage.monthly` into Monthly. Codex hub accounts use the same mapping. Codex Go and free accounts may report Monthly without Short or Long. Opencode can report Short, Long, and Monthly, but is direct-only. Direct and hub Claude currently have no monthly mapping.

It shows the used percentage, a progressbar named `Monthly window usage`, optional pace, Resets in, At, and Remaining.

## Preview proof

In Tantalus Preview on `--mock` `ready`, enable Opencode and add the fixture hub per `proxy-hubs.md`. Refresh and capture Opencode Monthly at 33% used and 67% remaining. Switch to `monthly-only` and confirm direct and hub Codex have only Monthly, at 58% used and 42% remaining. Neither Claude account has Monthly. In real mode, use a Codex or Opencode account that reports Monthly. Confirm `Monthly window`, `30 days`, its facts, and its position after other reported windows. The tray uses separate account headings and separate `5h`, `7d`, and `30d` rows. A monthly-only Codex account has only its `30d` row.
