import { readFile } from "node:fs/promises";
import { hostname } from "node:os";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { extname, join, sep } from "node:path";
import type { HostAction } from "../shared/host-link";
import { PROTOCOL } from "../shared/ipc";
import type { AvailableUpdate, HostEvents, HostHello, HostRoutes, InstallProgress, ReleaseNotes } from "../shared/ipc";
import type { UsageSnapshot } from "../shared/usage";
import { nowEpoch } from "../shared/usage";
import { field } from "./parse";
import type { Pairing } from "./pairing";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** The largest request body read. */
const BODY_BYTES = 1024;
/** Every open stream gets a comment this often, so a client notices a host that vanished without
 * closing the connection. */
export const PING_MILLISECONDS = 15_000;
/** A name another Tantalus sends is cut to this length. */
const DEVICE_NAME_LENGTH = 64;
/** A browser keeps its pairing until the host removes the device. */
const COOKIE_SECONDS = 10 * 365 * 24 * 60 * 60;

/** The host's updater, as a paired device drives it. */
export type HostUpdates = {
  available: () => AvailableUpdate | null;
  progress: () => InstallProgress | null;
  check: () => Promise<AvailableUpdate | null>;
  install: (acknowledgedNoticeIds: string[]) => Promise<void>;
  notes: () => Promise<ReleaseNotes[]>;
};

export type WebServerOptions = {
  root: string;
  port: number;
  /** The host ID `/api/version` reports. */
  id: string;
  snapshot: () => UsageSnapshot;
  refresh: () => Promise<UsageSnapshot>;
  /** Every address the page is served on, which a paired Tantalus falls back between. */
  routes: () => Promise<HostRoutes>;
  updates: HostUpdates;
  pairing: Pairing;
  /** Called when a device starts or stops following usage. */
  onConnections: () => void;
  now?: () => number;
};

/** A request the device got wrong, as opposed to work the host could not do. */
class BadRequest extends Error {}

/** Serves the built page to browsers on other devices: snapshots and the host's update over HTTP and
 * server-sent events, plus guarded actions to refresh usage and to check for and install that update.
 * The page itself is public, but everything else goes only to paired devices. */
export class WebServer {
  private server: Server | null = null;
  private host: string | null = null;
  /** Each open stream and the device it belongs to. */
  private readonly listeners = new Map<ServerResponse, string>();
  /** Browsers send cookies to every port on a host, so the name keeps a preview's apart from the release's. */
  private readonly cookie: string;
  private readonly now: () => number;
  private ping: NodeJS.Timeout | null = null;

  constructor(private readonly options: WebServerOptions) {
    this.cookie = `tantalus-${options.port}`;
    this.now = options.now ?? nowEpoch;
  }

  /** Listens on `host`, or stops when it is null. Moving to another host closes every open connection. */
  async listen(host: string | null) {
    if (host === this.host) return;
    await this.close();
    if (host === null) return;
    const server = createServer((request, response) => this.respond(request, response));
    await new Promise<void>((resolve, reject) => {
      server.once("error", (error) => {
        reject(
          "code" in error && error.code === "EADDRINUSE"
            ? new Error(`Port ${this.options.port} is already in use.`)
            : error,
        );
      });
      server.listen(this.options.port, host, resolve);
    });
    this.server = server;
    this.host = host;
    this.ping = setInterval(() => {
      for (const listener of this.listeners.keys()) listener.write(": ping\n\n");
    }, PING_MILLISECONDS);
  }

  publish<E extends keyof HostEvents>(name: E, payload: HostEvents[E]) {
    for (const listener of this.listeners.keys()) listener.write(event(name, payload));
  }

  /** The devices with a stream open. */
  connected(): ReadonlySet<string> {
    return new Set(this.listeners.values());
  }

  /** Ends every stream `device` has open. */
  disconnect(device: string) {
    for (const [listener, owner] of this.listeners) {
      if (owner !== device) continue;
      this.drop(listener);
      listener.end();
    }
  }

  private drop(listener: ServerResponse) {
    const device = this.listeners.get(listener);
    if (device === undefined) return;
    this.listeners.delete(listener);
    this.options.pairing.seen(device);
    this.options.onConnections();
  }

  private async close() {
    const server = this.server;
    this.server = null;
    this.host = null;
    if (this.ping) clearInterval(this.ping);
    this.ping = null;
    if (!server) return;
    for (const listener of this.listeners.keys()) this.drop(listener);
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }

