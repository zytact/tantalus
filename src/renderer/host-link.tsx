import { useState } from "react";
import { hostLinkProblem } from "../shared/host-link";
import type { HostLink } from "../shared/ipc";
import { refreshedEpoch } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { absoluteTime } from "./presentation";

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

/** Settings while following a host: where usage comes from, and the way back to this machine's own. */
export function HostRows({ link }: { link: HostLink }) {
  const [error, setError] = useState<string | null>(null);
  const disconnect = () => {
    setError(null);
    void window.tantalus.invoke("disconnectHost").catch(() => setError("Could not disconnect."));
  };
  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>Following {link.host}</h2>
          <p>{hostLinkProblem(link) ?? `Showing live usage from ${link.host}.`}</p>
          <p className="setting-url">{link.url}</p>
        </div>
        <button onClick={disconnect}>Disconnect</button>
      </section>
      {link.state === "removed" && <ConnectForm address={link.url} />}
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
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
      {open && <ConnectForm address="" onConnecting={setConnecting} />}
    </>
  );
}

function ConnectForm({ address, onConnecting }: { address: string; onConnecting?: (connecting: boolean) => void }) {
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
        <label>
          Address
          <input
            required
            placeholder="http://192.168.1.5:4747"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            autoFocus={!address}
          />
        </label>
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
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
