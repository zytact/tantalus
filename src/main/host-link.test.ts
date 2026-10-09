import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { connect, createServer as createTcpServer } from "node:net";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { PROTOCOL } from "../shared/ipc";
import type { HostLink } from "../shared/ipc";
import { defaultPaceSettings } from "../shared/pace";
import type { UsageSnapshot } from "../shared/usage";
import { HostLinkClient, hostUrl, mergedRoutes, routeKind } from "./host-link";
import type { TokenVault } from "./host-link";
import { Pairing } from "./pairing";
import { WebServer } from "./web-server";

const PORT = 47_480;
const origin = `http://127.0.0.1:${PORT}`;
const FORWARD_PORT = 47_482;
const forwarded = `http://127.0.0.1:${FORWARD_PORT}`;

const snapshot = (claude: boolean): UsageSnapshot => ({
  enabled: { codex: true, claude, opencode: false },
  sign_ins: null,
  accounts: [],
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
/** The addresses the host reports, or null while reading them fails. */
let reported: string[] | null;
/** How many times a client asked the host for its routes. */
let routeReads: number;

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

/** A second route to the host that a test can cut, the way Tailscale Serve forwards to it. */
async function forwarder() {
  const sockets = new Set<Socket>();
  const forward = createTcpServer((socket) => {
    const upstream = connect(PORT, "127.0.0.1");
    for (const end of [socket, upstream]) {
      sockets.add(end);
      end.on("close", () => sockets.delete(end));
      end.on("error", () => {});
    }
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise<void>((resolve) => forward.listen(FORWARD_PORT, "127.0.0.1", resolve));
  return async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => forward.close(resolve));
  };
}

/** Another Tantalus that records whether anyone sent it a token. */
async function impostor(port: number) {
  const tokens: string[] = [];
  const server = createServer((request, response) => {
    if (request.headers.authorization) tokens.push(request.headers.authorization);
    response.end(JSON.stringify({ protocol: PROTOCOL, name: "fedora", id: "someone-else" }));
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return { tokens, close: () => new Promise((resolve) => server.close(resolve)) };
}

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
  reported = [];
  routeReads = 0;
  pairing = new Pairing(
    join(directory, "paired-devices.json"),
    () => {},
    () => {},
  );
  server = new WebServer({
    root,
    port: PORT,
    id: "host-id",
    snapshot: () => current,
    refresh: async () => (current = snapshot(false)),
    routes: async () => {
      routeReads += 1;
      if (!reported) throw new Error("Tailscale did not answer.");
      return { urls: reported, complete: true };
    },
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
    expect(connected).toMatchObject({
      routes: [{ url: origin, kind: "localNetwork", found: false }],
      state: "connecting",
      since: null,
    });
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

  it("drops a pairing or refresh that finishes after a disconnect", async () => {
    const { link, shown } = client();
    const pairing = link.connect(origin, offered());
    link.disconnect();
    await expect(pairing).rejects.toThrow("Pairing was cancelled.");
    expect(link.active).toBe(false);

    await link.connect(origin, offered());
    await until(() => link.read()?.state === "connected");
    const refresh = link.refresh();
    link.disconnect();
    await expect(refresh).rejects.toThrow("Stopped following");
    expect(shown.at(-1)?.enabled.claude).toBe(true);
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

describe("routes", () => {
  it("falls back to a route the host reported, and moves back once the preferred one answers", async () => {
    let cut = await forwarder();
    reported = [origin];
    const { link } = client();
    await link.connect(forwarded, offered());
    await until(() => link.read()?.active === forwarded && link.read()!.routes.length === 2);
    expect(link.read()!.routes[1]).toEqual({ url: origin, kind: "localNetwork", found: true });

    await cut();
    await until(() => link.read()?.active === origin);
    expect(link.read()?.state).toBe("connected");

    cut = await forwarder();
    await until(() => link.read()?.active === forwarded);
    await cut();
  });

  it("takes a route without waiting on a hung one below it", async () => {
    const hung = createTcpServer(() => {});
    await new Promise<void>((resolve) => hung.listen(47_483, "127.0.0.1", resolve));
    const token = pairing.pair(offered(), "laptop");
    writeFileSync(
      join(directory, "host-link.json"),
      JSON.stringify({
        host: "fedora",
        id: "host-id",
        routes: [
          { url: origin, found: false },
          { url: "http://127.0.0.1:47483", found: true },
        ],
        token: { plain: token },
      }),
    );
    const { link } = client();
    link.start();
    // `until` gives up after about 2 seconds, well inside the 10 second request timeout.
    await until(() => link.read()?.active === origin);
    hung.close();
  });

  it("never sends the token to an address where another Tantalus answers", async () => {
    const other = await impostor(47_481);
    reported = ["http://127.0.0.1:47481"];
    const { link } = client();
    await link.connect(origin, offered());
    await until(() => link.read()?.routes.length === 2);
    await expect(link.addRoute("127.0.0.1:47481")).rejects.toThrow("already a route");
    await expect(link.addRoute(`localhost:${PORT}`)).resolves.toMatchObject({ routes: { length: 3 } });

    await server.listen(null);
    await until(() => link.read()?.state === "unreachable");
    expect(other.tokens).toEqual([]);
    await other.close();
  });

  it("refuses to add an address where another Tantalus answers", async () => {
    const other = await impostor(47_481);
    const { link } = client();
    await link.connect(origin, offered());
    await expect(link.addRoute("127.0.0.1:47481")).rejects.toThrow("another Tantalus, not");
    expect(other.tokens).toEqual([]);
    await other.close();
  });

  it("learns the host ID and routes for a link saved before routes", async () => {
    const token = pairing.pair(offered(), "laptop");
    writeFileSync(
      join(directory, "host-link.json"),
      JSON.stringify({ url: origin, host: "fedora", token: { plain: token } }),
    );
    reported = [forwarded];
    const { link } = client();
    link.start();
    await until(() => link.read()?.routes.length === 2);
    const saved = JSON.parse(readFileSync(join(directory, "host-link.json"), "utf8"));
    expect(saved).toMatchObject({
      id: "host-id",
      routes: [
        { url: origin, found: false },
        { url: forwarded, found: true },
      ],
    });
  });

  it("drops a found route a complete report leaves out, unless it is in use", () => {
    const routes = [
      { url: "http://192.168.1.5:4747", found: false },
      { url: "http://192.168.1.6:4747", found: true },
      { url: "http://192.168.1.7:4747", found: true },
    ];
    const report = { urls: ["http://192.168.1.8:4747"], complete: true };
    expect(mergedRoutes(routes, report, "http://192.168.1.7:4747")).toEqual([
      { url: "http://192.168.1.5:4747", found: false },
      { url: "http://192.168.1.7:4747", found: true },
      { url: "http://192.168.1.8:4747", found: true },
    ]);
    expect(mergedRoutes(routes, { ...report, complete: false }, "http://192.168.1.7:4747")).toEqual([
      ...routes,
      { url: "http://192.168.1.8:4747", found: true },
    ]);
  });

  it("keeps the routes it knows when the host cannot report them", async () => {
    reported = [forwarded];
    const first = client();
    await first.link.connect(origin, offered());
    await until(() => first.link.read()?.routes.length === 2);
    const saved = readFileSync(join(directory, "host-link.json"), "utf8");

    reported = null;
    const restarted = client();
    restarted.link.start();
    await until(() => routeReads === 2 && restarted.link.read()?.state === "connected");
    expect(readFileSync(join(directory, "host-link.json"), "utf8")).toBe(saved);
    expect(restarted.link.read()?.routes).toHaveLength(2);
  });

  it("refreshes through a route it reaches when no stream is open", async () => {
    const first = client();
    await first.link.connect(origin, offered());
    const restarted = client();
    restarted.link.start();
    expect((await restarted.link.refresh()).enabled.claude).toBe(false);
  });

  it("tells a Tailscale address from a local network one", () => {
    expect(routeKind("https://fedora.tail1.ts.net:8443")).toBe("tailscale");
    expect(routeKind("http://100.101.2.3:4747")).toBe("tailscale");
    expect(routeKind("http://100.20.2.3:4747")).toBe("localNetwork");
    expect(routeKind("http://192.168.1.5:4747")).toBe("localNetwork");
  });
});

describe("protocol", () => {
  it("names the side to update when the host speaks another protocol", async () => {
    for (const [body, message] of [
      [{ protocol: PROTOCOL + 1, name: "fedora" }, "Update Tantalus on this device to connect to fedora."],
      [{ protocol: PROTOCOL - 1, name: "fedora" }, "Update Tantalus on fedora."],
      [null, "Update Tantalus on the host at http://127.0.0.1:47481."],
    ] as const) {
      const host = createServer((_, response) => response.end(JSON.stringify(body)));
      await new Promise<void>((resolve) => host.listen(47_481, "127.0.0.1", resolve));
      const { link } = client();
      await expect(link.connect("127.0.0.1:47481", "ABCDEF")).rejects.toThrow(message);
      await new Promise((resolve) => host.close(resolve));
    }
  });

  it("reads a proxy's server error as an unreachable host", async () => {
    const proxy = createServer((_, response) => {
      response.writeHead(502);
      response.end();
    });
    await new Promise<void>((resolve) => proxy.listen(47_481, "127.0.0.1", resolve));
    writeFileSync(
      join(directory, "host-link.json"),
      JSON.stringify({ url: "http://127.0.0.1:47481", host: "fedora", token: { plain: "token" } }),
    );
    const { link } = client();
    link.start();
    await until(() => link.read()?.state === "unreachable");
    link.disconnect();
    await new Promise((resolve) => proxy.close(resolve));
  });

  it("reads an address as typed", () => {
    expect(hostUrl(" 192.168.1.5:4747 ")).toBe("http://192.168.1.5:4747");
    expect(hostUrl("https://fedora.tail1.ts.net:8443/")).toBe("https://fedora.tail1.ts.net:8443");
    expect(() => hostUrl("ftp://fedora")).toThrow("not an address");
    expect(() => hostUrl("")).toThrow("not an address");
  });
});
