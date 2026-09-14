import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/** Signs each bundle named on the command line with the Ed25519 key in `UPDATE_SIGNING_KEY`, writing
 * a base64 `<bundle>.sig` beside it. The updater checks it against the public key in
 * `src/main/release.ts`. */
const pem = process.env.UPDATE_SIGNING_KEY;
if (!pem) throw new Error("UPDATE_SIGNING_KEY is not set");
const key = createPrivateKey(pem);
for (const file of process.argv.slice(2)) {
  writeFileSync(`${file}.sig`, sign(null, readFileSync(file), key).toString("base64"));
  console.log(`signed ${file}`);
}
