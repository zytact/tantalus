import "@fontsource-variable/inter-tight/wght.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import { Fragment, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { firstRider, paceKey, riderOf } from "../shared/pace";
import type { Creature, PaceSnapshot, Rider, WindowPace } from "../shared/pace";
import { clockEpoch, providerIds, providerNames, refreshedAgo, refreshedEpoch, usagePace } from "../shared/usage";
import type {
  ExtraUsage,
  ProviderId,
  ProviderUsage,
  ProxyHubSnapshot,
  ProxyHubStatus,
  UsageSnapshot,
  WindowUsage,
} from "../shared/usage";
import { BusyButton, PendingLabel } from "./busy";
import { CreatureIcon } from "./creature-icon";
import {
  absoluteTime,
  countdown,
  creatureTip,
  creditAmount,
  creditExpiry,
  isRefreshShortcut,
  providerExtras,
  remainingPercent,
  statusLine,
  statusTone,
  subscriptionDate,
  usagePercent,
  usageTier,
  usageValueText,
  windowEntries,
} from "./presentation";
import { ProviderIcon } from "./provider-icon";
import { usePublishedState } from "./published-state";
import { SettingsPage } from "./settings-page";
import { UpdateNotice } from "./update-notice";
import { webBridge } from "./web-bridge";
import "./styles.css";

/** One window as a ledger entry: headline figure, consumption rule, then the supporting facts. */
function Entry({
  label,
  span,
  duration,
  now,
  window: usage,
  speed,
}: {
  label: string;
  span: string;
  duration: number;
  now: number;
  window: WindowUsage;
  speed: WindowPace | undefined;
}) {
  const reported = usage.limit_window_seconds === duration;
  const used = reported ? usage.used_percent : null;
  const pace = reported ? usagePace(usage, now) : null;
  const rider = riderOf(speed);
  const entryLabel = reported ? label : "Window unavailable";
  return (
    <section className="entry" aria-label={entryLabel} data-reported={reported}>
      <div className="entry-head">
        <div className="entry-title">
          <h3>
            {entryLabel}
            <i>{reported ? span : "unrecognized duration"}</i>
          </h3>
          {pace && (
            <span className="pace" data-pace={pace.status}>
              {pace.label}
            </span>
          )}
        </div>
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
        aria-valuetext={usageValueText(used, pace, rider)}
      >
        <span className="rule-fill" style={{ width: `${Math.min(100, Math.max(0, used ?? 0))}%` }} />
        {pace && <span className="pace-marker" style={{ left: `${pace.expectedPercent}%` }} aria-hidden="true" />}
        <CreatureRider rider={rider} used={used} resetAt={usage.reset_at_epoch} now={now} />
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

const creatureNames = { dragon: "Dragon", tortoise: "Tortoise" } satisfies Record<Creature, string>;

/** Rides the bar at the fill head. The tooltip opens on hover and on focus, and slides along with the
 * head so it stays over the bar at either end. */
function CreatureRider({
  rider,
  used,
  resetAt,
  now,
}: {
  rider: Rider | null;
  used: number | null;
  resetAt: number | null;
  now: number;
}) {
  if (!rider || used === null) return null;
  const head = Math.min(100, Math.max(0, used));
  const tip = creatureTip(rider, used, resetAt, now);
  return (
    <span
      className="creature"
      data-kind={rider.kind}
      style={{ left: `${head}%` }}
      tabIndex={0}
      role="img"
      aria-label={`${creatureNames[rider.kind]}: ${tip}`}
    >
      <CreatureIcon kind={rider.kind} />
      <span className="creature-tip" style={{ transform: `translateX(-${head}%)` }} aria-hidden="true">
        {tip}
      </span>
    </span>
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
        <strong className="figure">{creditAmount(extra.used_credits, extra)}</strong>
      </div>
      <ol className="credits">
        <li>
          <span>Monthly limit</span>
          <span className="credit-value">{creditAmount(extra.monthly_limit, extra)}</span>
        </li>
      </ol>
    </section>
  );
}

/** Codex and Claude bank credits that reset a spent window early. */
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
              <span className="credit-value">{creditExpiry(credit.expires_at_epoch)}</span>
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
  return providerExtras[id].map((extra) => {
    switch (extra) {
      case "spend":
        return provider.extra_usage && <Spend key={extra} extra={provider.extra_usage} />;
      case "credits":
        return <Credits key={extra} provider={provider} />;
    }
  });
}

function ProviderSection({
  id,
  provider,
  now,
  account,
  paceOf,
}: {
  id: ProviderId;
  provider: ProviderUsage;
  now: number;
  account?: { email: string | null; plan: string | null; label?: string };
  paceOf: (duration: number) => WindowPace | undefined;
}) {
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
        <h2 className="provider-name">
          {name}
          {account && <AccountDetail {...account} label={account.label ?? name} />}
        </h2>
        <span className="provider-status" data-tone={statusTone(provider)}>
          {statusLine(provider)}
        </span>
      </div>
      {id === "codex" &&
        provider.subscription_active_until_epoch !== null &&
        provider.subscription_active_until_epoch > now && (
          <p className="subscription-date">
            Subscription period ends{" "}
            <time dateTime={new Date(provider.subscription_active_until_epoch * 1000).toISOString()}>
              {subscriptionDate(provider.subscription_active_until_epoch)}
            </time>
          </p>
        )}
      <LearningLine windows={reported} paceOf={paceOf} />
      {degraded && (
        <p className="notice" role="status">
          {provider.error_message ?? "The last successful reading remains visible."}
        </p>
      )}
      {entries.map((entry) => (
        <Entry key={entry.label} {...entry} now={now} speed={paceOf(entry.duration)} />
      ))}
      <Extras id={id} provider={provider} />
    </div>
  );
}

