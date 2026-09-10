import "@fontsource-variable/inter-tight/wght.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  absoluteTime,
  countdown,
  creditAmount,
  creditExpiry,
  fiveHourSeconds,
  lastUpdate,
  monthlySeconds,
  providerExtras,
  providerIds,
  providerNames,
  remainingPercent,
  sevenDaySeconds,
  statusLine,
  statusTone,
  usagePercent,
  usageTier,
} from "./presentation";
import type { ExtraUsage, ProviderId, ProviderUsage, UsageSnapshot, WindowUsage } from "./presentation";
import { ProviderIcon } from "./provider-icon";
import { SettingsPage } from "./settings-page";
import "./styles.css";

/** One window as a ledger entry: headline figure, consumption rule, then the supporting facts. */
function Entry({
  label,
  span,
  duration,
  window: usage,
}: {
  label: string;
  span: string;
  duration: number;
  window: WindowUsage;
}) {
  const reported = usage.limit_window_seconds === duration;
  const used = reported ? usage.used_percent : null;
  const entryLabel = reported ? label : "Window unavailable";
  return (
    <section className="entry" aria-label={entryLabel}>
      <div className="entry-head">
        <h3>
          {entryLabel}
          <i>{reported ? span : "unrecognized duration"}</i>
        </h3>
        <strong className="figure">{usagePercent(used)}</strong>
      </div>
      <div
        className="rule"
        data-tier={usageTier(used)}
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
        <div>
          <dt>Resets</dt>
          <dd>{countdown(reported ? usage.reset_at_epoch : null)}</dd>
        </div>
        <div>
          <dt>At</dt>
          <dd>{absoluteTime(reported ? usage.reset_at_epoch : null)}</dd>
        </div>
        <div>
          <dt>Remaining</dt>
          <dd>{remainingPercent(used)}</dd>
        </div>
      </dl>
    </section>
  );
}

/** Claude bills overflow against a monthly allowance. */
function Spend({ extra }: { extra: ExtraUsage }) {
  return (
    <section className="entry" aria-label="Extra usage">
      <div className="entry-head">
        <h3>
          Extra usage<i>{extra.enabled ? "enabled" : "off"}</i>
        </h3>
        <strong className="figure">{creditAmount(extra.used_credits, extra.currency)}</strong>
      </div>
      <ol className="credits">
        <li>
          <span>Monthly limit</span>
          <span>{creditAmount(extra.monthly_limit, extra.currency)}</span>
        </li>
      </ol>
    </section>
  );
}

