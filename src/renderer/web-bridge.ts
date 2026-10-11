import { hostAnswered, hostRequestInit, hostRequests, hostUnanswered } from "../shared/host-link";
import type { HostRequest } from "../shared/host-link";
import type { Bridge, Commands, Events } from "../shared/ipc";

/** How often a host that is away is asked whether it is back. */
const RETRY_MILLISECONDS = 3000;

/** The host's answer, or null when none came. A failure the host explains is thrown in its words. */
async function respond(request: HostRequest): Promise<Response | null> {
  const response = await fetch(request.path, hostRequestInit(request)).catch(() => null);
  if (!hostAnswered(response)) return null;
  if (!response.ok) throw new Error(await response.text());
  return response;
}

async function ask<T>(request: HostRequest): Promise<T> {
  const response = await respond(request);
  if (!response) throw new Error(hostUnanswered("The host"));
  return response.json();
}

/** Everything a browser on another device can ask of the host. A host that installs restarts instead
 * of answering, so a dropped install is no failure, and the stream shows its progress. */
const commands: {
  [C in keyof Commands]?: (...args: Parameters<Commands[C]>) => Promise<ReturnType<Commands[C]>>;
} = {
  refreshUsage: () => ask(hostRequests.refresh),
  checkForHostUpdate: () => ask(hostRequests.checkUpdate),
  installHostUpdate: async (acknowledgedNoticeIds) => {
    await respond(hostRequests.update(acknowledgedNoticeIds));
  },
  hostReleaseNotes: () => ask(hostRequests.releaseNotes),
};

/** The page as the host serves it now, which names the build's files, or null when it does not answer. */
const servedPage = () =>
  fetch("/", { cache: "no-store" })
    .then((response) => (response.ok ? response.text() : null))
    .catch(() => null);

/** Keeps the page current through a host that goes away and comes back. The browser retries a dropped
 * stream itself, and the host sends everything again, so the page reloads only when the host came back
 * as another build. The browser gives up on a stream that is refused, which a proxy does for a host
 * that is away and the host does for a device it removed. Then the host is asked until it answers, and
 * the page reloads into the allowance or the pairing page. */
function followRestarts(source: EventSource) {
  const loaded = servedPage();
  let dropped = false;
  source.addEventListener("open", async () => {
    if (!dropped) return;
    dropped = false;
    const [before, now] = await Promise.all([loaded, servedPage()]);
    if (now !== null && now !== before) location.reload();
  });
  source.addEventListener("error", () => {
    dropped = true;
    if (source.readyState === EventSource.CLOSED) void reloadOnceAnswered();
  });
}

async function reloadOnceAnswered() {
  for (;;) {
    const response = await fetch("/api/current/serverEpoch").catch(() => null);
    if (hostAnswered(response)) return location.reload();
    await new Promise((resolve) => setTimeout(resolve, RETRY_MILLISECONDS));
  }
}

/** What a browser on another device uses in place of the preload. It follows published events over
 * HTTP and exposes the remote actions: refreshing usage, and checking for and installing the host's
 * update. */
export function webBridge(): Bridge {
  const source = new EventSource("/api/events");
  followRestarts(source);
  return {
    invoke<C extends keyof Commands>(command: C, ...args: Parameters<Commands[C]>): Promise<ReturnType<Commands[C]>> {
      return (
        commands[command]?.(...args) ?? Promise.reject(new Error(`${command} is not available from another device.`))
      );
    },
    on<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void) {
      const forward = (message: MessageEvent<string>) => {
        const payload: Events[E] = JSON.parse(message.data);
        listener(payload);
      };
      source.addEventListener(event, forward);
      return () => source.removeEventListener(event, forward);
    },
    async current<E extends keyof Events>(event: E): Promise<Events[E] | null> {
      const response = await fetch(`/api/current/${event}`);
      if (!response.ok) throw new Error(`Could not read ${event}.`);
      return response.json();
    },
  };
}
