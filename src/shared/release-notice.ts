import type { ReleaseNotice } from "./ipc";
import { isNewer, validVersion } from "./version.ts";

const isPlatform = (value: unknown): value is "linux" | "darwin" | "win32" =>
  value === "linux" || value === "darwin" || value === "win32";

export function parseReleaseNotices(value: unknown): ReleaseNotice[] {
  if (!Array.isArray(value)) throw new Error("the release notices are malformed");
  return value.map(parseReleaseNotice);
}

function parseReleaseNotice(value: unknown): ReleaseNotice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("the release notices are malformed");
  }
  const entry = value as Record<string, unknown>;
  const id = requiredString(entry.id);
  const message = requiredString(entry.message);
  const fromVersion = requiredVersion(entry.fromVersion);
  const throughVersion = requiredVersion(entry.throughVersion);
  if (isNewer(fromVersion, throughVersion)) throw new Error("the release notices are malformed");
  const platforms = parsePlatforms(entry.platforms);
  return { id, message, fromVersion, throughVersion, ...(platforms === undefined ? {} : { platforms }) };
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) throw new Error("the release notices are malformed");
  return value;
}

function requiredVersion(value: unknown): string {
  const version = requiredString(value);
  if (!validVersion(version)) throw new Error("the release notices are malformed");
  return version;
}

function parsePlatforms(value: unknown): ReleaseNotice["platforms"] {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || !value.every(isPlatform)) throw new Error("the release notices are malformed");
  return value;
}
