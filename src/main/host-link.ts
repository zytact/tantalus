import { rmSync } from "node:fs";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import { hostLinkProblem } from "../shared/host-link";
import { PROTOCOL } from "../shared/ipc";
import type { HostHello, HostLink, HostLinkState } from "../shared/ipc";
import { nowEpoch } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { field } from "./parse";
import { loadHostLink, saveSettings } from "./settings";
import type { SavedHostLink } from "./settings";

/** The first wait after a dropped link, doubled on each failure up to the longest. */
const RETRY_FIRST_MILLISECONDS = 1000;
const RETRY_LONGEST_MILLISECONDS = 30_000;
/** A host pings every open stream every 15 seconds, so this much silence means the link is gone. */
const SILENCE_MILLISECONDS = 45_000;
const REQUEST_TIMEOUT_MILLISECONDS = 10_000;

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

type Outcome = "delivered" | "failed";
type Session = { saved: SavedHostLink; stop: AbortController };

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
    const saved = { url, host: hello.name, token: this.options.vault.seal(token) };
    saveSettings(this.options.path, saved);
    this.follow(saved);
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
    const response = await request(`${saved.url}/api/refresh`, {
      method: "POST",
      headers: { ...this.authorization(saved), "x-tantalus-action": "refresh" },
    }).catch(() => null);
    if (response?.status === 401) this.removed(session);
    if (!response?.ok) throw new Error(`Could not refresh usage on ${saved.host}.`);
    const snapshot: UsageSnapshot = await response.json();
    if (session !== this.session || session.stop.signal.aborted) throw new Error(`Stopped following ${saved.host}.`);
    this.publish(session, snapshot);
    return snapshot;
  }

  private follow(saved: SavedHostLink) {
    this.session?.stop.abort();
    const session = { saved, stop: new AbortController() };
    this.session = session;
    this.saved = saved;
    this.latest = null;
    this.set({ url: saved.url, host: saved.host, state: "connecting", since: null });
    void this.run(session);
  }

  /** Reconnects until stopped or removed, waiting longer after each failure in a row. */
  private async run(session: Session) {
    const { signal } = session.stop;
    let wait = RETRY_FIRST_MILLISECONDS;
    while (!signal.aborted) {
      const outcome = await this.listen(session);
      if (outcome === "delivered") wait = RETRY_FIRST_MILLISECONDS;
      await this.sleep(wait, signal);
      wait = Math.min(wait * 2, RETRY_LONGEST_MILLISECONDS);
    }
  }

  /** Follows the host for one stream, and marks the link lost unless it was stopped or removed. */
  private async listen(session: Session): Promise<Outcome> {
    try {
      await this.hello(session.saved.url);
    } catch (error) {
      this.lost(session, error instanceof LinkError ? error.state : "unreachable");
      return "failed";
    }
    const outcome = await this.stream(session);
    this.lost(session, "unreachable");
    return outcome;
  }

  /** Follows one stream until it ends. `delivered` means it carried at least one snapshot. A stream
   * silent for longer than the host's pings is given up. */
  private async stream(session: Session): Promise<Outcome> {
    const silence = watchdog(SILENCE_MILLISECONDS);
    let delivered = false;
    try {
      const response = await fetch(`${session.saved.url}/api/events`, {
        headers: this.authorization(session.saved),
        signal: AbortSignal.any([session.stop.signal, silence.signal]),
      });
      if (response.status === 401) this.removed(session);
      for await (const snapshot of events(response, () => silence.reset())) {
        delivered = true;
        this.publish(session, snapshot);
      }
    } catch {
      // A dropped, refused or silent stream is retried.
    } finally {
      silence.clear();
    }
    return delivered ? "delivered" : "failed";
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
    return { protocol, name };
  }

  /** Stops retrying, but keeps following, so Settings can offer to pair again. */
  private removed(session: Session) {
    if (session.stop.signal.aborted) return;
    this.update({ state: "removed", since: this.link?.since ?? this.now() });
    session.stop.abort();
  }

  /** Keeps the time the link first stopped delivering through every failed retry. */
  private lost(session: Session, state: HostLinkState) {
    if (session.stop.signal.aborted) return;
    this.update({ state, since: this.link?.since ?? this.now() });
  }

  private publish(session: Session, snapshot: UsageSnapshot) {
    if (session.stop.signal.aborted) return;
    this.latest = snapshot;
    this.options.onSnapshot(snapshot);
    this.update({ state: "connected", since: null });
  }

  private authorization(saved: SavedHostLink) {
    return { authorization: `Bearer ${this.options.vault.open(saved.token)}` };
  }

  private update(change: Pick<HostLink, "state" | "since">) {
    if (!this.link || (this.link.state === change.state && this.link.since === change.since)) return;
    this.set({ ...this.link, ...change });
  }

  private set(link: HostLink | null) {
    this.link = link;
    this.options.onChange(link);
  }
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
