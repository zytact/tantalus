import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeSync } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import type { PairedDevice, RemoteSettings } from "../shared/ipc";
import { defaultPaceSettings, isPacePreset } from "../shared/pace";
import type { PaceLog, PaceSample, PaceSettings, PaceTick } from "../shared/pace";
import { noTrayUsage } from "../shared/tray-usage";
import type { TrayUsageSettings } from "../shared/tray-usage";
import type { ProviderSettings, ProxyHubConfig, ProxyHubProviderId } from "../shared/usage";
import type { StartProviderSettings, WindowStartSettings } from "../shared/window-start";
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

/** A paired device as the host saves it. Only a hash of the token is kept. */
export type StoredDevice = Omit<PairedDevice, "connected"> & { tokenHash: string };

/** An unreadable file pairs nothing, so every device has to pair again rather than a stranger getting in. */
export function loadDevices(path: string): StoredDevice[] {
  return load(path, [], [], (value) => {
    if (!Array.isArray(value)) return null;
    const devices = value.map(storedDevice);
    return devices.every((device) => device !== null) ? devices : null;
  });
}

function storedDevice(value: unknown): StoredDevice | null {
  const id = field(value, "id");
  const name = field(value, "name");
  const tokenHash = field(value, "tokenHash");
  const pairedAt = field(value, "pairedAt");
  const lastSeenAt = field(value, "lastSeenAt");
  return typeof id === "string" &&
    typeof name === "string" &&
    typeof tokenHash === "string" &&
    typeof pairedAt === "number" &&
    (lastSeenAt === null || typeof lastSeenAt === "number")
    ? { id, name, tokenHash, pairedAt, lastSeenAt }
    : null;
}

/** The host a client follows. The token is sealed by the operating system's keychain where there is
 * one, and kept as is where there is not. */
export type SavedHostLink = { url: string; host: string; token: { sealed: string } | { plain: string } };

export function loadHostLink(path: string): SavedHostLink | null {
  return load<SavedHostLink | null>(path, null, null, (value) => {
    const url = field(value, "url");
    const host = field(value, "host");
    const token = field(value, "token");
    const sealed = field(token, "sealed");
    const plain = field(token, "plain");
    if (typeof url !== "string" || !httpUrl(url) || typeof host !== "string") return null;
    if (typeof sealed === "string") return { url, host, token: { sealed } };
    return typeof plain === "string" ? { url, host, token: { plain } } : null;
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

export function loadTrayUsageSettings(path: string): TrayUsageSettings {
  return load(path, noTrayUsage, noTrayUsage, trayUsageSettings);
}

/** The tray usage settings in a saved file or a request from the window, or null for anything else. */
export function trayUsageSettings(value: unknown): TrayUsageSettings | null {
  const enabled = field(value, "enabled");
  const source = field(value, "source");
  return typeof enabled === "boolean" && (source === null || typeof source === "string") ? { enabled, source } : null;
}

/** Nothing runs a CLI until someone switches it on. */
export const noWindowStarts: WindowStartSettings = {
  enabled: false,
  wake: false,
  providers: { claude: { path: null }, codex: { path: null } },
};

export function loadWindowStartSettings(path: string): WindowStartSettings {
  return load(path, noWindowStarts, noWindowStarts, windowStartSettings);
}

/** The window start settings in a saved file or a request from the window, or null for anything else.
 * A blank path means the CLI is looked up. */
export function windowStartSettings(value: unknown): WindowStartSettings | null {
  const enabled = field(value, "enabled");
  const wake = field(value, "wake") ?? false;
  const providers = field(value, "providers");
  const claude = startProvider(field(providers, "claude"));
  const codex = startProvider(field(providers, "codex"));
  return typeof enabled === "boolean" && typeof wake === "boolean" && claude && codex
    ? { enabled, wake, providers: { claude, codex } }
    : null;
}

function startProvider(value: unknown): StartProviderSettings | null {
  const path = field(value, "path");
  if (path !== null && typeof path !== "string") return null;
  return { path: path?.trim() || null };
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
      providers: hubProviders(field(value, "providers")),
    };
  } catch {
    return null;
  }
}

/** Unknown entries are dropped rather than failing the file, so a hub saved by a newer version is kept.
 * The next ready read records the roster again. */
function hubProviders(value: unknown): ProxyHubConfig["providers"] {
  if (!Array.isArray(value)) return undefined;
  return value.filter(
    (provider: unknown): provider is ProxyHubProviderId => provider === "claude" || provider === "codex",
  );
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

/** Saves the way `saveSettings` does without blocking the main process, for a file written on every
 * refresh. Callers must not start a write to the same path before the previous one settles. */
export async function saveSettingsInBackground<T>(path: string, settings: T) {
  const directory = dirname(path);
  const temporary = `${path}.${process.pid}.tmp`;
  const text = JSON.stringify(settings);
  await mkdir(directory, { recursive: true });
  try {
    const file = await open(temporary, "w", 0o600);
    try {
      await file.writeFile(text);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
  if (process.platform !== "win32") {
    try {
      const handle = await open(directory, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    } catch {}
  }
}
