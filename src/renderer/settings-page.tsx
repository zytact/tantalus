import { useEffect, useState } from "react";
import { version } from "../../package.json";
import { providerIds, providerNames } from "../shared/usage";
import type { ProviderId, UsageSnapshot } from "../shared/usage";
import { ProviderIcon } from "./provider-icon";
import { UpdateNotice } from "./update-notice";

/** The provider choice, or why it cannot be shown yet. */
export type ProviderChoice = Record<ProviderId, boolean> | "loading" | "unavailable";

/** The switch every settings row uses. */
function Toggle({
  label,
  checked,
  busy = false,
  onToggle,
}: {
  label: string;
  checked: boolean;
  busy?: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      className="setting-toggle"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-busy={busy}
      disabled={busy}
      onClick={onToggle}
    >
      <span className="setting-state">{busy ? "Saving" : checked ? "On" : "Off"}</span>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
    </button>
  );
}

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
          <span className="setting-state">{choice === "loading" ? "Checking" : "Unavailable"}</span>
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
        </div>
        <button onClick={() => void checkForUpdate()} disabled={check === "checking"} aria-busy={check === "checking"}>
          {check === "checking" ? "Checking" : "Check for updates"}
        </button>
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

export function SettingsPage({
  providers,
  onProviderChange,
  onBack,
}: {
  providers: ProviderChoice;
  onProviderChange: (snapshot: UsageSnapshot) => void;
  onBack: () => void;
}) {
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
    if (startupEnabled === null || savingStartup) return;
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
      <header>
        <h1>Settings</h1>
        <button onClick={onBack}>Back</button>
      </header>

      <div className="settings-list">
        {providerIds.map((id) => (
          <ProviderRow key={id} id={id} choice={providers} onChange={onProviderChange} />
        ))}

        <section className="setting-row">
          <div className="setting-copy">
            <h2>Open at login</h2>
            <p>Tantalus starts in the tray when you sign in, without opening its window.</p>
          </div>
          {startupEnabled === null ? (
            <span className="setting-state">{startupError ? "Unavailable" : "Checking"}</span>
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

        <VersionRow />
      </div>
    </>
  );
}
