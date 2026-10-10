import { hostRequestInit, hostUnanswered } from "../shared/host-link";
import type { HostRequest } from "../shared/host-link";
import type { Bridge, Commands, Events } from "../shared/ipc";

/** Everything a browser on another device can ask of the host, as the request each command sends. */
const requests: { [C in keyof Commands]?: (...args: Parameters<Commands[C]>) => HostRequest } = {
  refreshUsage: () => ({ path: "/api/refresh", action: "refresh" }),
  checkForHostUpdate: () => ({ path: "/api/check-update", action: "check-update" }),
  installHostUpdate: (acknowledgedNoticeIds) => ({
    path: "/api/update",
    action: "update",
    body: { acknowledgedNoticeIds },
  }),
  hostReleaseNotes: () => ({ path: "/api/release-notes" }),
};

/** A failure the host explains is thrown in the host's words. */
async function send<T>(request: HostRequest): Promise<T> {
  const response = await fetch(request.path, hostRequestInit(request)).catch(() => null);
  if (!response) throw new Error(hostUnanswered("The host", request.action === "update"));
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

/** What a browser on another device uses in place of the preload. It follows published events over
 * HTTP and exposes the remote actions: refreshing usage, and checking for and installing the host's
 * update. */
export function webBridge(): Bridge {
  const source = new EventSource("/api/events");
  // The browser retries a dropped stream itself, and gives up only when the host refuses it, which
  // means the device was removed. Reloading shows the pairing page.
  source.addEventListener("error", () => {
    if (source.readyState === EventSource.CLOSED) location.reload();
  });
  return {
    invoke<C extends keyof Commands>(command: C, ...args: Parameters<Commands[C]>): Promise<ReturnType<Commands[C]>> {
      const request = requests[command]?.(...args);
      return request ? send(request) : Promise.reject(new Error(`${command} is not available from another device.`));
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
