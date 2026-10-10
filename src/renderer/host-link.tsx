import { useState } from "react";
import { hostLinkProblem } from "../shared/host-link";
import { remoteRouteNames } from "../shared/ipc";
import type { HostLink, HostLinkState, HostRoute } from "../shared/ipc";
import { refreshedEpoch } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { absoluteTime } from "./presentation";
import { RouteIcon } from "./route-icon";
import { HostUpdateCheck, UpdateNotice } from "./update-notice";

/** Says why a followed host's usage is not live, and how old the usage shown is. */
export function HostBanner({ link, snapshot }: { link: HostLink; snapshot: UsageSnapshot | null }) {
  const problem = hostLinkProblem(link);
  if (!problem) return null;
  const since = link.since === null ? "" : ` Since ${absoluteTime(link.since)}.`;
  const shown = snapshot ? ` Showing usage from ${absoluteTime(refreshedEpoch(snapshot))}.` : "";
  return (
    <p className="notice" role="status">
      {problem}
      {since}
      {shown}
    </p>
  );
}

/** Each state's dot color and the line under the host name. */
const states: Record<HostLinkState, { tone: "ok" | "warn" | "danger"; status: (link: HostLink) => string }> = {
  connected: { tone: "ok", status: () => "Connected" },
  connecting: { tone: "warn", status: () => "Connecting" },
  unreachable: {
    tone: "danger",
    status: ({ since }) => (since === null ? "Unreachable" : `Unreachable since ${absoluteTime(since)}`),
  },
  removed: { tone: "danger", status: (link) => hostLinkProblem(link) ?? "" },
  "update-host": { tone: "danger", status: (link) => hostLinkProblem(link) ?? "" },
  "update-client": { tone: "danger", status: (link) => hostLinkProblem(link) ?? "" },
};

/** Settings while following a host: where usage comes from, the routes to it, the host's update, and
 * the way back to this machine's own. */
export function HostRows({ link }: { link: HostLink }) {
  const [error, setError] = useState<string | null>(null);
  const { tone, status } = states[link.state];
  const disconnect = () => {
    setError(null);
    void window.tantalus.invoke("disconnectHost").catch(() => setError("Could not disconnect."));
  };
  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>
            <span className={`status-dot ${tone}`} aria-hidden="true" />
            Following {link.host}
          </h2>
          <p>{status(link)}</p>
        </div>
        <button onClick={disconnect}>Disconnect</button>
      </section>
      <Failure message={error} />
      {link.state === "removed" && <ConnectForm address={link.routes[0]?.url} />}
      <Routes link={link} />
      {link.state !== "removed" && (
        <>
          <HostUpdateCheck host={link.host} />
          <UpdateNotice host={link.host} />
        </>
      )}
    </>
  );
}

/** Every address the host answers on, most preferred first, with the one delivering usage marked. */
function Routes({ link }: { link: HostLink }) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="routes" aria-labelledby="routes-heading">
      <h3 id="routes-heading">Routes</h3>
      <ul className="route-group">
        {link.routes.map((route) => (
          <RouteRow key={route.url} route={route} inUse={route.url === link.active} />
        ))}
        <li className="route-add">
          {adding ? (
            <AddRouteForm onDone={() => setAdding(false)} />
          ) : (
            <button className="route-add-button" onClick={() => setAdding(true)}>
              Add route
            </button>
          )}
        </li>
      </ul>
      <OneRouteNote link={link} />
    </section>
  );
}

function RouteRow({ route, inUse }: { route: HostRoute; inUse: boolean }) {
  return (
    <li className="route-row">
      <RouteIcon kind={route.kind} />
      <div className="route-copy">
        <p className="route-name">
          {remoteRouteNames[route.kind]}
          {route.found && <span className="route-found"> · found automatically</span>}
        </p>
        <p className="route-url">{route.url}</p>
      </div>
      {inUse && <span className="route-pill">In use</span>}
    </li>
  );
}

/** Falling back needs both routes on at the host. A link with no found route follows a host from
 * before routes, which reports none, so it gets no note. */
function OneRouteNote({ link }: { link: HostLink }) {
  const found = link.routes.find((route) => route.found);
  if (!found || link.routes.some((route) => route.kind !== found.kind)) return null;
  const only = remoteRouteNames[found.kind];
  const other = remoteRouteNames[found.kind === "tailscale" ? "localNetwork" : "tailscale"];
  return (
    <p className="route-footer">
      Only {only} is on at {link.host}. Switch on {other} in its Remote access settings too, so this device can move to
      it when {only} drops.
    </p>
  );
}

/** Adds an address the host answers on. The main process checks it reaches the same host first. */
function AddRouteForm({ onDone }: { onDone: () => void }) {
  const [url, setUrl] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async () => {
    setAdding(true);
    setError(null);
    await window.tantalus.invoke("addHostRoute", url).then(onDone, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : "Could not add the route.");
      setAdding(false);
    });
  };
  return (
    <>
      <form
        className="hub-form"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <AddressField className="hub-form-wide" value={url} onChange={setUrl} autoFocus />
        <div className="setting-actions">
          <button disabled={adding} type="submit">
            {adding ? "Checking" : "Add"}
          </button>
          <button type="button" onClick={onDone}>
            Cancel
          </button>
        </div>
      </form>
      <Failure message={error} />
    </>
  );
}

/** Settings while reading this machine's own usage: the way to follow another Tantalus instead. */
export function ConnectRows() {
  const [open, setOpen] = useState(false);
  // A pairing in flight cannot be called back, so the form stays until it answers.
  const [connecting, setConnecting] = useState(false);
  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>Follow another Tantalus</h2>
          <p>Show the usage another computer reads, instead of signing in here. This one stops polling.</p>
        </div>
        <button disabled={connecting} onClick={() => setOpen((shown) => !shown)}>
          {open ? "Cancel" : "Connect"}
        </button>
      </section>
      {open && <ConnectForm onConnecting={setConnecting} />}
    </>
  );
}

function ConnectForm({
  address = "",
  onConnecting,
}: {
  address?: string;
  onConnecting?: (connecting: boolean) => void;
}) {
  const [url, setUrl] = useState(address);
  const [code, setCode] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const busy = (value: boolean) => {
    setConnecting(value);
    onConnecting?.(value);
  };
  const connect = async () => {
    busy(true);
    setError(null);
    await window.tantalus
      .invoke("connectHost", url, code)
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Could not connect."));
    busy(false);
  };

  return (
    <>
      <form
        className="hub-form"
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <AddressField value={url} onChange={setUrl} autoFocus={!address} />
        <label>
          Pairing code
          <input
            required
            autoComplete="one-time-code"
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
            autoFocus={Boolean(address)}
          />
        </label>
        <button disabled={connecting} type="submit">
          {connecting ? "Connecting" : "Connect"}
        </button>
      </form>
      <Failure message={error} />
    </>
  );
}

/** The host address field the connect and Add route forms share. */
function AddressField({
  value,
  onChange,
  autoFocus,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  autoFocus: boolean;
  className?: string;
}) {
  return (
    <label className={className}>
      Address
      <input
        required
        placeholder="http://192.168.1.5:4747"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        autoFocus={autoFocus}
      />
    </label>
  );
}

function Failure({ message }: { message: string | null }) {
  return (
    message && (
      <p className="notice settings-notice" role="alert">
        {message}
      </p>
    )
  );
}
