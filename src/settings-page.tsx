import { getVersion } from "@tauri-apps/api/app";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { useEffect, useState } from "react";

export function SettingsPage({ onBack }: { onBack: () => void }) {
  const [version, setVersion] = useState<string | null>(null);
  const [versionUnavailable, setVersionUnavailable] = useState(false);
  const [startupEnabled, setStartupEnabled] = useState<boolean | null>(null);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [savingStartup, setSavingStartup] = useState(false);

  useEffect(() => {
    let mounted = true;
    void getVersion().then(
      (currentVersion) => {
        if (mounted) setVersion(currentVersion);
      },
      () => {
        if (mounted) setVersionUnavailable(true);
      },
    );
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
        <section className="setting-row">
          <div className="setting-copy">
            <h2>Open at login</h2>
            <p>Start Tantalus when you sign in to this computer.</p>
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
            <p>The version of Tantalus installed on this computer.</p>
          </div>
          <strong className="version">
            {versionUnavailable ? "Unavailable" : version ? `v${version}` : "Loading"}
          </strong>
        </section>
      </div>
    </>
  );
}
