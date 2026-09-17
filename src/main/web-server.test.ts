import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { emptyProviderUsage } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { trustedHost, WebServer } from "./web-server";

const PORT = 47_470;
const origin = `http://127.0.0.1:${PORT}`;

const snapshot = (claude: boolean): UsageSnapshot => ({
  codex: emptyProviderUsage(),
  claude: emptyProviderUsage(),
  opencode: emptyProviderUsage(),
  enabled: { codex: true, claude, opencode: false },
  proxy_hubs: [],
});

let root: string;
let server: WebServer;
let current: UsageSnapshot;
let refreshes: number;

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-web-"));
  root = join(directory, "dist");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<main></main>");
  writeFileSync(join(directory, "secret.txt"), "outside the page");
  current = snapshot(true);
  refreshes = 0;
  server = new WebServer(
    root,
    PORT,
    () => current,
    async () => {
      refreshes += 1;
      current = snapshot(false);
      return current;
    },
    () => 1_234_567,
  );
  await server.listen("127.0.0.1");
});

afterAll(async () => {
  await server.listen(null);
  rmSync(join(root, ".."), { recursive: true, force: true });
});

describe("web server", () => {
  it("serves the page and nothing outside it", async () => {
    const page = await fetch(`${origin}/`);
    expect(page.headers.get("content-type")).toContain("text/html");
    expect(await page.text()).toBe("<main></main>");
    expect((await fetch(`${origin}/%2e%2e/secret.txt`)).status).toBe(404);
    expect((await fetch(`${origin}/`, { method: "POST" })).status).toBe(405);
  });

  it("serves the current snapshot and nothing else the window can read", async () => {
    expect(await (await fetch(`${origin}/api/current/usageSnapshot`)).json()).toEqual(current);
    expect(await (await fetch(`${origin}/api/current/serverEpoch`)).json()).toBe(1_234_567);
    expect(await (await fetch(`${origin}/api/current/updateAvailable`)).json()).toBeNull();
  });

  it("refreshes usage only through POST", async () => {
    expect((await fetch(`${origin}/api/refresh`)).status).toBe(405);
    expect((await fetch(`${origin}/api/refresh`, { method: "POST" })).status).toBe(405);
    const response = await fetch(`${origin}/api/refresh`, {
      method: "POST",
      headers: { "x-tantalus-action": "refresh" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(snapshot(false));
    expect(refreshes).toBe(1);
  });

  it("streams the current snapshot, then each one published", async () => {
    const controller = new AbortController();
    const response = await fetch(`${origin}/api/events`, { signal: controller.signal });
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    const next = async () => JSON.parse((await reader.read()).value!.split("data: ")[1]!) as UsageSnapshot;
    expect(await next()).toEqual(current);
    server.publish(snapshot(false));
    expect((await next()).enabled.claude).toBe(false);
    controller.abort();
  });
});

describe("trusted hosts", () => {
  it("serves addresses, local names and tailnet names, but not a domain someone else controls", () => {
    for (const host of [
      "127.0.0.1:4747",
      "192.168.1.5:4747",
      "[::1]:4747",
      "fedora:4747",
      "fedora.local",
      "fedora.tail1.ts.net:8443",
    ]) {
      expect(trustedHost(host)).toBe(true);
    }
    for (const host of [undefined, "", "evil.example:4747", "127.0.0.1.evil.example", "ts.net.evil.example"]) {
      expect(trustedHost(host)).toBe(false);
    }
  });
});
