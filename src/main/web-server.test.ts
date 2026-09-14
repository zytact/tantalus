import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { emptyProviderUsage } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { WebServer } from "./web-server";

const PORT = 47_470;
const origin = `http://127.0.0.1:${PORT}`;

const snapshot = (claude: boolean): UsageSnapshot => ({
  codex: emptyProviderUsage(),
  claude: emptyProviderUsage(),
  opencode: emptyProviderUsage(),
  enabled: { codex: true, claude, opencode: false },
});

let root: string;
let server: WebServer;
let current: UsageSnapshot;

beforeAll(async () => {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-web-"));
  root = join(directory, "dist");
  mkdirSync(join(root, "assets"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<main></main>");
  writeFileSync(join(directory, "secret.txt"), "outside the page");
  current = snapshot(true);
  server = new WebServer(root, PORT, () => current);
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
    expect(await (await fetch(`${origin}/api/current/updateAvailable`)).json()).toBeNull();
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
