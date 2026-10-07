import { useEffect, useState } from "react";
import { trayUsageColors, trayUsageOptions } from "../shared/tray-usage";
import type { TrayUsageOption, TrayUsageSettings } from "../shared/tray-usage";
import { nowEpoch, providerIds, providerNames } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { AccountName, RevealEmails } from "./account-name";
import type { Loadable } from "./busy";
import { Picker } from "./picker";
import { SettingPending, Toggle } from "./settings-controls";

/** The switch for showing one account's usage in the tray, and under it the account picker and the
 * color each provider's number is drawn in. Only the accounts Tantalus reads are offered. */
export function TrayUsageRows({ snapshot }: { snapshot: UsageSnapshot | null }) {
  const [settings, setSettings] = useState<Loadable<TrayUsageSettings>>("loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.tantalus.invoke("trayUsage").then(
      (read) => {
        if (mounted) setSettings(read);
      },
      () => {
        if (mounted) setSettings("unavailable");
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  const save = async (next: TrayUsageSettings) => {
    setSaving(true);
    setError(null);
    try {
      setSettings(await window.tantalus.invoke("setTrayUsage", next));
    } catch {
      setError("Could not save the tray usage setting.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>Usage in tray</h2>
          <p>
            Shows one account&apos;s remaining 5-hour allowance beside the tray icon, in its provider&apos;s color.
            Codex Go and free accounts show their monthly window instead. A hub&apos;s pooled option adds up its
            accounts, so three accounts start at 300% and count down to 0. On Windows the number replaces the icon.
          </p>
        </div>
        <TrayUsageToggle settings={settings} saving={saving} onSave={(next) => void save(next)} />
      </section>
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
      <TrayUsageAccounts snapshot={snapshot} settings={settings} saving={saving} onSave={(next) => void save(next)} />
    </>
  );
}

function TrayUsageToggle({
  settings,
  saving,
  onSave,
}: {
  settings: Loadable<TrayUsageSettings>;
  saving: boolean;
  onSave: (settings: TrayUsageSettings) => void;
}) {
  if (typeof settings === "string") return <SettingPending failed={settings === "unavailable"} />;
  return (
    <Toggle
      label="Usage in tray"
      checked={settings.enabled}
      busy={saving}
      onToggle={() => onSave({ ...settings, enabled: !settings.enabled })}
    />
  );
}

/** Shown while the setting is on. */
function TrayUsageAccounts({
  snapshot,
  settings,
  ...props
}: {
  snapshot: UsageSnapshot | null;
  settings: Loadable<TrayUsageSettings>;
  saving: boolean;
  onSave: (settings: TrayUsageSettings) => void;
}) {
  if (typeof settings === "string" || !settings.enabled || !snapshot) return null;
  return <TrayUsagePicker {...props} options={trayUsageOptions(snapshot, nowEpoch())} settings={settings} />;
}

/** A saved account that is no longer read stays selected, so the choice is not silently changed. */
function TrayUsagePicker({
  options,
  settings,
  saving,
  onSave,
}: {
  options: TrayUsageOption[];
  settings: TrayUsageSettings;
  saving: boolean;
  onSave: (settings: TrayUsageSettings) => void;
}) {
  if (options.length === 0) {
    return <p className="tray-usage-empty">Switch on a provider or add a hub to pick an account.</p>;
  }
  const selected = settings.source ?? options[0].key;
  const missing = !options.some(({ key }) => key === selected);
  return (
    <div className="hub-form">
      <div className="hub-form-wide">
        <Picker
          label="Account"
          value={selected}
          disabled={saving}
          options={[
            ...(missing ? [{ value: selected, label: "Account no longer available", disabled: true }] : []),
            ...options.map(({ key, name }) => ({ value: key, label: <AccountName name={name} plain /> })),
          ]}
          onChange={(source) => onSave({ ...settings, source })}
        />
      </div>
      <div className="tray-usage-footer hub-form-wide">
        <TrayUsageLegend options={options} />
        <RevealEmails emails={options.flatMap(({ name }) => (name.email === null ? [] : [name.email]))} />
      </div>
    </div>
  );
}

/** The color of each provider on offer. */
function TrayUsageLegend({ options }: { options: TrayUsageOption[] }) {
  return (
    <ul className="tray-usage-legend" aria-label="Tray colors">
      {providerIds
        .filter((provider) => options.some((option) => option.provider === provider))
        .map((provider) => (
          <li key={provider}>
            <span className="tray-usage-swatch" style={{ background: trayUsageColors[provider] }} />
            {providerNames[provider]}
          </li>
        ))}
    </ul>
  );
}
