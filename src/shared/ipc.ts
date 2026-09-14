import type { ProviderId, UsageSnapshot } from "./usage";

/** A signed release newer than the running build, as the window and tray show it. */
export type AvailableUpdate = { version: string };

/** Every request the window can make of the main process, keyed by channel. */
export type Commands = {
  refreshUsage: () => UsageSnapshot;
  setProviderEnabled: (provider: ProviderId, enabled: boolean) => UsageSnapshot;
  checkForUpdate: () => AvailableUpdate | null;
  installUpdate: () => void;
  openAtLogin: () => boolean;
  setOpenAtLogin: (enabled: boolean) => void;
};

/** What the main process publishes to the window, keyed by channel. The window can also read the
 * latest value of each, which is null until there is one. */
export type Events = {
  usageSnapshot: UsageSnapshot;
  updateAvailable: AvailableUpdate;
};

/** The channel that serves the latest value of an event. */
export const CURRENT = "current";

/** A command's result as it crosses the process boundary. Electron rewrites a thrown error's message,
 * so a failure travels as a value and the preload throws it again. */
export type Reply<T> = { ok: true; value: T } | { ok: false; error: string };

/** What the preload exposes to the window as `window.tantalus`. */
export type Bridge = {
  invoke<C extends keyof Commands>(command: C, ...args: Parameters<Commands[C]>): Promise<ReturnType<Commands[C]>>;
  on<E extends keyof Events>(event: E, listener: (payload: Events[E]) => void): () => void;
  current<E extends keyof Events>(event: E): Promise<Events[E] | null>;
};
