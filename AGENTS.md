# AGENTS.md

Tantalus is an Electron tray app written in TypeScript. The main process is in `src/main/`, the preload bridge in `src/preload/`, the React page in `src/renderer/`, and the types and helpers both sides use in `src/shared/`. The IPC contract lives in `src/shared/ipc.ts`.

Release-please owns the `package.json` version and `CHANGELOG.md`, so never edit either by hand. PRs are squash-merged, so the PR title sets the bump. Below 1.0, `fix` and `feat` bump the patch version, and `!` (`feat!:`) or a `BREAKING CHANGE:` footer bumps the minor version. Mark anything that breaks updates or saved settings for installed apps as breaking. The README's Releasing section covers the pipeline.

## Usage features

Tantalus reads three providers: Codex, Claude and Opencode. Each one is read directly from local sign-ins, and Codex and Claude can also come through a CLIProxyAPI hub account. A usage feature covers every provider and every hub account unless the request names one. When a provider or the hub has no field for the feature, say so in the PR. Do not quietly skip it.

A new reading follows this path:

1. `src/main/api.ts` and `src/main/parse.ts` fetch and parse a direct provider. `src/main/proxy-hub-api.ts` does the same for hub accounts.
2. `src/shared/usage.ts` holds the `ProviderUsage` shape, and `src/shared/ipc.ts` the bridge contract.
3. `src/renderer/presentation.ts` formats the reading, and `src/renderer/main.tsx` renders it for the window and the remote access page.
4. `src/main/tray-menu.ts` builds the tray lines. The tray never shows account emails, and the window keeps them hidden until clicked.

The fixture server in the `verify-tantalus` skill serves every provider and a hub, so features for accounts you do not have still get a live check.

## Toolchain

The toolchain is [Vite+](https://viteplus.dev), driven by the global `vp` CLI. It bundles Vite, Vitest, Oxlint and Oxfmt, and it delegates package management to pnpm. Install it with `curl -fsSL https://vite.plus | bash`.

`vp build` bundles the page into `dist/`, and `vp pack` bundles the main process and preload into `dist-electron/`. Lint, format, pack and staged-file config live in the `lint`, `fmt`, `pack` and `staged` blocks of `vite.config.ts`. Do not add `.oxlintrc.json`, `.oxfmtrc.json` or a `lint-staged` config.

`vp check` type checks through Oxlint's type-aware path, so there is no separate `tsc --noEmit` step.

`vp <name>` runs a built-in command; `vp run <name>` runs a `package.json` script. The two are not interchangeable.

A pre-commit hook at `.vite-hooks/pre-commit` runs `vp staged`. `vp config` installs the dispatcher and runs from the `prepare` script.

## Validation

After every change, run the following commands from the repo root.

```sh
vp install --frozen-lockfile
vp check
vp test
vp run fallow
vp build
vp pack
```
