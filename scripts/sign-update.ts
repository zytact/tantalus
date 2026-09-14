import { run } from "@tauri-apps/cli";

/** Signs bundles in the format used by Tauri releases, so every installed version trusts them. */
for (const file of process.argv.slice(2)) {
  await run(["signer", "sign", file]);
}
