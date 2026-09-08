import react from "@vitejs/plugin-react";
import { defineConfig, lazyPlugins } from "vite-plus";

/** Build output, the Rust crate (cargo fmt owns it), and the hand-laid-out agent skill docs. */
const notOurs = ["dist/**", "src-tauri/**", ".agents/**", ".claude/**"];

export default defineConfig({
  plugins: lazyPlugins(() => [react()]),
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_"],
  fmt: {
    ignorePatterns: notOurs,
    printWidth: 120,
  },
  lint: {
    ignorePatterns: notOurs,
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  staged: {
    "*.{ts,tsx,js,jsx,json,css,html,md}": "vp check --fix",
  },
});
