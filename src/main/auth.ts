import { execFile } from "node:child_process";
import { access, readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { posix, win32 } from "node:path";
import { claudeSubscription, homeSignIn, subscriptionName } from "../shared/usage";
import type { DirectAccount, ProviderId, SignInSettings } from "../shared/usage";
import { ReadFailure } from "./failure";
import { field, parseCodexSubscription, stringAt } from "./parse";

export type Credentials = {
  accessToken: string;
  accountId: string | null;
  email: string | null;
  plan: string | null;
  subscription_active_until_epoch: number | null;
  expires_at_epoch: number | null;
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

/** The machine sign-ins are looked up on, passed in so Windows and WSL homes can be faked in tests. */
export type SignInHost = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  exists: (path: string) => Promise<boolean>;
  /** The entries of a directory, or null when it cannot be read. */
  list: (path: string) => Promise<string[] | null>;
  distributions: () => Promise<string[]>;
};

let distributions: Promise<string[]> | undefined;

export const localHost: SignInHost = {
  platform: process.platform,
  env: process.env,
  // Node reads HOME only on POSIX, but a Windows shell that sets it relocates the logins too.
  home: process.env.HOME || homedir(),
  exists: (path) =>
    access(path).then(
      () => true,
      () => false,
    ),
  list: (path) => readdir(path).catch(() => null),
  // Distribution names are listed once per process. The homes behind them are read on every lookup,
  // so a fresh login is picked up without a restart.
  distributions: () =>
    (distributions ??= new Promise((resolve) => {
      execFile("wsl.exe", ["--list", "--quiet"], { encoding: "buffer", windowsHide: true }, (_error, stdout) =>
        resolve(distributionNames(stdout)),
      );
    })),
};

/** A credential file found on this machine. `id` stays the same across reads, and `distribution` names
 * the WSL distribution the file lives in, or is null for this machine's own home folder. */
export type SignIn = Pick<DirectAccount, "id" | "distribution"> & { path: string };

/** Every credential file of `provider` in the sources switched on, the home folder's first. The
 * provider's variable relocates the home folder's file only. Only a Windows host has WSL homes, and
 * with WSL off they are never touched, since touching one starts its distribution. */
export async function findSignIns(
  provider: ProviderId,
  sources: SignInSettings,
  host: SignInHost = localHost,
): Promise<SignIn[]> {
  const candidates = [
    ...(readsHome(host, sources) ? [homeFolderSignIn(provider, host)] : []),
    ...(host.platform === "win32" && sources.wsl ? await wslSignIns(provider, host) : []),
  ];
  const found = await Promise.all(candidates.map(async (signIn) => ((await host.exists(signIn.path)) ? [signIn] : [])));
  return found.flat();
}

/** The directories each sign-in's CLI keeps its sessions in, which is where its credentials live. The
 * home folder's is kept without a sign-in, since its CLI may still be in use. */
export async function dataDirectories(
  provider: ProviderId,
  sources: SignInSettings,
  host: SignInHost = localHost,
): Promise<string[]> {
  const path = host.platform === "win32" ? win32 : posix;
  const signIns = [
    ...(readsHome(host, sources) ? [homeFolderSignIn(provider, host)] : []),
    ...(await findSignIns(provider, sources, host)),
  ];
  return [...new Set(signIns.map((signIn) => path.dirname(signIn.path)))];
}

const readsHome = ({ platform }: SignInHost, sources: SignInSettings) => platform !== "win32" || sources.windows;

function homeFolderSignIn(provider: ProviderId, { platform, env, home }: SignInHost): SignIn {
  const { variable, underVariable, underHome } = locations[provider];
  const path = platform === "win32" ? win32 : posix;
  const directory = env[variable];
  return {
    id: homeSignIn,
    distribution: null,
    path: directory ? path.join(directory, ...underVariable) : path.join(home, ...underHome),
  };
}

const SHARE_ROOTS = ["\\\\wsl.localhost", "\\\\wsl$"];

/** The possible credential files inside every WSL distribution, one per home under `/home` plus
 * `/root`, reached over the `\\wsl.localhost` share. */
async function wslSignIns(provider: ProviderId, host: SignInHost): Promise<SignIn[]> {
  const { underHome } = locations[provider];
  const signIns: SignIn[] = [];
  for (const distribution of await host.distributions()) {
    for (const root of SHARE_ROOTS) {
      const base = win32.join(root, distribution);
      const users = await host.list(win32.join(base, "home"));
      if (users === null) continue;
      const homes = [...users.map((user) => `/home/${user}`), "/root"];
      signIns.push(
        ...homes.map((home) => ({
          id: `wsl:${distribution}:${home}`,
          distribution,
          path: win32.join(base, ...home.split("/"), ...underHome),
        })),
      );
      break;
    }
  }
  return signIns;
}

export async function readCredentials(provider: ProviderId, path: string): Promise<Credentials> {
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
  const expiresAt = provider === "claude" ? field(field(value, "claudeAiOauth"), "expiresAt") : null;
  return {
    accessToken,
    accountId: firstString(value, accountPaths),
    expires_at_epoch:
      typeof expiresAt === "number" && Number.isFinite(expiresAt) && expiresAt > 0
        ? Math.floor(expiresAt / 1000)
        : null,
    ...credentialIdentity(provider, value),
  };
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
