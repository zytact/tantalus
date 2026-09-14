import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { RemoteSettings } from "../shared/ipc";
import type { ProviderSettings } from "../shared/usage";
import { field } from "./parse";

/** Opencode is a separate paid plan, so it stays off until someone switches it on. */
export const defaultSettings: ProviderSettings = { codex: true, claude: true, opencode: false };
/** Every provider off, which is what an unreadable settings file falls back to. */
export const noProviders: ProviderSettings = { codex: false, claude: false, opencode: false };
/** Nothing outside the app can reach the page until someone switches a route on. */
export const noRemoteAccess: RemoteSettings = { localNetwork: false, tailscale: false };

export function loadSettings(path: string): ProviderSettings {
  return load(path, defaultSettings, noProviders, (value) => {
    const codex = field(value, "codex");
    const claude = field(value, "claude");
    // Opencode was added after the other two, so a file written by an earlier version leaves it out.
    const opencode = field(value, "opencode") ?? false;
    return typeof codex === "boolean" && typeof claude === "boolean" && typeof opencode === "boolean"
      ? { codex, claude, opencode }
      : null;
  });
}

export function loadRemoteSettings(path: string): RemoteSettings {
  return load(path, noRemoteAccess, noRemoteAccess, (value) => {
    const localNetwork = field(value, "localNetwork");
    const tailscale = field(value, "tailscale");
    return typeof localNetwork === "boolean" && typeof tailscale === "boolean" ? { localNetwork, tailscale } : null;
  });
}

/** `missing` is what a file that does not exist yet reads as, and `invalid` what an unreadable or
 * malformed one falls back to. `parse` returns null for a value of the wrong shape. */
function load<T>(path: string, missing: T, invalid: T, parse: (value: unknown) => T | null): T {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return missing;
    console.error(`Failed to read settings at ${path}:`, error);
    return invalid;
  }
  try {
    const settings = parse(JSON.parse(text));
    if (settings) return settings;
  } catch {}
  console.error(`Failed to parse settings at ${path}`);
  return invalid;
}

/** Writes through a synced temporary file and a rename, so a failed save leaves the previous file
 * whole. The write is synchronous, so no read or refresh can interleave with a settings switch. */
export function saveSettings(path: string, settings: ProviderSettings | RemoteSettings) {
  const directory = dirname(path);
  const temporary = `${path}.${process.pid}.tmp`;
  mkdirSync(directory, { recursive: true });
  try {
    const file = openSync(temporary, "w");
    try {
      writeSync(file, JSON.stringify(settings));
      fsyncSync(file);
    } finally {
      closeSync(file);
    }
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  if (process.platform !== "win32") {
    try {
      const handle = openSync(directory, "r");
      try {
        fsyncSync(handle);
      } finally {
        closeSync(handle);
      }
    } catch {}
  }
}
