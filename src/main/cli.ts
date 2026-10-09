import { spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { posix, win32 } from "node:path";
import type { StartProviderId } from "../shared/window-start";

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

/** The CLI that starts the window of `provider`'s sign-in in `distribution`, or in this machine's own
 * home folder when that is null. Null when no CLI was found. */
export function startCli(
  provider: StartProviderId,
  configured: string | null,
  distribution: string | null,
): Cli | null {
  const host = { platform: process.platform, env: process.env, home: process.env.HOME || homedir(), exists: isProgram };
  return resolveCli(provider, configured, distribution, host);
}

/** On Windows, a sign-in inside a WSL distribution runs the CLI in that distribution, through a login
 * shell, which puts the user's own bin directories on the PATH. A configured POSIX path applies only
 * there, and a configured Windows path only to the Windows sign-in, which never runs through WSL. */
export function resolveCli(
  provider: StartProviderId,
  configured: string | null,
  distribution: string | null,
  host: Host,
): Cli | null {
  const windows = host.platform === "win32";
  const wslPath = windows && configured?.startsWith("/") ? configured : null;
  if (windows && distribution !== null) return inWsl(wslPath ?? provider, distribution, startArgs[provider]);
  const file = (wslPath === null ? configured : null) ?? findOnHost(provider, host);
  if (file === null) return null;
  const shell = host.platform === "win32" && /\.(cmd|bat)$/i.test(file);
  const quote = (value: string) => (shell ? `"${value}"` : value);
  return { file: quote(file), args: startArgs[provider].map(quote), shell, label: file };
}

function inWsl(program: string, distribution: string, args: string[]): Cli {
  return {
    file: "wsl.exe",
    args: [
      "-d",
      distribution,
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
    label: `${program} in WSL (${distribution})`,
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
