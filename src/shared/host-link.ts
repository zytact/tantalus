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

/** What a paired device says when the host drops a request. */
export const hostUnanswered = (host: string) => `${host} stopped answering.`;

/** The guarded actions a paired device can take on its host. */
export type HostAction = "refresh" | "check-update" | "update";
/** A paired request to a host. `action` makes it a POST carrying `body` as JSON. */
export type HostRequest = { path: string; action?: HostAction; body?: unknown };

/** A host serves each action at the path of the same name. */
const act = (action: HostAction, body?: unknown): HostRequest => ({ path: `/api/${action}`, action, body });

/** The requests a browser and a following Tantalus send alike. `update` carries only the notices the
 * user acknowledged, so the host installs nothing but the update it already found. */
export const hostRequests = {
  refresh: act("refresh"),
  checkUpdate: act("check-update"),
  update: (acknowledgedNoticeIds: string[]) => act("update", { acknowledgedNoticeIds }),
  releaseNotes: { path: "/api/release-notes" },
} satisfies Record<string, HostRequest | ((...args: never[]) => HostRequest)>;

/** Whether a host answered at all. A proxy in front of a host that is away answers for it, with a
 * server error, so the host's own refusals never use one. */
export const hostAnswered = (response: Response | null): response is Response =>
  response !== null && response.status < 500;

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
