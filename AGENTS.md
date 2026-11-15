# AGENTS.md

Tantalus is an Electron tray app written in TypeScript. The main process is in `src/main/`, the preload bridge in `src/preload/`, the React page in `src/renderer/`, and the types and helpers both sides use in `src/shared/`. The IPC contract lives in `src/shared/ipc.ts`.

Release-please owns the `package.json` version and `CHANGELOG.md`, so never edit either by hand. PRs are squash-merged, so the PR title sets the bump. Below 1.0, `fix` and `feat` bump the patch version, and `!` (`feat!:`) or a `BREAKING CHANGE:` footer bumps the minor version. Mark anything that breaks updates or saved settings for installed apps as breaking. The README's Releasing section covers the pipeline.

The `.claude` and `.agents` skill directories must stay byte identical (excluding ignored local state such as `.claude/worktrees/`). Every edit to one side must be mirrored to the other in the same commit.

And a feature made for direct sign-ins should be made for CLIProxyAPI too and vice versa unless stated otherwise. If you think that is not possible in a certain case, say so.

For UI changes, maintain liquid glass and look at Apple's guidelines.

## Usage features

Tantalus reads three providers: Codex, Claude and Opencode. Each one is read directly from local sign-ins, and Codex and Claude can also come through a CLIProxyAPI hub account. A usage feature covers every provider and every hub account unless the request names one. When a provider or the hub has no field for the feature, say so in the PR. Do not quietly skip it.

## Toolchain

The toolchain is [Vite+](https://viteplus.dev), driven by the global `vp` CLI. It bundles Vite, Vitest, Oxlint and Oxfmt, and it delegates package management to pnpm. Install it with `curl -fsSL https://vite.plus | bash`.

`vp build` bundles the page into `dist/`, and `vp pack` bundles the main process and preload into `dist-electron/`. Lint, format, pack and staged-file config live in the `lint`, `fmt`, `pack` and `staged` blocks of `vite.config.ts`. Do not add `.oxlintrc.json`, `.oxfmtrc.json` or a `lint-staged` config.

`vp check` type checks through Oxlint's type-aware path, so there is no separate `tsc --noEmit` step.

`vp <name>` runs a built-in command; `vp run <name>` runs a `package.json` script. The two are not interchangeable.

A pre-commit hook at `.vite-hooks/pre-commit` runs `vp staged`. `vp config` installs the dispatcher and runs from the `prepare` script.

## Validation

After a change, run only the commands it can affect, from the repo root. Skip the rest. Checks and tests run on at most 4 threads. `vite.config.ts` sets Vitest's `maxWorkers` and the type checker's `GOMAXPROCS` to 4, and the commands below pass `--threads=4`.

- `vp install --frozen-lockfile` when `package.json` or `pnpm-lock.yaml` changed.
- `vp fmt --check --threads=4` and `vp lint --threads=4` in place of `vp check`, which takes no thread count. Run them on the whole project, since a type change can break files that import it.
- `vp test related <changed files> --run` for the tests that import the changed files. Run the full `vp test` when `vite.config.ts`, `package.json`, `pnpm-lock.yaml` or a test helper changed.
- `vp run fallow`, which only audits the diff against `origin/main`.
- `vp build` when `src/renderer/`, `src/shared/`, `index.html`, `vite.config.ts` or `package.json` changed.
- `vp pack` when `src/main/`, `src/preload/`, `src/shared/`, `build/icons/`, `vite.config.ts` or `package.json` changed.
