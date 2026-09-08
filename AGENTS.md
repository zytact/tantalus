# AGENTS.md

Tantalus is a Tauri 2 desktop tray app. React + Vite+ + TypeScript frontend in `src/`, Rust backend in `src-tauri/`.

## Toolchain

The frontend toolchain is [Vite+](https://viteplus.dev), driven by the global `vp` CLI. It bundles Vite, Vitest, Oxlint and Oxfmt, and it delegates package management to pnpm. Install it with `curl -fsSL https://vite.plus | bash`.

Lint, format and staged-file config live in the `lint`, `fmt` and `staged` blocks of `vite.config.ts`. Do not add `.oxlintrc.json`, `.oxfmtrc.json` or a `lint-staged` config.

`vp check` type checks through Oxlint's type-aware path, so there is no separate `tsc --noEmit` step.

`vp <name>` runs a built-in command; `vp run <name>` runs a `package.json` script. The two are not interchangeable.

A pre-commit hook at `.vite-hooks/pre-commit` runs `vp staged`. `vp config` installs the dispatcher and runs from the `prepare` script.

## Validation

After every change, run the following commands. Frontend commands run from the repo root. Cargo commands run from `src-tauri/`.

```sh
vp install --frozen-lockfile
vp check
vp test
vp build
```

```sh
cd src-tauri
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```
