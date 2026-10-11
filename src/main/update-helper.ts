import { execFileSync } from "node:child_process";
import { mkdtempSync, readSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { verifySignature } from "./release";

const installers = new Map([
  ["deb", ["/usr/bin/dpkg", "--refuse-downgrade", "-i"]],
  ["rpm", ["/usr/bin/rpm", "-U"]],
]);
const MAX_PACKAGE_SIZE = 1024 ** 3;

function readPackage(descriptor: number): Buffer {
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const chunk = Buffer.alloc(1024 ** 2);
    const read = readSync(descriptor, chunk);
    if (read === 0) return Buffer.concat(chunks);
    size += read;
    if (size > MAX_PACKAGE_SIZE) throw new Error("the update is too large");
    chunks.push(chunk.subarray(0, read));
  }
}

/** Installs the package on `input` as root. polkit lets an active session run this without a password,
 * so it trusts nothing from its caller and opens no path the caller names. It installs only its own
 * copy of a package the release key signed, and never an older release. */
export function installUpdate(format: string | undefined, signature: string | undefined, input = 0) {
  const installer = format && installers.get(format);
  if (!installer || !signature) throw new Error("usage: <signature>, with the package on stdin");
  const data = readPackage(input);
  if (!verifySignature(data, signature)) throw new Error("the update failed its signature check");
  const directory = mkdtempSync("/var/tmp/tantalus-update-");
  try {
    const copy = join(directory, `update.${format}`);
    writeFileSync(copy, data);
    const [command, ...args] = installer;
    const { ELECTRON_RUN_AS_NODE: _, TANTALUS_UPDATE_SIGNATURE: __, ...env } = process.env;
    execFileSync(command, [...args, copy], { stdio: ["ignore", "inherit", "inherit"], env });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
