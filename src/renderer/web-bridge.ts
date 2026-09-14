import type { Bridge, Commands, Events } from "../shared/ipc";

/** What a browser on another device uses in place of the preload. It follows published events over
 * HTTP and exposes the one remote action, refreshing usage. */
export function webBridge(): Bridge {
  const source = new EventSource("/api/events");
  return {
    invoke<C extends keyof Commands>(command: C, ..._args: Parameters<Commands[C]>): Promise<ReturnType<Commands[C]>> {
      if (command === "refreshUsage") {
        return fetch("/api/refresh", { method: "POST", headers: { "x-tantalus-action": "refresh" } }).then(
          async (response) => {
            if (!response.ok) throw new Error("Could not refresh usage.");
            return response.json();
          },
        );
      }
      return Promise.reject(new Error(`${command} is not available from another device.`));
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
