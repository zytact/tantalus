import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { posix, win32 } from "node:path";
import type { StartProviderId } from "../shared/window-start";
import { locateCredentials } from "./auth";

/** A program to spawn. An npm `.cmd` shim only runs through cmd.exe, so it goes through the shell with
 * every argument quoted. `label` names it for the user. */
export type Cli = { file: string; args: string[]; shell: boolean; label: string };

/** The machine a CLI is looked up on, passed in so the lookup can be tested for every platform. */
export type Host = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  home: string;
  exists: (path: string) => boolean;
};

/** A one-word prompt with as little loaded as each CLI allows: no MCP servers, user settings or saved
 * session. Claude runs its smallest model and Codex its lowest reasoning effort. */
const startArgs: Record<StartProviderId, string[]> = {
  claude: [
    "-p",
    "OK",
    "--model",
    "haiku",
    "--no-session-persistence",
    "--strict-mcp-config",
    "--setting-sources",
    "local",
  ],
  codex: [
    "exec",
    "--ephemeral",
    "--skip-git-repo-check",
    "--ignore-user-config",
    "--sandbox",
    "read-only",
    "--color",
    "never",
    "-c",
    "model_reasoning_effort=low",
    "OK",
  ],
};

const RUN_TIMEOUT = 120_000;

/** The CLI that starts `provider`'s window on this machine, or null when none was found. */
export async function startCli(provider: StartProviderId, configured: string | null): Promise<Cli | null> {
  // Only a Windows host can be signed in through WSL, so only there does the login's location matter.
  const credentialPath =
    process.platform === "win32"
      ? await locateCredentials(provider).then(
          ({ path }) => path,
          () => null,
        )
      : null;
  const host = { platform: process.platform, env: process.env, home: process.env.HOME || homedir(), exists: isProgram };
  return resolveCli(provider, configured, credentialPath, host);
}

/** On Windows, a login found inside WSL or a configured POSIX path runs the CLI in that distribution
 * through a login shell, which puts the user's own bin directories on the PATH. */
export function resolveCli(
  provider: StartProviderId,
  configured: string | null,
  credentialPath: string | null,
  host: Host,
): Cli | null {
  const distribution = credentialPath === null ? null : wslDistribution(credentialPath);
  if (host.platform === "win32" && (configured === null ? distribution !== null : configured.startsWith("/"))) {
    return inWsl(configured ?? provider, distribution, startArgs[provider]);
  }
  const file = configured ?? findOnHost(provider, host);
  if (file === null) return null;
  const shell = host.platform === "win32" && /\.(cmd|bat)$/i.test(file);
  const quote = (value: string) => (shell ? `"${value}"` : value);
  return { file: quote(file), args: startArgs[provider].map(quote), shell, label: file };
}

/** The distribution a path on the `\\wsl.localhost` or `\\wsl$` share belongs to. */
export function wslDistribution(path: string): string | null {
  return /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)\\/i.exec(path)?.[1] ?? null;
}

function inWsl(program: string, distribution: string | null, args: string[]): Cli {
  return {
    file: "wsl.exe",
    args: [
      ...(distribution ? ["-d", distribution] : []),
      "--cd",
      "/tmp",
      "--exec",
      "sh",
      "-lc",
      'directory=$(mktemp -d /tmp/tantalus-start.XXXXXX) || exit; trap \'rm -rf -- "$directory"\' 0; cd "$directory" || exit; "$0" "$@"',
      program,
      ...args,
    ],
    shell: false,
    label: `${program} in WSL${distribution ? ` (${distribution})` : ""}`,
  };
}

/** The PATH first, then where the official installers, Homebrew, npm and Bun put CLIs. A GUI app on
 * macOS gets a bare PATH, so the known directories are what find it there. */
function findOnHost(provider: StartProviderId, { platform, env, home, exists }: Host): string | null {
  const windows = platform === "win32";
  const path = windows ? win32 : posix;
  const names = windows ? [`${provider}.exe`, `${provider}.cmd`] : [provider];
  const known = windows
    ? [path.join(home, ".local", "bin"), ...(env.APPDATA ? [path.join(env.APPDATA, "npm")] : [])]
    : [
        path.join(home, ".local", "bin"),
        "/opt/homebrew/bin",
        "/usr/local/bin",
        path.join(home, ".npm-global", "bin"),
        path.join(home, ".bun", "bin"),
      ];
  const directories = [...(env.PATH ?? "").split(path.delimiter).filter(Boolean), ...known];
  return directories.flatMap((directory) => names.map((name) => path.join(directory, name))).find(exists) ?? null;
}

function isProgram(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Runs the CLI in the temporary directory, so no project's instructions load with it. Fails with the
 * last line it wrote to stderr. */
export function runCli({ file, args, shell, label }: Cli): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: tmpdir(),
      shell,
      windowsHide: true,
      timeout: RUN_TIMEOUT,
      stdio: ["ignore", "ignore", "pipe"],
    });
    let output = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      output = (output + chunk).slice(-2000);
    });
    child.on("error", (error) => reject(new Error(`Could not run ${label}: ${error.message}`)));
    child.on("close", (code) => {
      if (code === 0) return resolve();
      const last = output.trim().split("\n").at(-1);
      reject(
        new Error(
          `${label} ${code === null ? "did not finish" : `exited with code ${code}`}${last ? `: ${last}` : ""}`,
        ),
      );
    });
  });
}
