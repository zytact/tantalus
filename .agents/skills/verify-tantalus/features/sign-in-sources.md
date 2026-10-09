# Sign-in sources

On Windows, Settings has `Windows` and `WSL` switches after the provider switches. Both start on, including for an install updated from a version without them, and a missing or unreadable `sign-ins.json` in the settings directory falls back to both on. Windows reads Codex, Claude and Opencode logins from the Windows home folder; WSL reads them from every distribution's `/home/*` and `/root` over `\\wsl.localhost`. A provider's variable, such as `CODEX_HOME` or `XDG_DATA_HOME`, relocates the Windows login only. With WSL off, Tantalus never lists distributions with `wsl.exe` and never touches the share, so no distribution starts.

Every login found is its own account, in provider order with the Windows one first. A provider with one account is named after the provider alone. Once it has several, each is named provider plus blurred email (`<Provider> <n>` without an email), the tray picker leads with a `<Provider> · All <n> accounts` pool, and the tray menu numbers them. A provider with no login found shows once as not signed in. Each account keeps its own usage, pace and window start: the Windows account runs its CLI natively, and a WSL account runs it through `wsl.exe -d <distro>`. A configured POSIX CLI path applies to WSL accounts only, and a configured Windows path to the Windows account only. Switching a source off removes its accounts at once and reads again, without a restart.

macOS and Linux have no sign-in switches: the snapshot's `sign_ins` is null and the home folder is the only source. Following a host hides them with the other local settings.

`findSignIns` and `dataDirectories` in `src/main/auth.ts` find the logins and session folders, `UsageState.setSignInSource` and `refreshProvider` in `src/main/usage-state.ts` own the accounts, `namedDirectAccounts` in `src/shared/usage.ts` names them, and `SignInRows` in `src/renderer/settings-page.tsx` draws the switches.

## Preview proof

The preview runs on Linux, so it proves only that the switches stay hidden and direct accounts read as before. On `--mock ready`, open Settings and confirm the snapshot has `switch "Codex"`, `switch "Claude"` and `switch "Opencode"` but no `switch "Windows"` or `switch "WSL"`, in both schemes. Return to Allowance and confirm one Codex, one Claude, and with Opencode on one Opencode section, each headed by the provider name alone. Switch on Usage in tray and confirm the picker offers `Codex` and `Claude` without a pool.

Windows and WSL behavior needs a Windows host with WSL installed, which this harness cannot drive. Prove it offline with `vp test src/main/auth.test.ts src/main/usage-state.test.ts src/main/cli.test.ts src/main/window-start.test.ts src/shared/tray-usage.test.ts src/main/settings.test.ts`, which fake Windows and WSL homes for discovery, both switches, labels, pooling and the `wsl.exe -d <distro>` start.
