# AGENTS.md

Tantalus is a Tauri 2 desktop tray app. React + Vite + TypeScript frontend in `src/`, Rust backend in `src-tauri/`. Package manager is pnpm.

## Validation

After every change, run the following commands. Frontend commands run from the repo root. Cargo commands run from `src-tauri/`.

```sh
pnpm install --frozen-lockfile
pnpm tsc --noEmit
pnpm test
pnpm vite build
```

```sh
cd src-tauri
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
cargo test --all-features
```
