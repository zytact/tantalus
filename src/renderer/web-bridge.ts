import { hostRequestInit, hostRequests, hostUnanswered } from "../shared/host-link";
import type { HostRequest } from "../shared/host-link";
import type { Bridge, Commands, Events } from "../shared/ipc";

/** How long a stream the host stopped serving waits before it is opened again. */
const REOPEN_MILLISECONDS = 3000;

/** The host's answer, or null when none came. A failure the host explains is thrown in its words. */
async function respond(request: HostRequest): Promise<Response | null> {
  const response = await fetch(request.path, hostRequestInit(request)).catch(() => null);
  if (response && !response.ok) throw new Error(await response.text());
  return response;
}

async function ask<T>(request: HostRequest): Promise<T> {
  const response = await respond(request);
  if (!response) throw new Error(hostUnanswered("The host"));
  return response.json();
}

/** Everything a browser on another device can ask of the host. A host that installs restarts instead
 * of answering, so a dropped install is no failure, and the stream says how it went. */
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

type Forward = (message: MessageEvent<string>) => void;

/** The host's event stream, kept open through a host that restarts. The browser retries a dropped
 * stream itself, but gives up on one the host or a proxy in front of it refuses. A refusal from the
 * host means the device was removed, and reloading shows the pairing page. Any other is a host that is
 * away, so the stream is opened again until it answers. */
function hostStream() {
  const forwards = new Set<readonly [string, Forward]>();
  let source: EventSource;
  const reopen = async () => {
    const status = await fetch("/api/current/serverEpoch").then(
      (response) => response.status,
      () => null,
    );
    if (status === 401) return location.reload();
    setTimeout(open, REOPEN_MILLISECONDS);
  };
  const open = () => {
    source = new EventSource("/api/events");
    for (const [event, forward] of forwards) source.addEventListener(event, forward);
    source.addEventListener("error", () => {
      if (source.readyState === EventSource.CLOSED) void reopen();
    });
  };
  open();
  return (event: string, forward: Forward) => {
    const entry = [event, forward] as const;
    forwards.add(entry);
    source.addEventListener(event, forward);
    return () => {
      forwards.delete(entry);
      source.removeEventListener(event, forward);
    };
  };
}

/** What a browser on another device uses in place of the preload. It follows published events over
 * HTTP and exposes the remote actions: refreshing usage, and checking for and installing the host's
 * update. */
export function webBridge(): Bridge {
  const listen = hostStream();
  return {
    invoke<C extends keyof Commands>(command: C, ...args: Parameters<Commands[C]>): Promise<ReturnType<Commands[C]>> {
      return (
        commands[command]?.(...args) ?? Promise.reject(new Error(`${command} is not available from another device.`))
      );
    },
    on<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void) {
      return listen(event, (message) => {
        const payload: Events[E] = JSON.parse(message.data);
        listener(payload);
      });
    },
    async current<E extends keyof Events>(event: E): Promise<Events[E] | null> {
      const response = await fetch(`/api/current/${event}`);
      if (!response.ok) throw new Error(`Could not read ${event}.`);
      return response.json();
    },
  };
}
