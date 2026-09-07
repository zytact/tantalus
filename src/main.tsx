import "@fontsource-variable/inter-tight/wght.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { absoluteTime, countdown, creditAmount, creditExpiry, lastUpdate, remainingPercent, statusLine, usagePercent } from "./presentation";
import type { ProviderId, ProviderUsage, UsageSnapshot, WindowUsage } from "./presentation";
import "./styles.css";

const emptyWindow: WindowUsage = { used_percent: null, limit_window_seconds: null, reset_at_epoch: null };
const emptyProvider: ProviderUsage = {
  five_hour: emptyWindow, seven_day: emptyWindow, allowed: null, limit_reached: null,
  reset_credits: [], reset_credit_count: null, extra_usage: null,
  last_successful_update_epoch: null, status: "loading", error_message: null
};
const emptySnapshot: UsageSnapshot = { codex: emptyProvider, claude: emptyProvider, enabled: { codex: true, claude: true } };

const providerIds = ["codex", "claude"] as const satisfies readonly ProviderId[];
const providerNames: Record<ProviderId, string> = { codex: "Codex", claude: "Claude" };

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

/** The switch is the provider itself: switching it off stops Rust polling that provider. */
function ProviderSection({ id, provider, enabled, onToggle }: { id: ProviderId; provider: ProviderUsage; enabled: boolean; onToggle: (enabled: boolean) => void }) {
  const name = providerNames[id];
  const degraded = provider.status === "auth_missing" || provider.status === "error" || provider.status === "stale";
  return (
    <div className="provider">
      <button className="provider-row" role="switch" aria-checked={enabled} aria-label={name} onClick={() => onToggle(!enabled)}>
        <span className="provider-name">{name}</span>
        <span className="provider-status">{statusLine(provider, enabled)}</span>
        <span className="switch-track" aria-hidden="true"><span className="switch-knob" /></span>
      </button>
      {enabled && (
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

  const setEnabled = async (provider: ProviderId, enabled: boolean) => {
    setSnapshot(await invoke<UsageSnapshot>("set_provider_enabled", { provider, enabled }));
  };

  const updated = Math.max(
    0,
    ...providerIds
      .filter((id) => snapshot.enabled[id])
      .map((id) => snapshot[id].last_successful_update_epoch ?? 0)
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

      {providerIds.map((id) => (
        <ProviderSection
          key={id}
          id={id}
          provider={snapshot[id]}
          enabled={snapshot.enabled[id]}
          onToggle={(enabled) => void setEnabled(id, enabled)}
        />
      ))}

      <footer>Auto-refreshes every 5 minutes</footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
