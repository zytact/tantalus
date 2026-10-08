import type { HostLink } from "./ipc";

/** Why a client is not showing live usage from its host, or null while it is. */
export function hostLinkProblem({ host, state }: HostLink): string | null {
  switch (state) {
    case "connected":
      return null;
    case "connecting":
      return `Connecting to ${host}.`;
    case "unreachable":
      return `${host} is unreachable.`;
    case "removed":
      return `${host} removed this device. Pair again in Settings.`;
    case "update-host":
      return `Update Tantalus on ${host} to keep following it.`;
    case "update-client":
      return `Update Tantalus on this device to keep following ${host}.`;
  }
}
