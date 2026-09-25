import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import type { RemoteSettings } from "../shared/ipc";
import { defaultPaceSettings, isPacePreset } from "../shared/pace";
import type { PaceLog, PaceSample, PaceSettings, PaceTick } from "../shared/pace";
import type { ProviderSettings, ProxyHubConfig } from "../shared/usage";
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

export function loadPaceSettings(path: string): PaceSettings {
  return load(path, defaultPaceSettings, defaultPaceSettings, paceSettings);
}

/** The pace settings in a saved file or a request from the window, or null for anything else. */
export function paceSettings(value: unknown): PaceSettings | null {
  const enabled = field(value, "enabled");
  const preset = field(value, "preset");
  const explained = field(value, "explained");
  return typeof enabled === "boolean" && typeof explained === "boolean" && isPacePreset(preset)
    ? { enabled, preset, explained }
    : null;
}

/** A log that does not parse starts over, which only costs the time it takes to learn again. */
export function loadPaceLogs(path: string): Record<string, PaceLog> {
  return load(path, {}, {}, (value) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const logs = Object.entries(value).map(([key, log]) => [key, paceLog(log)] as const);
    return logs.every((entry): entry is readonly [string, PaceLog] => entry[1] !== null)
      ? Object.fromEntries(logs)
      : null;
  });
}

function paceLog(value: unknown): PaceLog | null {
  const firstSeen = field(value, "firstSeen");
  const last = paceSample(field(value, "last"));
  const readings = field(value, "readings");
  const stretch = field(value, "stretch");
  if (typeof firstSeen !== "number" || !last || !numbers(readings)) return null;
  if (stretch === null) return { firstSeen, last, readings, stretch: null };
  const parsed = paceStretch(stretch);
  return parsed && { firstSeen, last, readings, stretch: parsed };
}

function paceStretch(value: unknown): PaceLog["stretch"] {
  const ticks = field(value, "ticks");
  const pending = field(value, "pending");
  const activeAt = field(value, "activeAt");
  if (!Array.isArray(ticks) || ticks.length === 0 || typeof pending !== "number") return null;
  const parsed = ticks.map(paceTick);
  if (!parsed.every((tick) => tick !== null)) return null;
  return activeAt === null || typeof activeAt === "number" ? { ticks: parsed, pending, activeAt } : null;
}

function paceTick(value: unknown): PaceTick | null {
  const epoch = field(value, "epoch");
  const used = field(value, "used");
  return typeof epoch === "number" && typeof used === "number" ? { epoch, used } : null;
}

function paceSample(value: unknown): PaceSample | null {
  const tick = paceTick(value);
  const resetAt = field(value, "resetAt");
  return tick && (resetAt === null || typeof resetAt === "number") ? { ...tick, resetAt } : null;
}

const numbers = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === "number");

export function loadProxyHubSettings(path: string): ProxyHubConfig[] {
  return load(path, [], [], (value) => {
    if (!Array.isArray(value)) return null;
    const hubs = value.map(proxyHubConfig);
    return hubs.every((hub) => hub !== null) ? hubs : null;
  });
}

function proxyHubConfig(value: unknown): ProxyHubConfig | null {
  try {
    return {
      id: requiredString(value, "id"),
      label: requiredString(value, "label"),
      url: requiredHttpUrl(value, "url"),
      managementKey: requiredString(value, "managementKey"),
      enabled: requiredBoolean(value, "enabled"),
    };
  } catch {
    return null;
  }
}

function requiredString(value: unknown, key: string): string {
  const found = field(value, key);
  if (typeof found !== "string" || found.length === 0) throw new Error(`Invalid ${key}.`);
  return found;
}

function requiredHttpUrl(value: unknown, key: string): string {
  const found = requiredString(value, key);
  if (!httpUrl(found)) throw new Error(`Invalid ${key}.`);
  return found;
}

function requiredBoolean(value: unknown, key: string): boolean {
  const found = field(value, key);
  if (typeof found !== "boolean") throw new Error(`Invalid ${key}.`);
  return found;
}

export function httpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
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
export function saveSettings<T>(path: string, settings: T) {
  const directory = dirname(path);
  const temporary = `${path}.${process.pid}.tmp`;
  mkdirSync(directory, { recursive: true });
  try {
    const file = openSync(temporary, "w", 0o600);
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
