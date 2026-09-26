# Dragon and tortoise

Tantalus learns each 5h, 7d, and 30d window's usual pace from the percentage rises its polls see, and keeps that history in `pace-log.json` in the settings directory. Direct providers and each proxy hub account learn apart. A window watches for 5 hours, 3.5 days, or 5 days and needs at least one reading before it has a usual pace. After that, a dragon rides its bar when the current rate reaches the preset's multiple of the usual pace, and a tortoise when it drops that far below while a local session of that provider is in use. The first creature shown brings a one-time explainer.

Settings has the `Dragon and tortoise` switch, on by default. While it is on, the `Dragon and tortoise details` region shows the Calm, Normal, and Eager presets and one row per window, either learning (`1m of 5h`, `Done learning <time>`) or learned (recent readings, `Usual`, `Right now`). The log keeps recording while the switch is off.

`Reset learning` shows whether the switch is on or off. `Reset` asks for confirmation, `Cancel` backs out, and `Forget` saves an empty log first and then starts every window again from its latest reading. A failed save keeps the old log and the confirm step, and shows `Could not reset what Tantalus learned.` under the row.

## Preview proof

Use mock mode, since a real account needs days to learn. After `launch.sh --mock`, run `seed-pace.sh` and then `launch.sh --restart` so the preview loads a learned log for the Codex and Claude 5h and 7d windows. Open Settings, `scroll button Reset`, and capture the learned rows. Click `Reset`, capture the confirm step, click `Cancel`, then `Reset` and `Forget`. Every window must read learning at `0m`, and `mock-home/config/dev.arnab.tantalus.preview/pace-log.json` must hold entries with no readings. `launch.sh --restart` must keep that state. Switch the creatures off and confirm `Reset learning` still shows. For the failure, `chmod 500` that settings directory, reset, confirm the alert, then `chmod 700` it back.

The allowance view shows `Learning your usual pace` with each window's done time until a window learns. No fixture changes its figures between polls, so no creature can ride a bar in mock mode; the creatures and the one-time explainer are covered by `src/shared/pace.test.ts` and need a real account in active use to see live.

Never reset in real mode unless the preview's settings directory is `~/.config/dev.arnab.tantalus.preview/`. The release app's log in `~/.config/dev.arnab.tantalus/` is off limits.
