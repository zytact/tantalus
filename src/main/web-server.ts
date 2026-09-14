import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { extname, join, sep } from "node:path";
import type { UsageSnapshot } from "../shared/usage";

const contentTypes: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Serves the built page to browsers on other devices: snapshots over HTTP and server-sent events,
 * plus a guarded refresh action. */
export class WebServer {
  private server: Server | null = null;
  private host: string | null = null;
  private readonly listeners = new Set<ServerResponse>();

  constructor(
    private readonly root: string,
    private readonly port: number,
    private readonly snapshot: () => UsageSnapshot,
    private readonly refresh: () => Promise<UsageSnapshot>,
  ) {}

  /** Listens on `host`, or stops when it is null. Moving to another host closes every open connection. */
  async listen(host: string | null) {
    if (host === this.host) return;
    await this.close();
    if (host === null) return;
    const server = createServer((request, response) => this.respond(request, response));
    await new Promise<void>((resolve, reject) => {
      server.once("error", (error) => {
        reject(
          "code" in error && error.code === "EADDRINUSE" ? new Error(`Port ${this.port} is already in use.`) : error,
        );
      });
      server.listen(this.port, host, resolve);
    });
    this.server = server;
    this.host = host;
  }

  publish(snapshot: UsageSnapshot) {
    for (const listener of this.listeners) listener.write(event(snapshot));
  }

  private async close() {
    const server = this.server;
    this.server = null;
    this.host = null;
    if (!server) return;
    this.listeners.clear();
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
  }

  private respond(request: IncomingMessage, response: ServerResponse) {
    if (!trustedHost(request.headers.host)) return send(response, 403, "text/plain", "Forbidden");
    const path = pathname(request.url);
    if (path === "/api/refresh") {
      if (request.method !== "POST" || request.headers["x-tantalus-action"] !== "refresh") {
        return send(response, 405, "text/plain", "Method not allowed");
      }
      return void this.refresh().then(
        (snapshot) => send(response, 200, "application/json", JSON.stringify(snapshot)),
        () => send(response, 500, "text/plain", "Could not refresh"),
      );
    }
    if (request.method !== "GET") return send(response, 405, "text/plain", "Method not allowed");
    if (path === "/api/events") return this.stream(request, response);
    if (path?.startsWith("/api/current/")) {
      const value = path === "/api/current/usageSnapshot" ? this.snapshot() : null;
      return send(response, 200, "application/json", JSON.stringify(value));
    }
    void this.sendFile(response, path);
  }

  /** The first event is the current snapshot, so a browser that reconnects misses nothing. */
  private stream(request: IncomingMessage, response: ServerResponse) {
    response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
    response.write(event(this.snapshot()));
    this.listeners.add(response);
    request.on("close", () => this.listeners.delete(response));
  }

  private async sendFile(response: ServerResponse, path: string | null) {
    const file = join(this.root, path === "/" ? "index.html" : (path ?? ""));
    try {
      if (!file.startsWith(this.root + sep)) throw new Error("Outside the page.");
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

/** The decoded path, or null when the request's is malformed. */
function pathname(url = "/"): string | null {
  try {
    return decodeURIComponent(new URL(url, "http://localhost").pathname);
  } catch {
    return null;
  }
}

const event = (snapshot: UsageSnapshot) => `event: usageSnapshot\ndata: ${JSON.stringify(snapshot)}\n\n`;

function send(response: ServerResponse, status: number, type: string, body: string | Buffer) {
  response.writeHead(status, { "content-type": type, "x-content-type-options": "nosniff" });
  response.end(body);
}
