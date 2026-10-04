import type { ProviderId } from "./usage";

/** The providers whose 5-hour window Tantalus can start through their CLI or a proxy hub. */
export const startProviderIds = ["claude", "codex"] as const satisfies readonly ProviderId[];
export type StartProviderId = (typeof startProviderIds)[number];

/** Starts cover every provider being polled. `path` is the CLI the user chose, or null to look in the usual install locations. */
export type StartProviderSettings = { path: string | null };
export type WindowStartSettings = {
  enabled: boolean;
  wake: boolean;
  providers: Record<StartProviderId, StartProviderSettings>;
};

/** The last time Tantalus tried a start or renewal, and why it failed if it did. */
export type StartAttempt = { epoch: number; error: string | null };

/** `command` is what would run, or null when no CLI was found. */
export type WindowStart = {
  enabled: boolean;
  wake: boolean;
  lastWake: StartAttempt | null;
  hubs: {
    key: string;
    hubId: string;
    accountId: string;
    label: string;
    provider: StartProviderId;
    last: StartAttempt | null;
  }[];
  providers: Record<StartProviderId, StartProviderSettings & { command: string | null; last: StartAttempt | null }>;
};