/** Codex banks credits that reset a spent window early. */
function Credits({ provider }: { provider: ProviderUsage }) {
  return (
    <section className="entry" aria-label="Reset credits">
      <div className="entry-head">
        <h3>
          Reset credits<i>banked</i>
        </h3>
        <strong className="figure">{provider.reset_credit_count ?? "Unavailable"}</strong>
      </div>
      {provider.reset_credits.length > 0 ? (
        <ol className="credits">
          {provider.reset_credits.map((credit, index) => (
            <li key={index}>
              <span>Credit {index + 1}</span>
              <span>{creditExpiry(credit.expires_at_epoch)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty">No credit details available.</p>
      )}
    </section>
  );
}

/** Which extras a provider has is fixed per provider, not inferred from what the last read held. */
function Extras({ id, provider }: { id: ProviderId; provider: ProviderUsage }) {
  switch (providerExtras[id]) {
    case "spend":
      return provider.extra_usage && <Spend extra={provider.extra_usage} />;
    case "credits":
      return <Credits provider={provider} />;
    default:
      return null;
  }
}

/** Every window a provider can report, in the order they are shown. Which of them a reading
 * actually carries depends on the plan: a Codex Go or free account has only the monthly window,
 * and OpenAI has switched the 5-hour one off for a plan before, so none of the three is assumed. */
function windowEntries(provider: ProviderUsage) {
  return [
    { label: "Short window", span: "5 hours", duration: fiveHourSeconds, window: provider.five_hour },
    { label: "Long window", span: "7 days", duration: sevenDaySeconds, window: provider.seven_day },
    { label: "Monthly window", span: "30 days", duration: monthlySeconds, window: provider.monthly },
  ];
}

function ProviderSection({ id, provider }: { id: ProviderId; provider: ProviderUsage }) {
  const name = providerNames[id];
  const degraded = provider.status === "auth_missing" || provider.status === "error" || provider.status === "stale";
  const windows = windowEntries(provider);
  const reported = windows.filter(({ duration, window }) => window.limit_window_seconds === duration);
  // A reading that came back with no window at all still has to say so, in one placeholder rather
  // than one per window the account might have had.
  const entries = reported.length > 0 ? reported : windows.slice(0, 1);
  return (
    <div className="provider">
      <div className="provider-row">
        <ProviderIcon id={id} />
        <h2 className="provider-name">{name}</h2>
        <span className="provider-status" data-tone={statusTone(provider)}>
          {statusLine(provider)}
        </span>
      </div>
      {degraded && (
        <p className="notice" role="status">
          {provider.error_message ?? "The last successful reading remains visible."}
        </p>
      )}
      {entries.map((entry) => (
        <Entry key={entry.label} {...entry} />
      ))}
      <Extras id={id} provider={provider} />
    </div>
  );
}

function App() {
  const [page, setPage] = useState<"allowance" | "settings">("allowance");
  const [snapshot, setSnapshot] = useState<UsageSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try {
      setSnapshot(await invoke<UsageSnapshot>("refresh_usage"));
      setSnapshotError(false);
    } finally {
      setRefreshing(false);
    }
  };

  // The listener is attached before the cache is read. The startup refresh publishes while the
  // webview is still loading, and a snapshot landing between the two reads would otherwise be
  // lost, leaving the window empty until the next refresh.
  useEffect(() => {
    let mounted = true;
    let stop: (() => void) | undefined;
    void listen<UsageSnapshot>("usage-snapshot", (event) => {
      if (mounted) {
        setSnapshot(event.payload);
        setSnapshotError(false);
      }
    })
      .then((unlisten) => {
        if (mounted) stop = unlisten;
        else unlisten();
        return invoke<UsageSnapshot>("cached_usage");
      })
      .then(
        (cached) => {
          if (mounted) setSnapshot((current) => current ?? cached);
        },
        () => {
          if (mounted) setSnapshotError(true);
        },
      );
    return () => {
      mounted = false;
      stop?.();
    };
  }, []);

  const shown = snapshot ? providerIds.filter((id) => snapshot.enabled[id]) : [];
  const updated = snapshot && Math.max(0, ...shown.map((id) => snapshot[id].last_successful_update_epoch ?? 0));

  return (
    <main>
      {page === "settings" ? (
        <SettingsPage
          providers={snapshot?.enabled ?? (snapshotError ? "unavailable" : "loading")}
          onProviderChange={setSnapshot}
          onBack={() => setPage("allowance")}
        />
      ) : (
        <>
          <header>
            <div>
              <h1>Allowance</h1>
              <p className="status">
                {snapshot
                  ? lastUpdate(updated || null)
                  : snapshotError
                    ? "Could not load provider settings"
                    : "Loading provider settings"}
              </p>
            </div>
            <div className="header-actions">
              <button onClick={() => setPage("settings")}>Settings</button>
              <button onClick={() => void refresh()} disabled={refreshing || !snapshot} aria-busy={refreshing}>
                {refreshing ? "Refreshing" : "Refresh"}
              </button>
            </div>
          </header>

          {snapshot && shown.length === 0 && <p className="empty">No providers are on. Turn one on in Settings.</p>}

          {snapshot && shown.map((id) => <ProviderSection key={id} id={id} provider={snapshot[id]} />)}

          <footer>Auto-refreshes every 5 minutes</footer>
        </>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