  private respond(request: IncomingMessage, response: ServerResponse) {
    if (!trustedHost(request.headers.host)) return send(response, 403, "text/plain", "Forbidden");
    const path = pathname(request.url);
    if (path === "/api/version")
      return this.sendJson(response, { protocol: PROTOCOL, name: hostname(), id: this.options.id });
    if (path === "/api/pair") return this.routePair(request, response);
    if (path?.startsWith("/api/")) {
      const token = bearer(request.headers.authorization) ?? cookie(request.headers.cookie, this.cookie);
      const device = this.options.pairing.authorize(token);
      if (!device) return send(response, 401, "text/plain", "Pair this device first");
      return this.respondPaired(device, path, request, response);
    }
    if (request.method !== "GET") return send(response, 405, "text/plain", "Method not allowed");
    void this.sendFile(response, path);
  }

  /** What a paired device can do to the host, keyed by the path under `/api/` and the action header a
   * POST there must carry. */
  private readonly actions = new Map(
    Object.entries({
      refresh: () => this.options.refresh().catch(() => Promise.reject(new Error("Could not refresh"))),
      "check-update": () => this.options.updates.check(),
      update: (request) => this.install(request),
    } satisfies Record<HostAction, (request: IncomingMessage) => Promise<unknown>>),
  );

  private respondPaired(device: string, path: string, request: IncomingMessage, response: ServerResponse) {
    const name = path.slice("/api/".length);
    const run = this.actions.get(name);
    if (run) {
      if (!action(request, name)) return send(response, 405, "text/plain", "Method not allowed");
      return void this.answer(device, response, run(request));
    }
    if (request.method !== "GET") return send(response, 405, "text/plain", "Method not allowed");
    if (path === "/api/events") return this.stream(device, request, response);
    if (path === "/api/release-notes") return void this.answer(device, response, this.options.updates.notes());
    if (path === "/api/routes") {
      return void this.options.routes().then(
        (routes) => this.sendJson(response, routes),
        () => send(response, 500, "text/plain", "Could not read routes"),
      );
    }
    if (path.startsWith("/api/current/")) return this.sendCurrent(response, path);
    send(response, 404, "text/plain", "Not found");
  }

  /** Installs the update the host already found. The request names the notices the device's user
   * acknowledged and nothing else. A host that installs restarts before it can answer. */
  private async install(request: IncomingMessage) {
    const acknowledged = field(await jsonBody(request).catch(() => null), "acknowledgedNoticeIds");
    if (!Array.isArray(acknowledged) || !acknowledged.every((id) => typeof id === "string")) {
      throw new BadRequest("Bad request");
    }
    await this.options.updates.install(acknowledged);
  }

  /** Answers with what `work` resolves to, or with its error message for the device to show. A device
   * removed while it ran gets neither. */
  private async answer(device: string, response: ServerResponse, work: Promise<unknown>) {
    const [status, type, body] = await work.then(
      (value) => [200, "application/json", JSON.stringify(value ?? null)] as const,
      (error: unknown) =>
        [
          error instanceof BadRequest ? 400 : 500,
          "text/plain",
          error instanceof Error ? error.message : String(error),
        ] as const,
    );
    if (!this.options.pairing.holds(device)) return send(response, 401, "text/plain", "Pair this device first");
    send(response, status, type, body);
  }

  private routePair(request: IncomingMessage, response: ServerResponse) {
    const paired = action(request, "pair")
      ? this.pair(request, response)
      : action(request, "pair-app")
        ? this.pairApp(request, response)
        : null;
    if (!paired) return send(response, 405, "text/plain", "Method not allowed");
    void paired.catch(() => send(response, 500, "text/plain", "Could not pair"));
  }

  /** A matching code pairs the browser that sent it, which keeps the token as a cookie its scripts cannot read. */
  private async pair(request: IncomingMessage, response: ServerResponse) {
    const code = field(await jsonBody(request).catch(() => null), "code");
    const token =
      typeof code === "string" && this.options.pairing.pair(code, deviceName(request.headers["user-agent"]));
    if (!token) return send(response, 403, "text/plain", "That code is wrong or has expired.");
    response.writeHead(204, {
      "set-cookie": `${this.cookie}=${token}; Path=/; Max-Age=${COOKIE_SECONDS}; HttpOnly; SameSite=Strict`,
    });
    response.end();
  }

