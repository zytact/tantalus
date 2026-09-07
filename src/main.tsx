import "@fontsource-variable/inter-tight/wght.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { absoluteTime, countdown, creditAmount, creditExpiry, lastUpdate, remainingPercent, usagePercent } from "./presentation";
import "./styles.css";

type WindowUsage = { used_percent: number | null; limit_window_seconds: number | null; reset_at_epoch: number | null };
type ResetCredit = { expires_at_epoch: number | null };
type ExtraUsage = { enabled: boolean; used_credits: number | null; monthly_limit: number | null; currency: string | null };
type ProviderUsage = {
  five_hour: WindowUsage;
  seven_day: WindowUsage;
  allowed: boolean | null;
  limit_reached: boolean | null;
  reset_credits: ResetCredit[];
  reset_credit_count: number | null;
  extra_usage: ExtraUsage | null;
  last_successful_update_epoch: number | null;
  status: "ready" | "loading" | "stale" | "auth_missing" | "error";
  error_message: string | null;
};
type UsageSnapshot = { codex: ProviderUsage; claude: ProviderUsage };
type ProviderId = keyof UsageSnapshot;

const emptyWindow: WindowUsage = { used_percent: null, limit_window_seconds: null, reset_at_epoch: null };
const emptyProvider: ProviderUsage = {
  five_hour: emptyWindow, seven_day: emptyWindow, allowed: null, limit_reached: null,
  reset_credits: [], reset_credit_count: null, extra_usage: null,
  last_successful_update_epoch: null, status: "loading", error_message: null
};
const emptySnapshot: UsageSnapshot = { codex: emptyProvider, claude: emptyProvider };

const providerNames: Record<ProviderId, string> = { codex: "Codex", claude: "Claude" };

function statusLine(provider: ProviderUsage): string {
  switch (provider.status) {
    case "auth_missing": return "Not signed in";
    case "error": return "Could not refresh";
    case "stale": return "Cached";
    case "loading": return "Loading";
    default: return provider.allowed === false || provider.limit_reached ? "Blocked until reset" : "Live";
  }
}

/** One window as a ledger entry: headline figure, consumption rule, then the supporting facts. */
function Entry({ label, span, duration, window: usage }: { label: string; span: string; duration: number; window: WindowUsage }) {
  const reported = usage.limit_window_seconds === duration;
  const used = reported ? usage.used_percent : null;
  const entryLabel = reported ? label : "Window unavailable";
  return (
    <section className="entry" aria-label={entryLabel}>
      <div className="entry-head">
        <h3>{entryLabel}<i>{reported ? span : "unrecognized duration"}</i></h3>
        <strong className="figure">{usagePercent(used)}</strong>
      </div>
      <div
        className="rule"
        role="progressbar"
        aria-label={`${entryLabel} usage`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={used ?? undefined}
        aria-valuetext={usagePercent(used)}
      >
        <span style={{ width: `${Math.min(100, Math.max(0, used ?? 0))}%` }} />
      </div>
      <dl className="facts">
        <div><dt>Resets</dt><dd>{countdown(reported ? usage.reset_at_epoch : null)}</dd></div>
        <div><dt>At</dt><dd>{absoluteTime(reported ? usage.reset_at_epoch : null)}</dd></div>
        <div><dt>Remaining</dt><dd>{remainingPercent(used)}</dd></div>
      </dl>
    </section>
  );
}

/** Codex banks reset credits; Claude bills overflow against a monthly allowance. */
function Extras({ provider }: { provider: ProviderUsage }) {
  const extra = provider.extra_usage;
  if (extra) {
    return (
      <section className="entry" aria-label="Extra usage">
        <div className="entry-head">
          <h3>Extra usage<i>{extra.enabled ? "enabled" : "off"}</i></h3>
          <strong className="figure">{creditAmount(extra.used_credits, extra.currency)}</strong>
        </div>
        <ol className="credits">
          <li><span>Monthly limit</span><span>{creditAmount(extra.monthly_limit, extra.currency)}</span></li>
        </ol>
      </section>
    );
  }
  return (
    <section className="entry" aria-label="Reset credits">
      <div className="entry-head">
        <h3>Reset credits<i>banked</i></h3>
        <strong className="figure">{provider.reset_credit_count ?? "Unavailable"}</strong>
      </div>
      {provider.reset_credits.length > 0 ? (
        <ol className="credits">
          {provider.reset_credits.map((credit, index) => (
            <li key={index}><span>Credit {index + 1}</span><span>{creditExpiry(credit.expires_at_epoch)}</span></li>
          ))}
        </ol>
      ) : (
        <p className="empty">No credit details available.</p>
      )}
    </section>
  );
}

function ProviderSection({ id, provider, open, onToggle }: { id: ProviderId; provider: ProviderUsage; open: boolean; onToggle: () => void }) {
  const name = providerNames[id];
  const degraded = provider.status === "auth_missing" || provider.status === "error" || provider.status === "stale";
  return (
    <div className="provider">
      <button className="provider-row" aria-expanded={open} onClick={onToggle}>
        <span className="provider-name">{name}</span>
        <span className="provider-status">{statusLine(provider)}</span>
        <span className="switch-track" aria-hidden="true"><span className="switch-knob" /></span>
      </button>
      {open && (
        <>
          {degraded && (
            <p className="notice" role="status">{provider.error_message ?? "The last successful reading remains visible."}</p>
          )}
          <Entry label="Short window" span="5 hours" duration={18_000} window={provider.five_hour} />
          <Entry label="Long window" span="7 days" duration={604_800} window={provider.seven_day} />
          <Extras provider={provider} />
        </>
      )}
    </div>
  );
}

function App() {
  const [snapshot, setSnapshot] = useState(emptySnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState<ProviderId[]>(["codex", "claude"]);

  const refresh = async () => {
    setRefreshing(true);
    try { setSnapshot(await invoke<UsageSnapshot>("refresh_usage")); }
    finally { setRefreshing(false); }
  };

  useEffect(() => {
    void invoke<UsageSnapshot>("cached_usage").then(setSnapshot);
    const unlisten = listen<UsageSnapshot>("usage-snapshot", (event) => setSnapshot(event.payload));
    return () => { void unlisten.then((stop) => stop()); };
  }, []);

  const toggle = (id: ProviderId) =>
    setOpen((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const updated = Math.max(
    snapshot.codex.last_successful_update_epoch ?? 0,
    snapshot.claude.last_successful_update_epoch ?? 0
  );

  return (
    <main>
      <header>
        <div>
          <h1>Allowance</h1>
          <p className="status">{lastUpdate(updated || null)}</p>
        </div>
        <button onClick={() => void refresh()} disabled={refreshing} aria-busy={refreshing}>
          {refreshing ? "Refreshing" : "Refresh"}
        </button>
      </header>

      {(["codex", "claude"] as const).map((id) => (
        <ProviderSection key={id} id={id} provider={snapshot[id]} open={open.includes(id)} onToggle={() => toggle(id)} />
      ))}

      <footer>Auto-refreshes every 5 minutes</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
