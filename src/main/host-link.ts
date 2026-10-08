import { rmSync } from "node:fs";
import { isIPv4 } from "node:net";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { hostLinkProblem } from "../shared/host-link";
import { PROTOCOL } from "../shared/ipc";
import type { HostHello, HostLink, HostLinkState, HostRoute, HostRoutes, RemoteRoute } from "../shared/ipc";
import { nowEpoch } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { field } from "./parse";
import { httpUrl, loadHostLink, saveSettings } from "./settings";
import type { SavedHostLink, SavedRoute } from "./settings";

/** The first wait after a dropped link, doubled on each failure up to the longest. */
const RETRY_FIRST_MILLISECONDS = 1000;
const RETRY_LONGEST_MILLISECONDS = 30_000;
/** A host pings every open stream every 15 seconds, so this much silence means the link is gone. */
const SILENCE_MILLISECONDS = 45_000;
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;
/** How often a link on a fallback route checks whether a preferred one answers again. */
const PREFERRED_PROBE_MILLISECONDS = 30_000;

/** Seals the token with the operating system's keychain where there is one. */
export type TokenVault = {
  seal: (token: string) => SavedHostLink["token"];
  open: (sealed: SavedHostLink["token"]) => string;
};

export type HostLinkOptions = {
  path: string;
  vault: TokenVault;
  /** Called with each snapshot the host publishes. */
  onSnapshot: (snapshot: UsageSnapshot) => void;
  /** Called whenever the link's state changes, with null once it is forgotten. */
  onChange: (link: HostLink | null) => void;
  sleep?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  now?: () => number;
};

/** `switched` means the stream ended because a preferred route answered again. */
type Outcome = "delivered" | "failed" | "switched";
/** `url` is the route the open stream runs over, or null between streams. */
type Session = { saved: SavedHostLink; stop: AbortController; url: string | null };

/** Thrown for a failure the user can act on, with the message Settings shows and the state it leaves
 * a followed link in. */
class LinkError extends Error {
  constructor(
    message: string,
    readonly state: HostLinkState = "unreachable",
  ) {
    super(message);
  }
}

/** Follows the usage of the host this machine is paired to, in place of reading its own. It keeps the
 * last snapshot through an outage and retries until the host answers or removes this device. */
export class HostLinkClient {
  /** The followed host. Each connection gets its own, so work a replaced or forgotten connection
   * started cannot change what the current one shows. */
  private session: Session | null = null;
  /** Counts connect attempts and disconnects, so a pairing that outlived either is dropped. */
  private attempt = 0;
  private link: HostLink | null = null;
  private latest: UsageSnapshot | null = null;
  private readonly sleep: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  private readonly now: () => number;
  /** The host to follow, saved or just paired. */
  private saved: SavedHostLink | null;

  constructor(private readonly options: HostLinkOptions) {
    this.saved = loadHostLink(options.path);
    this.sleep = options.sleep ?? abortableSleep;
    this.now = options.now ?? nowEpoch;
  }

  get active(): boolean {
    return this.saved !== null;
  }

  /** The last snapshot the host published, or null before the first arrives. */
  get snapshot(): UsageSnapshot | null {
    return this.latest;
  }

  read(): HostLink | null {
    return this.link;
  }

  /** Why the host's usage is not live, or null while it is or no host is followed. */
  problem(): string | null {
    return this.link && hostLinkProblem(this.link);
  }

  /** Follows the saved host, if there is one. */
  start() {
    if (this.saved && !this.session) this.follow(this.saved);
  }

