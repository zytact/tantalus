import type { HostLink, HostLinkState } from "./ipc";

const problems: Record<HostLinkState, (host: string) => string | null> = {
  connected: () => null,
  connecting: (host) => `Connecting to ${host}.`,
  unreachable: (host) => `${host} is unreachable.`,
  removed: (host) => `${host} removed this device. Pair again in Settings.`,
  "update-host": (host) => `Update Tantalus on ${host} to keep following it.`,
  "update-client": (host) => `Update Tantalus on this device to keep following ${host}.`,
};

/** Why a client is not showing live usage from its host, or null while it is. */
export function hostLinkProblem({ host, state }: HostLink): string | null {
  return problems[state](host);
}
