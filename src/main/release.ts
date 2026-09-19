import { createPublicKey, verify } from "node:crypto";
import { blake2b } from "@noble/hashes/blake2.js";
import { field } from "./parse";

/** The Minisign key used by Tauri releases and by `scripts/sign-update.ts`. */
const PUBLIC_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQ4Q0M5ODY5MTI1MDVEQjgKUldTNFhWQVNhWmpNU0N5VXJlQVYxNGppUHZrZTJFVVFKZzcyQWxKY2xqVUJYOU5WTDVyVW41MkUK";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

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

export function verifySignature(data: Buffer, signature: string, publicKey = PUBLIC_KEY): boolean {
  try {
    const publicKeyLines = Buffer.from(publicKey, "base64").toString("utf8").trimEnd().split(/\r?\n/);
    const signatureLines = Buffer.from(signature, "base64").toString("utf8").trimEnd().split(/\r?\n/);
    if (publicKeyLines.length !== 2 || signatureLines.length !== 4) return false;

    const publicKeyPacket = Buffer.from(publicKeyLines[1], "base64");
    const signaturePacket = Buffer.from(signatureLines[1], "base64");
    const globalSignature = Buffer.from(signatureLines[3], "base64");
    if (
      publicKeyPacket.length !== 42 ||
      publicKeyPacket.subarray(0, 2).toString("ascii") !== "Ed" ||
      signaturePacket.length !== 74 ||
      signaturePacket.subarray(0, 2).toString("ascii") !== "ED" ||
      globalSignature.length !== 64 ||
      !signatureLines[2].startsWith("trusted comment: ") ||
      !publicKeyPacket.subarray(2, 10).equals(signaturePacket.subarray(2, 10))
    ) {
      return false;
    }

    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, publicKeyPacket.subarray(10)]),
      format: "der",
      type: "spki",
    });
    const releaseSignature = signaturePacket.subarray(10);
    const digest = Buffer.from(blake2b(data));
    const trustedComment = Buffer.from(signatureLines[2].slice("trusted comment: ".length));
    return (
      verify(null, digest, key, releaseSignature) &&
      verify(null, Buffer.concat([releaseSignature, trustedComment]), key, globalSignature)
    );
  } catch {
    return false;
  }
}
