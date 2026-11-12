import "@fontsource-variable/inter-tight/wght.css";
import "@fontsource/newsreader/latin-400.css";
import "@fontsource/newsreader/latin-500.css";
import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { firstRider } from "../shared/pace";
import type { Creature, PaceSnapshot } from "../shared/pace";
import { providerPools } from "../shared/pool";
import { clockEpoch, proxyHubManagementUrl, refreshedAgo, refreshedEpoch } from "../shared/usage";
import type { ProxyHubSnapshot, ProxyHubStatus, UsageSnapshot } from "../shared/usage";
import type { HostLink, UsageSource } from "../shared/ipc";
import { BusyButton, PendingLabel } from "./busy";
import { CreatureIcon } from "./creature-icon";
import { isRefreshShortcut } from "./presentation";
import { HostSourceBar } from "./host-link";
import { PairPage } from "./pair-page";
import { PoolSection } from "./pool-section";
import { usePublishedState } from "./published-state";
import { SettingsPage } from "./settings-page";
import { Toast } from "./toast";
import { HostUpdateCheck, UpdateNotice } from "./update-notice";
import { webBridge } from "./web-bridge";
import "./styles.css";

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

/** A hub's own state: whether it was read, the way to its management page, and what went wrong. Its
 * accounts sit in their providers' pools. `managed` hubs belong to this machine, so their management
 * page can open from here. */
function HubSection({ hub, managed }: { hub: ProxyHubSnapshot; managed: boolean }) {
  return (
    <section className="hub" aria-label={hub.label}>
      <div className="hub-row">
        <h2>{hub.label}</h2>
        <span className="provider-status" data-tone={hubStatusTones[hub.status]}>
          {hubStatusLabels[hub.status]}
        </span>
      </div>
      {managed && (
        <a
          className="management-link"
          href={proxyHubManagementUrl(hub.url)}
          aria-label={`Manage ${hub.label}`}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            event.preventDefault();
            void window.tantalus.invoke("openProxyHubManagement", hub.id);
          }}
        >
          <span>Hub</span>
          <span aria-hidden="true">↗</span>
        </a>
      )}
      <HubMessage hub={hub} />
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

/** The strips above the providers. A view of a host's usage shows only that host's update, and the
 * rest only the app window reading its own usage shows. */
function Notices({
  host,
  snapshot,
  onSnapshot,
  onSettings,
}: {
  host: string | undefined;
  snapshot: UsageSnapshot | null;
  onSnapshot: (snapshot: UsageSnapshot) => void;
  onSettings: () => void;
}) {
  if (host !== undefined) return <UpdateNotice host={host} />;
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
/** What a browser calls the host serving its page, whose machine name it never reads. */
const BROWSER_HOST = "the host";
/** The followed host whose usage the app window shows, or undefined while it shows its own. */
const followedHost = (link: HostLink | null, source: UsageSource | null) =>
  link && source !== "local" ? link.host : undefined;

/** When the shown usage was read, and on which followed host. */
function RefreshStatus({
  snapshot,
  failed,
  now,
  host,
}: {
  snapshot: UsageSnapshot | null;
  failed: boolean;
  now: number;
  host: string | undefined;
}) {
  return (
    <p className="status">
      {snapshot ? (
        `${refreshedAgo(refreshedEpoch(snapshot), now)}${host ? ` on ${host}` : ""}`
      ) : (
        <PendingLabel
          failed={failed}
          failedLabel="Could not load provider settings"
          pendingLabel="Loading provider settings"
        />
      )}
    </p>
  );
}

function App() {
  const [page, setPage] = useState<"allowance" | "settings">("allowance");
  const [snapshot, setSnapshot, snapshotError] = usePublishedState("usageSnapshot");
  const [hostLink] = usePublishedState("hostLink");
  const [source] = usePublishedState("usageSource");
  const followed = followedHost(hostLink, source);
  const host = followed ?? (remote ? BROWSER_HOST : undefined);
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

  return (
    <main>
      {!remote && <Toast />}
      {page === "settings" ? (
        <SettingsPage
          providers={snapshot?.enabled ?? (snapshotError ? "unavailable" : "loading")}
          snapshot={snapshot}
          hostLink={hostLink}
          hostShown={followed !== undefined}
          onSnapshot={setSnapshot}
          onBack={() => setPage("allowance")}
        />
      ) : (
        <>
          <header>
            <div>
              <h1>Allowance</h1>
              <RefreshStatus snapshot={snapshot} failed={snapshotError} now={now} host={followed} />
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

          {hostLink && <HostSourceBar link={hostLink} hostShown={followed !== undefined} snapshot={snapshot} />}

          <Notices host={host} snapshot={snapshot} onSnapshot={setSnapshot} onSettings={() => setPage("settings")} />

          {snapshot && snapshot.accounts.length === 0 && snapshot.proxy_hubs.length === 0 && (
            <p className="empty">No providers are on. Turn one on in Settings.</p>
          )}

          {snapshot &&
            providerPools(snapshot).map((pool) => (
              <PoolSection
                key={pool.provider}
                pool={pool}
                now={now}
                paces={snapshot.pace.windows}
                starts={snapshot.window_starts}
              />
            ))}

          {snapshot &&
            snapshot.proxy_hubs.map((hub) => <HubSection key={hub.id} hub={hub} managed={host === undefined} />)}

          {remote && (
            <HostUpdateCheck host={BROWSER_HOST} onFound={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
          )}

          <footer>Auto-refreshes every 5 minutes</footer>
        </>
      )}
    </main>
  );
}

// The first frame waits for the bundled faces, since drawing it in a fallback face reflows the page a
// frame later.
await Promise.all(["1em 'Inter Tight Variable'", "500 1em Newsreader"].map((font) => document.fonts.load(font)));
/** A browser that is not paired, or whose device was removed, gets a 401 and pairs first. The bridge
 * waits for that answer, since its stream reloads the page when the host refuses it. */
const answer = remote
  ? await fetch("/api/current/serverEpoch").then(
      ({ status }) => status,
      () => null,
    )
  : null;
const paired = answer !== 401;
if (remote && paired) window.tantalus = webBridge();
createRoot(document.getElementById("root")!).render(paired ? <App /> : <PairPage />);
