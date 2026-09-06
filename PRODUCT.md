# Product

<!-- impeccable:product-schema 1 -->

## Platform

adaptive

## Stack

Delegated: Tauri 2, Rust, Vite, React, and TypeScript. Rust owns credentials, API access, refresh scheduling, normalization, and cached state so the webview never handles secrets.

## Users

Codex users on Linux who want a quick, private view of their 5-hour and 7-day allowance while working.

## Product Purpose

Show current Codex usage from a small desktop app and tray menu, including reset timing and available reset credits.

## Positioning

The app reads local Codex authentication only inside its Rust process and exposes a deliberately token-free display model to its webview.

## Operating Context

The app runs quietly in the Linux system tray. Users glance at it during a coding session, open the window for detail, and use Refresh when they need a current reading.

## Capabilities and Constraints

- Re-reads `${CODEX_HOME:-$HOME/.codex}/auth.json` for each refresh.
- Uses the WHAM usage API with a Codex usage fallback and gets reset credits separately.
- Does not persist, log, or expose tokens or account identifiers.
- Maps usage windows by their reported 18,000-second and 604,800-second durations. Missing or unfamiliar durations are unavailable, never guessed as 5-hour or 7-day usage.
- This project is intentionally Linux-first. Native compilation depends on locally installed WebKitGTK and tray libraries.

## Evidence on Hand

The behavioral reference is `/home/arnab/Projects/scripts/codex-usage`. Its API paths and JSON field alternatives are implemented, but it is never executed by the app.

## Product Principles

- Treat account data as sensitive.
- Make a glance enough for routine decisions.
- Keep failure visible without discarding the last good reading.
- Let native tray behavior carry the background workflow.

## Accessibility & Inclusion

The window uses semantic labels, keyboard-visible focus, sufficient contrast, and text alternatives for visual usage tracks.