  /** Pairs with the host at `address` using a code it offered, then follows it. A link already
   * followed is replaced only once the new one pairs. */
  async connect(address: string, code: string): Promise<HostLink> {
    const attempt = ++this.attempt;
    const url = hostUrl(address);
    const hello = await this.hello(url);
    const response = await request(`${url}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tantalus-action": "pair-app" },
      body: JSON.stringify({ code, name: hostname() }),
    }).catch(() => {
      throw new LinkError(`Could not reach ${hello.name}.`);
    });
    if (response.status === 403) throw new LinkError("That code is wrong or has expired.");
    const token = field(await response.json().catch(() => null), "token");
    if (!response.ok || typeof token !== "string") throw new LinkError(`${hello.name} could not pair this device.`);
    if (attempt !== this.attempt) throw new LinkError("Pairing was cancelled.");
    const saved: SavedHostLink = {
      host: hello.name,
      id: hello.id,
      routes: [{ url, found: false }],
      token: this.options.vault.seal(token),
    };
    saveSettings(this.options.path, saved);
    this.follow(saved);
    return this.link!;
  }

  /** Adds an address typed here, once it answers as the followed host. */
  async addRoute(address: string): Promise<HostLink> {
    const session = this.session;
    if (!session) throw new Error("Not following a host.");
    const url = hostUrl(address);
    const { host, id, routes } = session.saved;
    if (routes.some((route) => route.url === url)) throw new LinkError(`${url} is already a route.`);
    if (id === null) throw new LinkError(`Update Tantalus on ${host} to add routes.`);
    if ((await this.hello(url)).id !== id) throw new LinkError(`${url} is another Tantalus, not ${host}.`);
    if (session !== this.session) throw new LinkError(`Stopped following ${host}.`);
    this.save(session, { ...session.saved, routes: [...session.saved.routes, { url, found: false }] });
    return this.link!;
  }

  disconnect() {
    this.attempt += 1;
    this.session?.stop.abort();
    this.session = null;
    this.saved = null;
    rmSync(this.options.path, { force: true });
    this.latest = null;
    this.set(null);
  }

  /** Asks the host to refresh, and follows its answer like a published snapshot. */
  async refresh(): Promise<UsageSnapshot> {
    const session = this.session;
    if (!session) throw new Error("Not following a host.");
    const { saved } = session;
    const failed = new Error(`Could not refresh usage on ${saved.host}.`);
    const url = await this.routeFor(session);
    if (!url) throw failed;
    const response = await request(`${url}/api/refresh`, {
      method: "POST",
      headers: { ...this.authorization(saved), "x-tantalus-action": "refresh" },
    }).catch(() => null);
    if (response?.status === 401) this.removed(session);
    if (!response?.ok) throw failed;
    const snapshot: UsageSnapshot = await response.json();
    if (session !== this.session || session.stop.signal.aborted) throw new Error(`Stopped following ${saved.host}.`);
    this.publish(session, url, snapshot);
    return snapshot;
  }

  /** The route the open stream runs over, or between streams the one a stream would take. */
  private async routeFor(session: Session): Promise<string | null> {
    if (session.url) return session.url;
    const reached = await this.reach(session, preferred(session.saved.routes)).catch(() => null);
    return reached?.url ?? null;
  }

  private follow(saved: SavedHostLink) {
    this.session?.stop.abort();
    const session = { saved, stop: new AbortController(), url: null };
    this.session = session;
    this.saved = saved;
    this.latest = null;
    this.set({ host: saved.host, state: "connecting", since: null, routes: routeViews(saved.routes), active: null });
    void this.run(session);
  }

  /** Reconnects until stopped or removed, waiting longer after each failure in a row. */
  private async run(session: Session) {
    const { signal } = session.stop;
    let wait = RETRY_FIRST_MILLISECONDS;
    while (!signal.aborted) {
      const outcome = await this.listen(session);
      if (outcome === "switched") continue;
      if (outcome === "delivered") wait = RETRY_FIRST_MILLISECONDS;
      await this.sleep(wait, signal);
      wait = Math.min(wait * 2, RETRY_LONGEST_MILLISECONDS);
    }
  }

  /** Follows the host over the most preferred route that answers, for one stream. A stream that
   * delivered is not marked lost yet, since the next attempt may find another route at once. */
  private async listen(session: Session): Promise<Outcome> {
    let reached: Reached;
    try {
      reached = await this.reach(session, preferred(session.saved.routes));
    } catch (error) {
      this.lost(session, error instanceof LinkError ? error.state : "unreachable");
      return "failed";
    }
    session.url = reached.url;
    void this.learn(session, reached).catch((error: unknown) =>
      console.error("Could not save the host's routes:", error),
    );
    const outcome = await this.stream(session, reached.url);
    session.url = null;
    if (outcome === "failed") this.lost(session, "unreachable");
    return outcome;
  }

  /** The first of `routes` that answers as the followed host. Every route is asked at once, and one is
   * taken as soon as the routes ahead of it have failed, so a hung route below it costs nothing. One
   * that answers with another host ID is passed over, so the token does not reach another Tantalus
   * that happens to sit at a saved address. The ID is public, so this does not stop one forging it. A
   * link from before host IDs trusts its one address. */
  private async reach(session: Session, routes: SavedRoute[]): Promise<Reached> {
    const answers = routes.map(async ({ url }) => {
      const { id } = await this.hello(url);
      if (session.saved.id !== null && id !== session.saved.id) {
        throw new LinkError(`Another Tantalus answers at ${url}.`);
      }
      return { url, id };
    });
    // The answers after the one taken are never awaited.
    for (const answer of answers) answer.catch(() => {});
    const reasons: unknown[] = [];
    for (const answer of answers) {
      try {
        return await answer;
      } catch (reason) {
        reasons.push(reason);
      }
    }
    // A host that needs an update says more than a route that did not answer.
    throw reasons.find((reason) => reason instanceof LinkError && reason.state !== "unreachable") ?? reasons[0];
  }

  /** Saves the host's ID, for a link from before host IDs, and every address the host serves on now. */
  private async learn(session: Session, { url, id }: Reached) {
    // A host from before routes has neither to report.
    if (id === null) return;
    const response = await request(`${url}/api/routes`, { headers: this.authorization(session.saved) }).catch(
      () => null,
    );
    const reported = routeReport(response?.ok ? await response.json().catch(() => null) : null);
    if (session !== this.session || session.stop.signal.aborted) return;
    // A route list that did not arrive says nothing about which routes are gone.
    const routes = reported ? mergedRoutes(session.saved.routes, reported, url) : session.saved.routes;
    const saved = { ...session.saved, id, routes };
    if (JSON.stringify(saved) !== JSON.stringify(session.saved)) this.save(session, saved);
  }

  /** Follows one stream until it ends. `delivered` means it carried at least one snapshot. A stream
   * silent for longer than the host's pings is given up, and one on a fallback route is left once a
   * preferred route answers. */
  private async stream(session: Session, url: string): Promise<Outcome> {
    const silence = watchdog(SILENCE_MILLISECONDS);
    const ended = new AbortController();
    let switched = false;
    void this.preferredAnswer(session, url, AbortSignal.any([session.stop.signal, ended.signal])).then((answered) => {
      switched = answered;
      if (answered) ended.abort();
    });
    let delivered = false;
    try {
      const response = await fetch(`${url}/api/events`, {
        headers: this.authorization(session.saved),
        signal: AbortSignal.any([session.stop.signal, silence.signal, ended.signal]),
      });
      if (response.status === 401) this.removed(session);
      for await (const snapshot of events(response, () => silence.reset())) {
        delivered = true;
        this.publish(session, url, snapshot);
      }
    } catch {
      // A dropped, refused or silent stream is retried.
    } finally {
      silence.clear();
      ended.abort();
    }
    return switched ? "switched" : delivered ? "delivered" : "failed";
  }

  /** Resolves true once a route preferred over `url` answers as the followed host, or false once
   * `signal` aborts. */
  private async preferredAnswer(session: Session, url: string, signal: AbortSignal): Promise<boolean> {
    while (!signal.aborted) {
      await this.sleep(PREFERRED_PROBE_MILLISECONDS, signal);
      const routes = preferred(session.saved.routes);
      const inUse = routes.findIndex((route) => route.url === url);
      const better = routes.slice(0, inUse);
      if (better.length === 0 || signal.aborted) continue;
      const answered = await this.reach(session, better).catch(() => null);
      if (answered && !signal.aborted) return true;
    }
    return false;
  }

  private async hello(url: string): Promise<HostHello> {
    const response = await request(`${url}/api/version`).catch(() => null);
    // A proxy in front of a host that is down answers for it, with a server error.
    if (!response || response.status >= 500) throw new LinkError(`Could not reach ${url}.`);
    const body: unknown = await response.json().catch(() => null);
    const protocol = field(body, "protocol");
    const name = field(body, "name");
    // A host from before pairing has no version to report.
    if (!response.ok || typeof protocol !== "number" || typeof name !== "string") {
      throw new LinkError(`Update Tantalus on the host at ${url}.`, "update-host");
    }
    if (protocol < PROTOCOL) throw new LinkError(`Update Tantalus on ${name}.`, "update-host");
    if (protocol > PROTOCOL)
      throw new LinkError(`Update Tantalus on this device to connect to ${name}.`, "update-client");
    const id = field(body, "id");
    return { protocol, name, id: typeof id === "string" ? id : null };
  }

  /** Stops retrying, but keeps following, so Settings can offer to pair again. */
  private removed(session: Session) {
    if (session.stop.signal.aborted) return;
    this.update({ state: "removed", since: this.link?.since ?? this.now(), active: null });
    session.stop.abort();
  }

  /** Keeps the time the link first stopped delivering through every failed retry. */
  private lost(session: Session, state: HostLinkState) {
    if (session.stop.signal.aborted) return;
    this.update({ state, since: this.link?.since ?? this.now(), active: null });
  }

  private publish(session: Session, url: string, snapshot: UsageSnapshot) {
    if (session.stop.signal.aborted) return;
    this.latest = snapshot;
    this.options.onSnapshot(snapshot);
    this.update({ state: "connected", since: null, active: url });
  }

  private save(session: Session, saved: SavedHostLink) {
    saveSettings(this.options.path, saved);
    session.saved = saved;
    this.saved = saved;
    this.update({ routes: routeViews(saved.routes) });
  }

  private authorization(saved: SavedHostLink) {
    return { authorization: `Bearer ${this.options.vault.open(saved.token)}` };
  }

  private update(change: Partial<HostLink>) {
    if (!this.link) return;
    const link = { ...this.link, ...change };
    if (JSON.stringify(link) !== JSON.stringify(this.link)) this.set(link);
  }

  private set(link: HostLink | null) {
    this.link = link;
    this.options.onChange(link);
  }
}

/** A route that answered as the followed host, with the host ID it reported. */
type Reached = { url: string; id: string | null };

/** Tailscale first, since it is encrypted end to end while the local network route is plain HTTP. */
function preferred(routes: SavedRoute[]): SavedRoute[] {
  return routes.toSorted((a, b) => rank(a) - rank(b));
}

const rank = (route: SavedRoute) => (routeKind(route.url) === "tailscale" ? 0 : 1);

/** The routes as Settings lists them, most preferred first. */
const routeViews = (routes: SavedRoute[]): HostRoute[] =>
  preferred(routes).map(({ url, found }) => ({ url, kind: routeKind(url), found }));

/** A Tailscale MagicDNS name or an address from the 100.64.0.0/10 range Tailscale hands out. */
export function routeKind(url: string): RemoteRoute {
  const { hostname } = new URL(url);
  const [first = 0, second = 0] = hostname.split(".").map(Number);
  const tailnet = isIPv4(hostname) && first === 100 && second >= 64 && second < 128;
  return tailnet || hostname.endsWith(".ts.net") ? "tailscale" : "localNetwork";
}

function routeReport(body: unknown): HostRoutes | null {
  const urls = field(body, "urls");
  const complete = field(body, "complete");
  if (!Array.isArray(urls) || typeof complete !== "boolean") return null;
  return { urls: urls.filter((url): url is string => typeof url === "string" && httpUrl(url)), complete };
}

/** The saved routes, then the ones the host newly reports. A found route a complete report leaves out
 * is dropped, unless it is in use, so an address DHCP gave away does not linger. */
export function mergedRoutes(routes: SavedRoute[], { urls, complete }: HostRoutes, inUse: string): SavedRoute[] {
  const known = new Set(routes.map((route) => route.url));
  const kept = routes.filter((route) => !complete || !route.found || route.url === inUse || urls.includes(route.url));
  const added = [...new Set(urls)].filter((url) => !known.has(url)).map((url) => ({ url, found: true }));
  return [...kept, ...added];
}

/** An address as typed, such as `192.168.1.5:4747`, as the origin the host serves from. */
export function hostUrl(address: string): string {
  const trimmed = address.trim();
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol === "http:" || url.protocol === "https:") return url.origin;
  } catch {}
  throw new LinkError(`${address.trim() || "That"} is not an address.`);
}

/** The snapshots in a server-sent event stream. `onData` is called on every chunk, pings included. */
async function* events(response: Response, onData: () => void): AsyncGenerator<UsageSnapshot> {
  if (!response.ok || !response.body) throw new Error("The host sent no stream.");
  let buffer = "";
  for await (const chunk of response.body.pipeThrough(new TextDecoderStream())) {
    onData();
    buffer += chunk;
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const message = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const lines = message.split("\n");
      if (!lines.includes("event: usageSnapshot")) continue;
      const data = lines.find((line) => line.startsWith("data: "));
      if (data) yield JSON.parse(data.slice("data: ".length));
    }
  }
}

/** Aborts its signal unless reset within `milliseconds` each time. */
function watchdog(milliseconds: number) {
  const controller = new AbortController();
  let timer = setTimeout(() => controller.abort(), milliseconds);
  return {
    signal: controller.signal,
    reset() {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), milliseconds);
    },
    clear() {
      clearTimeout(timer);
    },
  };
}

function request(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS) });
}

function abortableSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  return delay(milliseconds, undefined, { signal }).catch(() => {});
}
