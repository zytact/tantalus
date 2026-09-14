import { describe, expect, it } from "vite-plus/test";
import { isNewer, parseManifest, verifySignature } from "./release";

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
});
