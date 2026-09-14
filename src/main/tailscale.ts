import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { field } from "./parse";

const run = promisify(execFile);

const TIMEOUT_MILLISECONDS = 10_000;

/** The Mac App Store and standalone apps keep the CLI inside the bundle, off the `PATH` a Finder launch
 * gets. */
const MAC_APP_CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

/** The tailnet reaches `https://<machine>:<httpsPort>` and Tailscale proxies it to the local port. The
 * route lives in Tailscale's own config, so it outlasts the app and a reboot. */
export async function serveTailscale(httpsPort: number, localPort: number) {
  await tailscale(["serve", "--bg", `--https=${httpsPort}`, `http://127.0.0.1:${localPort}`]);
}

/** Removing a route that is already gone counts as removed. */
export async function stopTailscale(httpsPort: number) {
  await tailscale(["serve", `--https=${httpsPort}`, "off"]).catch((error: unknown) => {
    if (!(error instanceof TailscaleError && error.output.includes("handler does not exist"))) throw error;
  });
}

export async function tailscaleUrl(httpsPort: number): Promise<string> {
  const status: unknown = JSON.parse(await tailscale(["status", "--json"]));
  const name = field(field(status, "Self"), "DNSName");
  if (typeof name !== "string" || name === "") throw new Error("Tailscale reported no machine name.");
  return `https://${name.replace(/\.$/, "")}:${httpsPort}`;
}

/** The message is what Settings shows. The CLI's own output can carry auth keys and node names, so it
 * stays on the error for matching and is never shown or logged. */
class TailscaleError extends Error {
  constructor(
    message: string,
    readonly output = "",
  ) {
    super(message);
  }
}

const executable =
  process.platform === "win32"
    ? "tailscale.exe"
    : process.platform === "darwin" && existsSync(MAC_APP_CLI)
      ? MAC_APP_CLI
      : "tailscale";

async function tailscale(args: string[]): Promise<string> {
  try {
    const { stdout } = await run(executable, args, { timeout: TIMEOUT_MILLISECONDS });
    return stdout;
  } catch (error) {
    throw tailscaleFailure(error);
  }
}

/** Matched against the CLI's output, most specific first. */
const failures: [RegExp, string][] = [
  [/not logged in|logged out|needs? login/i, "Tailscale is not signed in."],
  [
    /access denied|permission denied|must be root|operation not permitted/i,
    process.platform === "linux"
      ? "Tailscale needs permission. Run sudo tailscale set --operator=$USER once, then try again."
      : "Tailscale denied the request.",
  ],
];

/** Turns a failed CLI run into the message Settings shows. */
export function tailscaleFailure(error: unknown): TailscaleError {
  if (field(error, "code") === "ENOENT") return new TailscaleError("Tailscale is not installed.");
  const output = [field(error, "stdout"), field(error, "stderr")].filter((text) => typeof text === "string").join("\n");
  // A tailnet without Serve turned on makes the CLI print an approval link and wait for it.
  const approval = /https:\/\/login\.tailscale\.com\/f\/serve\S*/.exec(output)?.[0];
  if (approval) return new TailscaleError(`Serve is off for this tailnet. Turn it on at ${approval}`, output);
  if (field(error, "killed") === true) return new TailscaleError("Tailscale did not respond.", output);
  const message = failures.find(([pattern]) => pattern.test(output))?.[1];
  return new TailscaleError(message ?? "Tailscale could not serve the page.", output);
}
