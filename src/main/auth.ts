import { execFile } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, win32 } from "node:path";
import { claudeSubscription, subscriptionName } from "../shared/usage";
import type { ProviderId } from "../shared/usage";
import { ReadFailure } from "./failure";
import { parseCodexSubscription, stringAt } from "./parse";

export type Credentials = {
  accessToken: string;
  accountId: string | null;
  email: string | null;
  plan: string | null;
  subscription_active_until_epoch: number | null;
};

/** Where each login keeps its credentials. The variable relocates the store: Codex and Claude point
 * theirs straight at the directory holding the file, while Opencode follows XDG, so its variable
 * names the data root above its own directory. */
const locations = {
  codex: { variable: "CODEX_HOME", underVariable: ["auth.json"], underHome: [".codex", "auth.json"] },
  claude: {
    variable: "CLAUDE_CONFIG_DIR",
    underVariable: [".credentials.json"],
    underHome: [".claude", ".credentials.json"],
  },
  opencode: {
    variable: "XDG_DATA_HOME",
    underVariable: ["opencode", "auth.json"],
    underHome: [".local", "share", "opencode", "auth.json"],
  },
} as const satisfies Record<ProviderId, { variable: string; underVariable: string[]; underHome: string[] }>;

/** The directory holding the provider's login on this machine, which is where its CLI keeps its
 * sessions too. WSL homes are left out, since touching them starts the distribution. */
export function dataDirectory(provider: ProviderId): string {
  const { variable, underVariable, underHome } = locations[provider];
  const directory = process.env[variable];
  return dirname(directory ? join(directory, ...underVariable) : join(process.env.HOME || homedir(), ...underHome));
}

/** Reads the first readable credential file for `provider`. Its variable wins outright; otherwise the
 * home directory is tried before any WSL distribution home. */
export async function readCredentials(provider: ProviderId): Promise<Credentials> {
  const { variable, underVariable, underHome } = locations[provider];
  const directory = process.env[variable];
  if (directory) return readFrom(provider, join(directory, ...underVariable));
  try {
    // Node reads HOME only on POSIX, but a Windows shell that sets it relocates the logins too.
    return await firstReadable(provider, [join(process.env.HOME || homedir(), ...underHome)]);
  } catch (error) {
    if (!(error instanceof ReadFailure) || error.reason !== "missingFile") throw error;
  }
  // Touching the WSL share starts the distribution behind it, so it is only scanned once the home
  // directory has turned up nothing.
  return firstReadable(provider, await wslAuthPaths(underHome));
}

/** The first path holding credentials. A file that exists but cannot be used outranks a missing one
 * in the failure. */
async function firstReadable(provider: ProviderId, paths: string[]): Promise<Credentials> {
  let failure = new ReadFailure("missingFile");
  for (const path of paths) {
    try {
      return await readFrom(provider, path);
    } catch (error) {
      if (error instanceof ReadFailure && error.reason !== "missingFile") failure = error;
    }
  }
  throw failure;
}

async function readFrom(provider: ProviderId, path: string): Promise<Credentials> {
  const raw = await readFile(path, "utf8").catch(() => {
    throw new ReadFailure("missingFile");
  });
  return parseCredentials(provider, raw);
}

const tokenPaths = [
  ["tokens", "access_token"],
  ["tokens", "access"],
  ["access_token"],
  ["access"],
  ["chatgptAuthTokens", "access_token"],
  ["chatgpt_auth", "access_token"],
  ["claudeAiOauth", "accessToken"],
  ["opencode-go", "key"],
];
const accountPaths = [
  ["account_id"],
  ["accountId"],
  ["tokens", "account_id"],
  ["tokens", "accountId"],
  ["chatgpt_account_id"],
  ["chatgptAccountId"],
];

const firstString = (value: unknown, paths: string[][]) =>
  paths.map((path) => stringAt(value, path)).find((found) => found !== null) || null;

export function parseCredentials(provider: ProviderId, raw: string): Credentials {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new ReadFailure("parse");
  }
  const accessToken = firstString(value, tokenPaths);
  if (!accessToken) throw new ReadFailure("missingToken");
  return { accessToken, accountId: firstString(value, accountPaths), ...credentialIdentity(provider, value) };
}

function credentialIdentity(
  provider: ProviderId,
  value: unknown,
): Pick<Credentials, "email" | "plan" | "subscription_active_until_epoch"> {
  if (provider === "opencode") return { email: null, plan: "Go", subscription_active_until_epoch: null };
  if (provider === "claude") {
    return {
      email: null,
      subscription_active_until_epoch: null,
      plan: claudeSubscription(
        stringAt(value, ["claudeAiOauth", "subscriptionType"]),
        stringAt(value, ["claudeAiOauth", "rateLimitTier"]),
      ),
    };
  }
  const token = stringAt(value, ["tokens", "id_token"]);
  const payload = token ? jwtPayload(token) : null;
  const plan = stringAt(payload, ["https://api.openai.com/auth", "chatgpt_plan_type"]);
  return {
    email: stringAt(payload, ["email"]),
    plan: plan ? subscriptionName(plan) : null,
    subscription_active_until_epoch: parseCodexSubscription({
      active_until: stringAt(payload, ["https://api.openai.com/auth", "chatgpt_subscription_active_until"]),
    }),
  };
}

function jwtPayload(token: string): unknown {
  try {
    const payload = token.split(".")[1];
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) : null;
  } catch {
    return null;
  }
}

const SHARE_ROOTS = ["\\\\wsl.localhost", "\\\\wsl$"];
let distributions: Promise<string[]> | undefined;

/** Windows hosts can hold their logins inside a WSL distribution, reachable over the
 * `\\wsl.localhost` share. Distribution names are listed once per process; the home directories
 * behind them are read on every lookup so a fresh login is picked up without a restart. */
async function wslAuthPaths(underHome: readonly string[]): Promise<string[]> {
  if (process.platform !== "win32") return [];
  distributions ??= new Promise((resolve) => {
    execFile("wsl.exe", ["--list", "--quiet"], { encoding: "buffer", windowsHide: true }, (_error, stdout) =>
      resolve(distributionNames(stdout)),
    );
  });
  const paths: string[] = [];
  for (const distribution of await distributions) {
    for (const root of SHARE_ROOTS) {
      const base = win32.join(root, distribution);
      const users = await readdir(win32.join(base, "home")).catch(() => null);
      if (users === null) continue;
      const homes = [...users.map((user) => win32.join(base, "home", user)), win32.join(base, "root")];
      paths.push(...homes.map((home) => win32.join(home, ...underHome)));
      break;
    }
  }
  return paths;
}

/** `wsl.exe --list --quiet` writes UTF-16LE on most Windows builds and UTF-8 on some, so the encoding
 * is detected from the bytes rather than assumed. */
export function distributionNames(output: Buffer): string[] {
  const utf16 =
    output.length >= 2 && output.length % 2 === 0 && output.every((byte, index) => index % 2 === 0 || byte === 0);
  return output
    .toString(utf16 ? "utf16le" : "utf8")
    .split("\n")
    .map((line) => line.replace(/^[\s\uFEFF\0]+|[\s\uFEFF\0]+$/g, ""))
    .filter((line) => line.length > 0);
}
