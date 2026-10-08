import { useEffect, useState } from "react";
import { version } from "../../package.json";
import { remoteRouteNames, remoteRoutes } from "../shared/ipc";
import type { HostLink, RemoteAccess, RemoteRoute } from "../shared/ipc";
import { providerIds, providerNames, signInSources } from "../shared/usage";
import type { ProviderId, SignInSettings, SignInSource, UsageSnapshot } from "../shared/usage";
import { BusyButton } from "./busy";
import type { Loadable } from "./busy";
import { ConnectRows, HostRows } from "./host-link";
import { PaceSettingsRows } from "./pace-settings";
import { PairedDevicesRows } from "./paired-devices";
import { ProviderIcon } from "./provider-icon";
import { ProxyHubSettingsRows } from "./proxy-hub-settings";
import { QrCode } from "./qr-code";
import { SettingPending, Toggle } from "./settings-controls";
import { TrayUsageRows } from "./tray-usage-settings";
import { UpdateNotice } from "./update-notice";
import { WindowStartRows } from "./window-start-settings";

/** The provider choice, or why it cannot be shown yet. */
export type ProviderChoice = Loadable<Record<ProviderId, boolean>>;

/** Switching a provider off stops the polling for it and drops it from the allowance view. */
function ProviderRow({
  id,
  choice,
  onChange,
}: {
  id: ProviderId;
  choice: ProviderChoice;
  onChange: (snapshot: UsageSnapshot) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const name = providerNames[id];

  // The main process persists the choice and publishes the new snapshot before it refreshes the provider it
  // just switched on, so the switch follows that event rather than waiting out the request.
  const toggle = (enabled: boolean) => {
    setError(null);
    void window.tantalus
      .invoke("setProviderEnabled", id, enabled)
      .then(onChange, () => setError(`Could not save the ${name} setting.`));
  };

  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>
            <ProviderIcon id={id} />
            {name}
          </h2>
          <p>Show {name} usage in the allowance view and poll it every 5 minutes.</p>
        </div>
        {typeof choice === "string" ? (
          <SettingPending failed={choice === "unavailable"} />
        ) : (
          <Toggle label={name} checked={choice[id]} onToggle={() => toggle(!choice[id])} />
        )}
      </section>
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

const signInCopy = {
  windows: {
    name: "Windows",
    description: "Read Codex, Claude and Opencode sign-ins from your Windows user folder.",
  },
  wsl: {
    name: "WSL",
    description:
      "Read sign-ins from the home folders of every WSL distribution. Reading a distribution that is not running starts it.",
  },
} satisfies Record<SignInSource, { name: string; description: string }>;

/** Where a Windows host reads sign-ins from. Every sign-in found shows as its own account. */
function SignInRow({
  source,
  settings,
  onChange,
}: {
  source: SignInSource;
  settings: SignInSettings;
  onChange: (snapshot: UsageSnapshot) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const { name, description } = signInCopy[source];

  const toggle = (enabled: boolean) => {
    setError(null);
    void window.tantalus
      .invoke("setSignInSource", source, enabled)
      .then(onChange, () => setError(`Could not save the ${name} setting.`));
  };

  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>{name}</h2>
          <p>{description}</p>
        </div>
        <Toggle label={name} checked={settings[source]} onToggle={() => toggle(!settings[source])} />
      </section>
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** Shown only where there is WSL to choose. */
function SignInRows({
  snapshot,
  onChange,
}: {
  snapshot: UsageSnapshot | null;
  onChange: (snapshot: UsageSnapshot) => void;
}) {
  const settings = snapshot?.sign_ins;
  if (!settings) return null;
  return signInSources.map((source) => (
    <SignInRow key={source} source={source} settings={settings} onChange={onChange} />
  ));
}

const remoteRouteDescriptions: Record<RemoteRoute, string> = {
  localNetwork:
    "Open this page from a paired device on the same network. The connection is not encrypted, so use it only on a network you trust.",
  tailscale: "Serve this page over HTTPS to paired devices on your tailnet.",
};

type RemoteAccessState = Loadable<RemoteAccess>;

/** Read on every visit, since the machine's addresses can change between one visit and the next. */
function RemoteAccessRows() {
  const [access, setAccess] = useState<RemoteAccessState>("loading");
  const [saving, setSaving] = useState<RemoteRoute | null>(null);
  const [error, setError] = useState<{ route: RemoteRoute; message: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.tantalus.invoke("remoteAccess").then(
      (read) => {
        if (mounted) setAccess(read);
      },
      () => {
        if (mounted) setAccess("unavailable");
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  const toggle = async (route: RemoteRoute, enabled: boolean) => {
    setSaving(route);
    setError(null);
    try {
      setAccess(await window.tantalus.invoke("setRemoteAccess", route, enabled));
    } catch (reason) {
      setError({ route, message: reason instanceof Error ? reason.message : "Could not change remote access." });
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      {remoteRoutes.map((route) => (
        <RemoteRow
          key={route}
          route={route}
          access={access}
          saving={saving !== null}
          error={error?.route === route ? error.message : null}
          onToggle={(enabled) => void toggle(route, enabled)}
        />
      ))}
      {typeof access !== "string" && access.error && (
        <p className="notice settings-notice" role="alert">
          {access.error}
        </p>
      )}
    </>
  );
}

function RemoteUrl({ url }: { url: string }) {
  const [showQr, setShowQr] = useState(false);
  return (
    <div className="setting-url">
      <p>
        {url}
        <button
          className="qr-toggle"
          aria-label={`${showQr ? "Hide QR" : "QR"} code for ${url}`}
          aria-expanded={showQr}
          onClick={() => setShowQr((shown) => !shown)}
        >
          {showQr ? "Hide QR" : "QR"}
        </button>
      </p>
      {showQr && <QrCode value={url} />}
    </div>
  );
}

function RemoteRow({
  route,
  access,
  saving,
  error,
  onToggle,
}: {
  route: RemoteRoute;
  access: RemoteAccessState;
  saving: boolean;
  error: string | null;
  onToggle: (enabled: boolean) => void;
}) {
  const name = remoteRouteNames[route];
  const description = remoteRouteDescriptions[route];
  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>{name}</h2>
          <p>{description}</p>
          {typeof access !== "string" && access[route].urls.map((url) => <RemoteUrl key={url} url={url} />)}
        </div>
        {typeof access === "string" ? (
          <SettingPending failed={access === "unavailable"} />
        ) : (
          <Toggle
            label={name}
            checked={access[route].enabled}
            busy={saving}
            onToggle={() => onToggle(!access[route].enabled)}
          />
        )}
      </section>
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

/** The running version and a manual check. A found release is offered by the update notice,
 * which the main process's announcement reaches the same way as a background check. */
function VersionRow() {
  const [check, setCheck] = useState<"idle" | "checking" | "latest">("idle");
  const [error, setError] = useState<string | null>(null);

  const checkForUpdate = async () => {
    setCheck("checking");
    setError(null);
    try {
      const update = await window.tantalus.invoke("checkForUpdate");
      setCheck(update ? "idle" : "latest");
    } catch (reason) {
      setCheck("idle");
      setError(reason instanceof Error ? reason.message : "Could not check for updates.");
    }
  };

  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>
            Version <strong className="version">v{version}</strong>
          </h2>
          {check === "latest" && <p>You have the latest version.</p>}
          <p>Dragon and tortoise icons by Delapouite, from game-icons.net, under CC BY 3.0.</p>
        </div>
        <BusyButton
          label="Check for updates"
          busyLabel="Checking"
          busy={check === "checking"}
          onClick={() => void checkForUpdate()}
        />
      </section>
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
      <UpdateNotice />
    </>
  );
}

function OpenAtLoginRow() {
  const [startupEnabled, setStartupEnabled] = useState<boolean | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [savingStartup, setSavingStartup] = useState(false);

  // The registration lives in the operating system, so it is read on every visit rather than
  // cached: it can change from outside the app between one visit and the next.
  useEffect(() => {
    let mounted = true;
    void window.tantalus.invoke("openAtLogin").then(
      (enabled) => {
        if (mounted) setStartupEnabled(enabled);
      },
      () => {
        if (mounted) setStartupError("Could not read the startup setting.");
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  const toggleStartup = async () => {
    if (startupEnabled === null) return;
    const nextEnabled = !startupEnabled;
    setSavingStartup(true);
    setStartupError(null);
    try {
      await window.tantalus.invoke("setOpenAtLogin", nextEnabled);
      setStartupEnabled(nextEnabled);
    } catch {
      setStartupError(nextEnabled ? "Could not turn on opening at login." : "Could not turn off opening at login.");
    } finally {
      setSavingStartup(false);
    }
  };

  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>Open at login</h2>
          <p>Tantalus starts in the tray when you sign in, without opening its window.</p>
        </div>
        {startupEnabled === null ? (
          <SettingPending failed={startupError !== null} />
        ) : (
          <Toggle
            label="Open at login"
            checked={startupEnabled}
            busy={savingStartup}
            onToggle={() => void toggleStartup()}
          />
        )}
      </section>
      {startupError && (
        <p className="notice settings-notice" role="alert">
          {startupError}
        </p>
      )}
    </>
  );
}

/** While following a host, only this machine's own settings show. The rest belong to the host. */
export function SettingsPage({
  providers,
  snapshot,
  hostLink,
  onSnapshot,
  onBack,
}: {
  providers: ProviderChoice;
  snapshot: UsageSnapshot | null;
  hostLink: HostLink | null;
  onSnapshot: (snapshot: UsageSnapshot) => void;
  onBack: () => void;
}) {
  return (
    <>
      <header>
        <h1>Settings</h1>
        <button onClick={onBack}>Back</button>
      </header>

      <div className="settings-list">
        {hostLink ? (
          <HostRows link={hostLink} />
        ) : (
          <>
            {providerIds.map((id) => (
              <ProviderRow key={id} id={id} choice={providers} onChange={onSnapshot} />
            ))}

            <SignInRows snapshot={snapshot} onChange={onSnapshot} />

            <ProxyHubSettingsRows />

            <PaceSettingsRows snapshot={snapshot} failed={providers === "unavailable"} onSnapshot={onSnapshot} />

            <WindowStartRows snapshot={snapshot} />
          </>
        )}

        <TrayUsageRows snapshot={snapshot} />

        <OpenAtLoginRow />

        {!hostLink && (
          <>
            <ConnectRows />

            <RemoteAccessRows />

            <PairedDevicesRows />
          </>
        )}

        <VersionRow />
      </div>
    </>
  );
}