/** One sentence per window still learning its usual pace, saying when it is done. */
function LearningLine({
  windows,
  paceOf,
}: {
  windows: { label: string; duration: number }[];
  paceOf: (duration: number) => WindowPace | undefined;
}) {
  const learning = windows.flatMap(({ label, duration }) => {
    const pace = paceOf(duration);
    return pace?.status === "learning" ? [{ label, until: pace.until }] : [];
  });
  if (learning.length === 0) return null;
  return (
    <p className="subscription-date">
      Learning your usual pace.
      {learning.map(({ label, until }) => (
        <Fragment key={label}>
          {" "}
          The {label.toLowerCase()}{" "}
          {until.kind === "time" ? (
            <>
              is done <time dateTime={new Date(until.epoch * 1000).toISOString()}>{absoluteTime(until.epoch)}</time>
            </>
          ) : until.in_use ? (
            "needs a little more use to finish"
          ) : (
            "starts when you next use it"
          )}
          .
        </Fragment>
      ))}
    </p>
  );
}

function AccountDetail({ email, plan, label }: { email: string | null; plan: string | null; label: string }) {
  const separator = email !== null && plan !== null ? " · " : "";
  return (
    <small className="account-detail">
      {email === null ? null : <Email key={email} email={email} label={label} />}
      <span className="account-plan">
        {separator}
        {plan}
      </span>
    </small>
  );
}

function Email({ email, label }: { email: string; label: string }) {
  const [visible, setVisible] = useState(false);
  return (
    <button
      className="account-email"
      data-visible={visible}
      aria-label={visible ? `${email}, hide email for ${label}` : `Show email for ${label}`}
      aria-pressed={visible}
      title={visible ? "Hide email" : "Show email"}
      onClick={() => setVisible((shown) => !shown)}
    >
      <span aria-hidden={!visible}>{email}</span>
    </button>
  );
}

const hubStatusLabels = {
  loading: "Loading",
  ready: "Live",
  stale: "Cached",
  error: "Could not refresh",
  rejected: "Access refused",
} satisfies Record<ProxyHubStatus, string>;

const hubStatusTones = {
  loading: "warn",
  ready: "ok",
  stale: "warn",
  error: "danger",
  rejected: "danger",
} satisfies Record<ProxyHubStatus, "ok" | "warn" | "danger">;

