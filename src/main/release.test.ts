import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { build } from "vite";
import { describe, expect, it } from "vite-plus/test";
import { isNewer, parseManifest, verifySignature } from "./release";

const run = promisify(execFile);
const electronPackage = dirname(createRequire(import.meta.url).resolve("electron"));
const electronPath = join(electronPackage, "dist", readFileSync(join(electronPackage, "path.txt"), "utf8").trim());

const PUBLIC_KEY =
  "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDYxOERERkY3RTE3NTdDRTkKUldUcGZIWGg5OStOWVhnQnM3elBNOU00TTlXZW5IS2dzUExHb3dZS1VPY0IxU3JDZ21wKzh3QlMK";
const SIGNATURE =
  "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUcGZIWGg5OStOWVFTL1EzaGUvdWpQSUhrN3BSdmFpSXRSYXM5UHhTcmhCNkRxSzhFK1liM0ZhYlZYZjFwcE5zTUtNSFMwTC9wbEpsd1RwV1U3YlloZ2dBSGxwMjl5a2c0PQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5NDA0ODMzCWZpbGU6YnVuZGxlCnFZVXp0MnJWdkZxS0ozdUVqMG90czRnQlMrMVllMkp1MHFGRzNBeVo1T2FkaEV5dldjWU4wWXlTQkc5YTlHeEJFUFYyK2xVUnU2cFM3cGhZN0h4YkFRPT0K";

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
    const data = Buffer.from("release bundle");
    expect(verifySignature(data, SIGNATURE, PUBLIC_KEY)).toBe(true);
    expect(verifySignature(Buffer.from("tampered"), SIGNATURE, PUBLIC_KEY)).toBe(false);
    expect(verifySignature(data, SIGNATURE)).toBe(false);

    const lines = Buffer.from(SIGNATURE, "base64").toString("utf8").split("\n");
    lines[2] += " changed";
    expect(verifySignature(data, Buffer.from(lines.join("\n")).toString("base64"), PUBLIC_KEY)).toBe(false);
  });

  it("verifies signatures in Electron's runtime", async () => {
    const directory = await mkdtemp(join(tmpdir(), "tantalus-signature-test-"));
    try {
      await build({
        configFile: false,
        logLevel: "silent",
        ssr: { noExternal: true },
        build: {
          ssr: join(import.meta.dirname, "release.ts"),
          outDir: directory,
          emptyOutDir: true,
          rollupOptions: { output: { entryFileNames: "release.mjs" } },
        },
      });
      const script =
        'const { verifySignature } = await import(process.argv[1]); console.log(verifySignature(Buffer.from("release bundle"), process.argv[2], process.argv[3]));';
      const { stdout } = await run(
        electronPath,
        [
          "--input-type=module",
          "--eval",
          script,
          pathToFileURL(join(directory, "release.mjs")).href,
          SIGNATURE,
          PUBLIC_KEY,
        ],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
      );
      expect(stdout.trim()).toBe("true");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
