import { createPublicKey, verify } from "node:crypto";
import { field } from "./parse";

/** The key `scripts/sign-update.ts` signs releases with, from the `UPDATE_SIGNING_KEY` secret. */
const PUBLIC_KEY = createPublicKey(
  "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAPnuyITCysHmJF6y3/m9b9LutJ9rk6B0o3TL3DX0C8+o=\n-----END PUBLIC KEY-----",
);

export type ReleaseAsset = { url: string; signature: string };
export type Manifest = { version: string; platforms: Record<string, ReleaseAsset> };

export function parseManifest(value: unknown): Manifest {
  const version = field(value, "version");
  const platforms = field(value, "platforms");
  if (typeof version !== "string" || typeof platforms !== "object" || platforms === null) {
    throw new Error("the release manifest is malformed");
  }
  const assets: Record<string, ReleaseAsset> = {};
  for (const [key, asset] of Object.entries(platforms)) {
    const url = field(asset, "url");
    const signature = field(asset, "signature");
    if (typeof url === "string" && typeof signature === "string") assets[key] = { url, signature };
  }
  return { version, platforms: assets };
}

/** Releases are plain `major.minor.patch`. */
export function isNewer(candidate: string, current: string): boolean {
  const [a, b] = [candidate, current].map((version) => version.split(".").map(Number));
  for (let index = 0; index < 3; index++) {
    if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) > (b[index] ?? 0);
  }
  return false;
}

export function verifySignature(data: Buffer, signature: string, key = PUBLIC_KEY): boolean {
  return verify(null, data, key, Buffer.from(signature, "base64"));
}
