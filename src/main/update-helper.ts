import { execFileSync } from "node:child_process";
import { closeSync, constants, fstatSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { verifySignature } from "./release";

/** Installs an update as root: `<deb|rpm> <package> <signature>`. polkit lets an active session run
 * this without a password, so it trusts nothing its caller passes. It installs only its own copy of a
 * package the release key signed, and never an older release. */
const installers = new Map([
  ["deb", ["/usr/bin/dpkg", "--refuse-downgrade", "-i"]],
  ["rpm", ["/usr/bin/rpm", "-U"]],
]);

function readPackage(file: string): Buffer {
  // Non-blocking, so a FIFO cannot hold a root process open.
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    if (!fstatSync(descriptor).isFile()) throw new Error("the update is not a regular file");
    return readFileSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

export function installUpdate([format, file, signature]: string[]) {
  const installer = installers.get(format);
  if (!installer || !file || !signature) throw new Error("usage: <deb|rpm> <package> <signature>");
  const data = readPackage(file);
  if (!verifySignature(data, signature)) throw new Error("the update failed its signature check");
  const directory = mkdtempSync(join(tmpdir(), "tantalus-update-"));
  try {
    const copy = join(directory, `update.${format}`);
    writeFileSync(copy, data);
    const [command, ...args] = installer;
    execFileSync(command, [...args, copy], { stdio: ["ignore", "inherit", "inherit"] });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
