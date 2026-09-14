import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vite-plus/test";
import { isNewer, parseManifest, verifySignature } from "./release";

describe("release manifest", () => {
  it("keeps the platforms that name both a download and a signature", () => {
    expect(
      parseManifest({
        version: "0.1.0",
        platforms: { "windows-x86_64": { url: "https://x/setup.exe", signature: "c2ln" }, "linux-x86_64-deb": {} },
      }),
    ).toEqual({ version: "0.1.0", platforms: { "windows-x86_64": { url: "https://x/setup.exe", signature: "c2ln" } } });
    expect(() => parseManifest({ platforms: {} })).toThrow();
  });

  it("offers only a later version", () => {
    expect(isNewer("0.0.14", "0.0.13")).toBe(true);
    expect(isNewer("0.1.0", "0.0.99")).toBe(true);
    expect(isNewer("0.0.13", "0.0.13")).toBe(false);
    expect(isNewer("0.0.9", "0.0.13")).toBe(false);
  });

  it("accepts only a download signed with the release key", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const data = Buffer.from("installer");
    const signature = sign(null, data, privateKey).toString("base64");
    expect(verifySignature(data, signature, publicKey)).toBe(true);
    expect(verifySignature(Buffer.from("tampered"), signature, publicKey)).toBe(false);
    expect(verifySignature(data, signature)).toBe(false);
  });
});