  /** Another Tantalus pairs under its own name and keeps the token itself. */
  private async pairApp(request: IncomingMessage, response: ServerResponse) {
    const body = await jsonBody(request).catch(() => null);
    const code = field(body, "code");
    const name = field(body, "name");
    if (typeof code !== "string" || typeof name !== "string" || !name.trim()) {
      return send(response, 400, "text/plain", "Bad request");
    }
    const token = this.options.pairing.pair(code, name.trim().slice(0, DEVICE_NAME_LENGTH));
    if (!token) return send(response, 403, "text/plain", "That code is wrong or has expired.");
    this.sendJson(response, { token });
  }

  private sendJson(response: ServerResponse, body: HostHello | HostRoutes | { token: string }) {
    send(response, 200, "application/json", JSON.stringify(body));
  }

  private sendCurrent(response: ServerResponse, path: string) {
    const current: Record<string, () => unknown> = {
      "/api/current/usageSnapshot": this.options.snapshot,
      "/api/current/serverEpoch": this.now,
      "/api/current/hostUpdate": this.options.updates.available,
      "/api/current/hostInstallProgress": this.options.updates.progress,
    };
    send(response, 200, "application/json", JSON.stringify(current[path]?.() ?? null));
  }

  /** The first events are the current snapshot and update, so a browser that reconnects misses nothing. */
  private stream(device: string, request: IncomingMessage, response: ServerResponse) {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(event("usageSnapshot", this.options.snapshot()));
    response.write(event("hostUpdate", this.options.updates.available()));
    response.write(event("hostInstallProgress", this.options.updates.progress()));
    this.listeners.set(response, device);
    this.options.onConnections();
    request.on("close", () => this.drop(response));
  }

  private async sendFile(response: ServerResponse, path: string | null) {
    const { root } = this.options;
    const file = join(root, path === "/" ? "index.html" : (path ?? ""));
    try {
      if (!file.startsWith(root + sep)) throw new Error("Outside the page.");
      send(response, 200, contentTypes[extname(file)] ?? "application/octet-stream", await readFile(file));
    } catch {
      send(response, 404, "text/plain", "Not found");
    }
  }
}

/** A website can point its own domain at this machine and read the page from the visitor's browser. It
 * cannot own an IP address, a single-label or `.local` name, or a Tailscale `ts.net` name, so those are
 * the only hosts served. */
export function trustedHost(header: string | undefined): boolean {
  if (!header) return false;
  let host: string;
  try {
    host = new URL(`http://${header}`).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  return isIP(host) !== 0 || !host.includes(".") || host.endsWith(".local") || host.endsWith(".ts.net");
}

/** A POST carrying the action header, which a page on another site cannot send without the host's consent. */
const action = (request: IncomingMessage, name: string) =>
  request.method === "POST" && request.headers["x-tantalus-action"] === name;

function bearer(header: string | undefined): string | null {
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null;
}

function cookie(header: string | undefined, name: string): string | null {
  for (const part of header?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  let body = "";
  for await (const chunk of request) {
    body += String(chunk);
    if (body.length > BODY_BYTES) throw new Error("Body too large.");
  }
  return JSON.parse(body);
}

const browsers: [string, RegExp][] = [
  ["Edge", /Edg(iOS)?\//],
  ["Firefox", /(Firefox|FxiOS)\//],
  ["Chrome", /(Chrome|CriOS)\//],
  ["Safari", /Safari\//],
];
const systems: [string, RegExp][] = [
  ["iPhone", /iPhone/],
  ["iPad", /iPad/],
  ["Android", /Android/],
  ["Windows", /Windows/],
  ["Mac", /Macintosh/],
  ["Linux", /Linux/],
];

/** Names a paired browser after what it runs on, such as "Safari on iPhone", until the host renames it.
 * Lists run most specific first, since Chrome also claims Safari and Android also claims Linux. */
export function deviceName(userAgent = ""): string {
  const first = (list: [string, RegExp][]) => list.find(([, pattern]) => pattern.test(userAgent))?.[0];
  const browser = first(browsers) ?? "Browser";
  const system = first(systems);
  return system ? `${browser} on ${system}` : browser;
}

/** The decoded path, or null when the request's is malformed. */
function pathname(url = "/"): string | null {
  try {
    return decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return null;
  }
}

const event = <E extends keyof HostEvents>(name: E, payload: HostEvents[E]) =>
  `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`;

function send(response: ServerResponse, status: number, type: string, body: string | Buffer) {
  response.writeHead(status, { "content-type": type, "x-content-type-options": "nosniff" });
  response.end(body);
}
