import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import type { HostLink } from "../shared/ipc";
import { defaultPaceSettings } from "../shared/pace";
import { emptyProviderUsage } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { HostLinkClient, hostUrl } from "./host-link";
import type { TokenVault } from "./host-link";
import { Pairing } from "./pairing";
import { WebServer } from "./web-server";

const PORT = 47_480;
const origin = `http://127.0.0.1:${PORT}`;

const snapshot = (claude: boolean): UsageSnapshot => ({
  codex: emptyProviderUsage(),
  claude: emptyProviderUsage(),
  opencode: emptyProviderUsage(),
  enabled: { codex: true, claude, opencode: false },
  proxy_hubs: [],
  pace: { settings: defaultPaceSettings, windows: {} },
});

/** Encodes the token, so a test can tell a sealed token from the raw one. */
const vault: TokenVault = {
  seal: (token) => ({ sealed: Buffer.from(token).toString("hex") }),
  open: (token) => ("sealed" in token ? Buffer.from(token.sealed, "hex").toString() : token.plain),
};

let directory: string;
let pairing: Pairing;
let server: WebServer;
let current: UsageSnapshot;
let clients: HostLinkClient[];

/** A client that records what it shows, with retries a few milliseconds apart. */
function client() {
  const shown: UsageSnapshot[] = [];
  const links: (HostLink | null)[] = [];
  const link = new HostLinkClient({
    path: join(directory, "host-link.json"),
    vault,
    onSnapshot: (published) => shown.push(published),
    onChange: (changed) => links.push(changed),
    sleep: (_, signal) => new Promise((resolve) => (signal.aborted ? resolve() : setTimeout(resolve, 5))),
    now: () => 1_000,
  });
  clients.push(link);
  return { link, shown, links };
}

const offered = () => {
  pairing.offer();
  return pairing.read(new Set()).pairing!.code;
};

async function until(check: () => boolean) {
  for (let tries = 0; !check(); tries += 1) {
    if (tries > 200) throw new Error("Timed out.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "tantalus-link-"));
  const root = join(directory, "dist");
  mkdirSync(root);
  writeFileSync(join(root, "index.html"), "<main></main>");
  current = snapshot(true);
  clients = [];
  pairing = new Pairing(
    join(directory, "paired-devices.json"),
    () => {},
    () => {},
  );
  server = new WebServer({
    root,
    port: PORT,
    snapshot: () => current,
    refresh: async () => (current = snapshot(false)),
    pairing,
    onConnections: () => {},
  });
  await server.listen("127.0.0.1");
});

afterEach(async () => {
  for (const link of clients) link.disconnect();
  await server.listen(null);
  rmSync(directory, { recursive: true, force: true });
});

describe("host link", () => {
  it("pairs with an offered code, follows the host's usage and refreshes through it", async () => {
    const { link, shown } = client();
    const connected = await link.connect(`127.0.0.1:${PORT}`, offered());
    expect(connected).toMatchObject({ url: origin, state: "connecting", since: null });
    await until(() => link.read()?.state === "connected");
    expect(shown.at(-1)).toEqual(current);

    const saved = readFileSync(join(directory, "host-link.json"), "utf8");
    expect(saved).toContain("sealed");
    expect(pairing.read(new Set()).devices).toHaveLength(1);

    expect((await link.refresh()).enabled.claude).toBe(false);
    server.publish(snapshot(true));
    await until(() => shown.at(-1)?.enabled.claude === true);
  });

  it("refuses a wrong code and saves nothing", async () => {
    offered();
    const { link } = client();
    await expect(link.connect(origin, "WRONG1")).rejects.toThrow("That code is wrong or has expired.");
    expect(link.active).toBe(false);
    expect(() => readFileSync(join(directory, "host-link.json"))).toThrow();
  });

  it("keeps the last usage while the host is away and reconnects when it returns", async () => {
    const { link, shown } = client();
    await link.connect(origin, offered());
    await until(() => link.read()?.state === "connected");
    await server.listen(null);
    await until(() => link.read()?.state === "unreachable");
    expect(link.read()?.since).toBe(1_000);
    expect(link.snapshot).toEqual(shown.at(-1));

    await server.listen("127.0.0.1");
    await until(() => link.read()?.state === "connected");
    expect(link.read()?.since).toBeNull();
  });

  it("stops following once the host removes this device", async () => {
    const { link } = client();
    await link.connect(origin, offered());
    await until(() => link.read()?.state === "connected");
    const [device] = pairing.read(new Set()).devices;
    pairing.remove(device!.id);
    server.disconnect(device!.id);
    await until(() => link.read()?.state === "removed");
    expect(link.active).toBe(true);
  });

  it("follows the saved host after a restart, and forgets it on disconnect", async () => {
    const first = client();
    await first.link.connect(origin, offered());
    await until(() => first.link.read()?.state === "connected");
    first.link.disconnect();
    expect(first.links.at(-1)).toBeNull();

    const second = client();
    expect(second.link.active).toBe(false);
    await second.link.connect(origin, offered());
    const restarted = client();
    restarted.link.start();
    await until(() => restarted.link.read()?.state === "connected");
  });
});

describe("protocol", () => {
  it("names the side to update when the host speaks another protocol", async () => {
    for (const [body, message] of [
      [{ protocol: 2, name: "fedora" }, "Update Tantalus on this device to connect to fedora."],
      [{ protocol: 0, name: "fedora" }, "Update Tantalus on fedora."],
      [null, "Update Tantalus on the host at http://127.0.0.1:47481."],
    ] as const) {
      const host = createServer((_, response) => response.end(JSON.stringify(body)));
      await new Promise<void>((resolve) => host.listen(47_481, "127.0.0.1", resolve));
      const { link } = client();
      await expect(link.connect("127.0.0.1:47481", "ABCDEF")).rejects.toThrow(message);
      await new Promise((resolve) => host.close(resolve));
    }
  });

  it("reads an address as typed", () => {
    expect(hostUrl(" 192.168.1.5:4747 ")).toBe("http://192.168.1.5:4747");
    expect(hostUrl("https://fedora.tail1.ts.net:8443/")).toBe("https://fedora.tail1.ts.net:8443");
    expect(() => hostUrl("ftp://fedora")).toThrow("not an address");
    expect(() => hostUrl("")).toThrow("not an address");
  });
});