function HubSection({ hub, now, paces }: { hub: ProxyHubSnapshot; now: number; paces: PaceSnapshot["windows"] }) {
  return (
    <section className="hub">
      <div className="hub-row">
        <h2>{hub.label}</h2>
        <span className="provider-status" data-tone={hubStatusTones[hub.status]}>
          {hubStatusLabels[hub.status]}
        </span>
      </div>
      <HubMessage hub={hub} />
      <HubAccounts hub={hub} now={now} paces={paces} />
    </section>
  );
}

function HubMessage({ hub }: { hub: ProxyHubSnapshot }) {
  const messages = {
    loading: null,
    ready: hub.accounts.length === 0 ? <p className="empty">No supported accounts found.</p> : null,
    stale: (
      <p className="notice" role="status">
        {hub.error_message}
      </p>
    ),
    error: (
      <p className="notice" role="status">
        {hub.error_message}
      </p>
    ),
    rejected: (
      <p className="notice" role="status">
        {hub.error_message} Tantalus stopped reading this hub. Edit it in Settings with the right key, or switch it off
        and on once the hub allows access.
      </p>
    ),
  } satisfies Record<ProxyHubStatus, React.ReactNode>;
  return messages[hub.status];
}

function HubAccounts({ hub, now, paces }: { hub: ProxyHubSnapshot; now: number; paces: PaceSnapshot["windows"] }) {
  return hub.accounts.map((account, index) => (
    <ProviderSection
      key={`${account.provider}:${account.id}`}
      id={account.provider}
      provider={account.usage}
      now={now}
      account={{
        email: account.email,
        plan: account.plan,
        label: `${hub.label} ${providerNames[account.provider]} account ${index + 1}`,
      }}
      paceOf={(duration) => paces[paceKey(duration, account.provider, { hubId: hub.id, accountId: account.id })]}
    />
  ));
}

/** The strips above the providers, which only the app window shows. */
function Notices({
  snapshot,
  onSnapshot,
  onSettings,
}: {
  snapshot: UsageSnapshot | null;
  onSnapshot: (snapshot: UsageSnapshot) => void;
  onSettings: () => void;
}) {
  return (
    <>
      <UpdateNotice />
      {snapshot && <PaceExplainer pace={snapshot.pace} onSnapshot={onSnapshot} onSettings={onSettings} />}
    </>
  );
}

const paceDirection = { dragon: "faster", tortoise: "slower" } satisfies Record<Creature, string>;

/** Shown once, the first time either creature appears, until it is dismissed either way. A failed save
 * leaves it up, which is the retry. */
function PaceExplainer({
  pace: { settings, windows },
  onSnapshot,
  onSettings,
}: {
  pace: PaceSnapshot;
  onSnapshot: (snapshot: UsageSnapshot) => void;
  onSettings: () => void;
}) {
  const kind = settings.explained ? null : firstRider(windows)?.kind;
  if (!kind) return null;
  const dismiss = () =>
    window.tantalus.invoke("setPaceSettings", { ...settings, explained: true }).then(onSnapshot, () => {});
  return (
    <section className="update" aria-label="Dragon and tortoise">
      <div className="update-content">
        <p>
          <CreatureIcon kind={kind} className="inline-creature" />
          The {kind} means a window is moving much {paceDirection[kind]} than you usually use it. Hover it for the
          numbers.
        </p>
        <div className="update-actions">
          <button
            className="quiet"
            onClick={() => {
              void dismiss();
              onSettings();
            }}
          >
            Settings
          </button>
          <button onClick={() => void dismiss()}>Got it</button>
        </div>
      </div>
    </section>
  );
}

/** The current epoch in seconds, re-read often enough that a minute-grained label is never more
 * than a few seconds behind. */
