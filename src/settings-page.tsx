import { invoke } from "@tauri-apps/api/core";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";
import { version } from "../src-tauri/tauri.conf.json";
import { providerIds, providerNames } from "./presentation";
import type { ProviderId, UsageSnapshot } from "./presentation";

/** Switching a provider off stops the polling for it and drops it from the allowance view. */
function ProviderRow({
  id,
  enabled,
  onChange,
}: {
  id: ProviderId;
  enabled: boolean | null;
  onChange: (snapshot: UsageSnapshot) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = providerNames[id];

  const toggle = async () => {
    if (enabled === null || saving) return;
    setSaving(true);
    setError(null);
    try {
      onChange(await invoke<UsageSnapshot>("set_provider_enabled", { provider: id, enabled: !enabled }));
    } catch {
      setError(`Could not save the ${name} setting.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>{name}</h2>
          <p>Show {name} usage in the allowance view and poll it every 5 minutes.</p>
        </div>
        {enabled === null ? (
          <span className="setting-state">Unavailable</span>
        ) : (
          <button
            className="setting-toggle"
            role="switch"
            aria-checked={enabled}
            aria-label={name}
            aria-busy={saving}
            disabled={saving}
            onClick={() => void toggle()}
          >
            <span className="setting-state">{saving ? "Saving" : enabled ? "On" : "Off"}</span>
            <span className="switch-track" aria-hidden="true">
              <span className="switch-knob" />
            </span>
          </button>
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

export function SettingsPage({
  enabled,
  onProviderChange,
  onBack,
}: {
  enabled: Record<ProviderId, boolean> | null;
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
    void isEnabled().then(
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
      await (nextEnabled ? enable() : disable());
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
          <ProviderRow key={id} id={id} enabled={enabled && enabled[id]} onChange={onProviderChange} />
        ))}

        <section className="setting-row">
          <div className="setting-copy">
            <h2>Open at login</h2>
            <p>Tantalus starts in the tray when you sign in, without opening its window.</p>
          </div>
          {startupEnabled === null ? (
            <span className="setting-state">{startupError ? "Unavailable" : "Checking"}</span>
          ) : (
            <button
              className="setting-toggle"
              role="switch"
              aria-checked={startupEnabled}
              aria-label="Open at login"
              aria-busy={savingStartup}
              disabled={savingStartup}
              onClick={() => void toggleStartup()}
            >
              <span className="setting-state">{savingStartup ? "Saving" : startupEnabled ? "On" : "Off"}</span>
              <span className="switch-track" aria-hidden="true">
                <span className="switch-knob" />
              </span>
            </button>
          )}
        </section>
        {startupError && (
          <p className="notice settings-notice" role="alert">
            {startupError}
          </p>
        )}

        <section className="setting-row">
          <div className="setting-copy">
            <h2>Version</h2>
          </div>
          <strong className="version">v{version}</strong>
        </section>
      </div>
    </>
  );
}
