import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Activity } from "../shared/pace";
import type { ProviderId } from "../shared/usage";
import { dataDirectory } from "./auth";

/** A session file that changed this recently means the provider is in use. It spans a few polls, so a
 * long tool call that writes nothing while it runs still counts. */
const LOOKBACK = 15 * 60 * 1000;

/** The files each CLI writes to as a session runs. Codex files each session under the local date it
 * started, Claude Code under the project it runs in, and Opencode keeps every session in one database. */
const sessionFiles: Record<ProviderId, (directory: string, now: number) => Promise<string[]>> = {
  codex: async (directory, now) => {
    const days = new Set([now - LOOKBACK, now].map(datePath));
    return (await Promise.all([...days].map((day) => filesIn(join(directory, "sessions", day))))).flat();
  },
  claude: async (directory) => {
    const projects = await entries(join(directory, "projects"), (entry) => entry.isDirectory());
    return (await Promise.all(projects.map(filesIn))).flat();
  },
  opencode: async (directory) => [join(directory, "opencode.db"), join(directory, "opencode.db-wal")],
};

/** Reads only modification times, never contents. A provider whose files cannot be found reads as not
 * in use, which keeps the tortoise away rather than showing one by mistake. */
export async function readActivity(now = Date.now()): Promise<Activity> {
  const active = async (provider: ProviderId) => {
    const files = await sessionFiles[provider](dataDirectory(provider), now);
    const changed = await Promise.all(
      files.map((file) =>
        stat(file).then(
          ({ mtimeMs }) => mtimeMs,
          () => 0,
        ),
      ),
    );
    const latest = changed.reduce((newest, time) => Math.max(newest, time), 0);
    return latest >= now - LOOKBACK ? Math.floor(latest / 1000) : null;
  };
  const [codex, claude, opencode] = await Promise.all([active("codex"), active("claude"), active("opencode")]);
  return { codex, claude, opencode };
}

const filesIn = (directory: string) => entries(directory, (entry) => entry.isFile());

async function entries(directory: string, keep: (entry: Dirent) => boolean): Promise<string[]> {
  const found = await readdir(directory, { withFileTypes: true }).catch(() => []);
  return found.filter(keep).map((entry) => join(directory, entry.name));
}

function datePath(milliseconds: number): string {
  const date = new Date(milliseconds);
  const pad = (value: number) => String(value).padStart(2, "0");
  return join(String(date.getFullYear()), pad(date.getMonth() + 1), pad(date.getDate()));
}
