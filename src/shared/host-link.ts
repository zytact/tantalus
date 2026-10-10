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

/** What a paired device says when the host drops a request. A host that finishes an install restarts
 * instead of answering, so a dropped install reads the same as a finished one. */
export function hostUnanswered(host: string, installing: boolean): string {
  return `${host} stopped answering.${installing ? " It restarts once the install finishes." : ""}`;
}

/** A paired request to a host. `action` names a guarded action, which is a POST carrying `body` as JSON. */
export type HostRequest = { path: string; action?: string; body?: unknown };

/** How a host request is sent, before the sender adds what proves it is paired. */
export function hostRequestInit({ action, body }: HostRequest): {
  method: string;
  headers: Record<string, string>;
  body?: string;
} {
  return action
    ? { method: "POST", headers: { "x-tantalus-action": action }, body: JSON.stringify(body ?? null) }
    : { method: "GET", headers: {} };
}
