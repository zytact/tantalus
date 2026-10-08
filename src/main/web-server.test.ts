import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { defaultPaceSettings } from "../shared/pace";
import { emptyProviderUsage } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { Pairing } from "./pairing";
import { deviceName, trustedHost, WebServer } from "./web-server";

const PORT = 47_470;
const origin = `http://127.0.0.1:${PORT}`;

const snapshot = (claude: boolean): UsageSnapshot => ({
  codex: emptyProviderUsage(),
  claude: emptyProviderUsage(),
  opencode: emptyProviderUsage(),
  enabled: { codex: true, claude, opencode: false },
  proxy_hubs: [],
  pace: { settings: defaultPaceSettings, windows: {} },
});

let root: string;
let server: WebServer;
let current: UsageSnapshot;
let refreshes: number;
/** Holds a refresh open until resolved, when set. */
let gate: Promise<void> | null = null;
let pairing: Pairing;
let cookie: string;

/** Pairs a browser through the server and returns its cookie. */
async function pair(): Promise<string> {
  pairing.offer();
  const { code } = pairing.read(new Set()).pairing!;
  const response = await fetch(`${origin}/api/pair`, {
    method: "POST",
    headers: { "x-tantalus-action": "pair", "user-agent": "Mozilla/5.0 (iPhone) Safari/604.1" },
    body: JSON.stringify({ code }),
  });
  expect(response.status).toBe(204);
  const header = response.headers.get("set-cookie")!;
  expect(header).toContain("HttpOnly");
  expect(header).toContain("SameSite=Strict");
  return header.split(";")[0]!;
}

const paired = (path: string, init: { method?: string; headers?: Record<string, string> } = {}) =>
  fetch(`${origin}${path}`, { ...init, headers: { ...init.headers, cookie } });

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-web-"));
  root = join(directory, "dist");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<main></main>");
  writeFileSync(join(directory, "secret.txt"), "outside the page");
  current = snapshot(true);
  refreshes = 0;
  pairing = new Pairing(
    join(directory, "paired-devices.json"),
    () => {},
    () => {},
  );
  server = new WebServer({
    root,
    port: PORT,
    snapshot: () => current,
    refresh: async () => {
      await gate;
      refreshes += 1;
      current = snapshot(false);
      return current;
    },
    pairing,
    onConnections: () => {},
    now: () => 1_234_567,
  });
  await server.listen("127.0.0.1");
  cookie = await pair();
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

  it("serves usage only to a paired device", async () => {
    for (const path of ["/api/current/usageSnapshot", "/api/current/serverEpoch", "/api/events"]) {
      expect((await fetch(`${origin}${path}`)).status).toBe(401);
      expect((await fetch(`${origin}${path}`, { headers: { cookie: "tantalus-47470=forged" } })).status).toBe(401);
    }
    expect(
      (await fetch(`${origin}/api/refresh`, { method: "POST", headers: { "x-tantalus-action": "refresh" } })).status,
    ).toBe(401);
  });

  it("names a browser after what it runs on and refuses a wrong code", async () => {
    expect(pairing.read(new Set()).devices[0]!.name).toBe("Safari on iPhone");
    pairing.offer();
    const response = await fetch(`${origin}/api/pair`, {
      method: "POST",
      headers: { "x-tantalus-action": "pair" },
      body: JSON.stringify({ code: "WRONG1" }),
    });
    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await fetch(`${origin}/api/pair`, { method: "POST" })).status).toBe(405);
    pairing.cancel();
  });

  it("serves the current snapshot and nothing else the window can read", async () => {
    expect(await (await paired("/api/current/usageSnapshot")).json()).toEqual(current);
    expect(await (await paired("/api/current/serverEpoch")).json()).toBe(1_234_567);
    expect(await (await paired("/api/current/updateAvailable")).json()).toBeNull();
  });

  it("refreshes usage only through POST", async () => {
    expect((await paired("/api/refresh")).status).toBe(405);
    expect((await paired("/api/refresh", { method: "POST" })).status).toBe(405);
    const response = await paired("/api/refresh", {
      method: "POST",
      headers: { "x-tantalus-action": "refresh" },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(snapshot(false));
    expect(refreshes).toBe(1);
  });

  it("refuses a refresh whose device was removed while it ran", async () => {
    let open = () => {};
    gate = new Promise((resolve) => (open = resolve));
    const other = await pair();
    const pending = fetch(`${origin}/api/refresh`, {
      method: "POST",
      headers: { cookie: other, "x-tantalus-action": "refresh" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const device = pairing.read(new Set()).devices.at(-1)!;
    pairing.remove(device.id);
    open();
    gate = null;
    expect((await pending).status).toBe(401);
  });

  it("streams the current snapshot, then each one published, until the device is removed", async () => {
    const response = await paired("/api/events");
    const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
    const next = async () => JSON.parse((await reader.read()).value!.split("data: ")[1]!) as UsageSnapshot;
    expect(await next()).toEqual(current);
    server.publish(snapshot(false));
    expect((await next()).enabled.claude).toBe(false);

    const [device] = [...server.connected()];
    pairing.remove(device!);
    server.disconnect(device!);
    expect((await reader.read()).done).toBe(true);
    expect(server.connected().size).toBe(0);
    expect((await paired("/api/current/usageSnapshot")).status).toBe(401);
  });
});

describe("device names", () => {
  it("names the browser and the system it runs on", () => {
    const chromeOnAndroid =
      "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
    expect(deviceName(chromeOnAndroid)).toBe("Chrome on Android");
    expect(deviceName("Mozilla/5.0 (Windows NT 10.0) Chrome/130.0 Safari/537.36 Edg/130.0")).toBe("Edge on Windows");
    expect(deviceName(undefined)).toBe("Browser");
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
