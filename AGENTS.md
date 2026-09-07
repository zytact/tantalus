# AGENTS.md

Tantalus is a Tauri 2 desktop tray app. React + Vite + TypeScript frontend in `src/`, Rust backend in `src-tauri/`. Use Vite+ for frontend tooling and package management. It delegates dependency operations to the pinned pnpm version.

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