function useNow(useServerClock: boolean) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    let mounted = true;
    let syncing = false;
    let serverClock: { epoch: number; monotonic: number } | null = null;
    const synchronize = () => {
      if (!useServerClock || syncing) return;
      syncing = true;
      void window.tantalus
        .current("serverEpoch")
        .then((epoch) => {
          if (!mounted || epoch === null) return;
          serverClock = { epoch, monotonic: performance.now() };
          setNow(epoch);
        })
        .catch(() => {
          serverClock = null;
        })
        .finally(() => {
          syncing = false;
        });
    };
    synchronize();
    const timer = window.setInterval(() => {
      if (serverClock === null) synchronize();
      setNow(
        serverClock === null
          ? Date.now() / 1000
          : clockEpoch(serverClock.epoch, performance.now() - serverClock.monotonic),
      );
    }, 5000);
    return () => {
      mounted = false;
      window.clearInterval(timer);
    };
  }, [useServerClock]);
  return now;
}

/** A browser on another device has no preload, so it reads snapshots and refreshes over HTTP. */
const remote = !("tantalus" in window);
if (remote) window.tantalus = webBridge();

function App() {
  const [page, setPage] = useState<"allowance" | "settings">("allowance");
  const [snapshot, setSnapshot, snapshotError] = usePublishedState("usageSnapshot");
  const [refreshing, setRefreshing] = useState(false);
  const now = useNow(remote);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setSnapshot(await window.tantalus.invoke("refreshUsage"));
    } finally {
      setRefreshing(false);
    }
  }, []);

  const canRefresh = snapshot !== null && !refreshing;

  // The chord belongs to the app, so the default is cancelled whether or not a refresh can start.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isRefreshShortcut(event)) return;
      event.preventDefault();
      if (canRefresh) void refresh();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [canRefresh, refresh]);

  const shown = snapshot ? providerIds.filter((id) => snapshot.enabled[id]) : [];

  return (
    <main>
      {page === "settings" ? (
        <SettingsPage
          providers={snapshot?.enabled ?? (snapshotError ? "unavailable" : "loading")}
          snapshot={snapshot}
          onSnapshot={setSnapshot}
          onBack={() => setPage("allowance")}
        />
      ) : (
        <>
          <header>
            <div>
              <h1>Allowance</h1>
              <p className="status">
                {snapshot ? (
                  refreshedAgo(refreshedEpoch(snapshot), now)
                ) : (
                  <PendingLabel
                    failed={snapshotError}
                    failedLabel="Could not load provider settings"
                    pendingLabel="Loading provider settings"
                  />
                )}
              </p>
            </div>
            <div className="header-actions">
              {!remote && <button onClick={() => setPage("settings")}>Settings</button>}
              <BusyButton
                label="Refresh"
                busyLabel="Refreshing"
                busy={refreshing}
                disabled={snapshot === null}
                title="Refresh (Ctrl+R or Cmd+R)"
                onClick={() => void refresh()}
              />
            </div>
          </header>

          {!remote && <Notices snapshot={snapshot} onSnapshot={setSnapshot} onSettings={() => setPage("settings")} />}

          {snapshot && shown.length === 0 && snapshot.proxy_hubs.length === 0 && (
            <p className="empty">No providers are on. Turn one on in Settings.</p>
          )}

          {snapshot &&
            shown.map((id) => (
              <ProviderSection
                key={id}
                id={id}
                provider={snapshot[id]}
                now={now}
                account={{ email: snapshot[id].email, plan: snapshot[id].plan }}
                paceOf={(duration) => snapshot.pace.windows[paceKey(duration, id)]}
              />
            ))}

          {snapshot &&
            snapshot.proxy_hubs.map((hub) => (
              <HubSection key={hub.id} hub={hub} now={now} paces={snapshot.pace.windows} />
            ))}

          <footer>Auto-refreshes every 5 minutes</footer>
        </>
      )}
    </main>
  );
}

// The first frame waits for the bundled faces, since drawing it in a fallback face reflows the page a
// frame later.
await Promise.all(["1em 'Inter Tight Variable'", "500 1em Newsreader"].map((font) => document.fonts.load(font)));
createRoot(document.getElementById("root")!).render(<App />);
