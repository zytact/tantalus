import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { ProviderSettings } from "../shared/usage";
import { field } from "./parse";

/** Opencode is a separate paid plan, so it stays off until someone switches it on. */
export const defaultSettings: ProviderSettings = { codex: true, claude: true, opencode: false };
/** Every provider off, which is what an unreadable settings file falls back to. */
export const noProviders: ProviderSettings = { codex: false, claude: false, opencode: false };

export function loadSettings(path: string): ProviderSettings {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return defaultSettings;
    console.error(`Failed to read provider settings at ${path}:`, error);
    return noProviders;
  }
  try {
    const value: unknown = JSON.parse(text);
    const codex = field(value, "codex");
    const claude = field(value, "claude");
    // Opencode was added after the other two, so a file written by an earlier version leaves it out.
    const opencode = field(value, "opencode") ?? false;
    if (typeof codex === "boolean" && typeof claude === "boolean" && typeof opencode === "boolean") {
      return { codex, claude, opencode };
    }
  } catch {}
  console.error(`Failed to parse provider settings at ${path}`);
  return noProviders;
}

/** Writes through a synced temporary file and a rename, so a failed save leaves the previous file
 * whole. The write is synchronous, so no read or refresh can interleave with a provider switch. */
export function saveSettings(path: string, settings: ProviderSettings) {
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
    const handle = openSync(directory, "r");
    fsyncSync(handle);
    closeSync(handle);
  }
}
