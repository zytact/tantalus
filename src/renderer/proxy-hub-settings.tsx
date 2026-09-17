import { useEffect, useState } from "react";
import type { ProxyHubSettings } from "../shared/usage";
import type { Loadable } from "./busy";
import { SettingPending, Toggle } from "./settings-controls";

export function ProxyHubSettingsRows() {
  const [hubs, setHubs] = useState<Loadable<ProxyHubSettings[]>>("loading");
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [managementKey, setManagementKey] = useState("");

  useEffect(() => {
    let mounted = true;
    void window.tantalus.invoke("proxyHubs").then(
      (settings) => {
        if (mounted) setHubs(settings);
      },
      () => {
        if (mounted) setHubs("unavailable");
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  const add = async () => {
    setSaving("new");
    setError(null);
    try {
      setHubs(await window.tantalus.invoke("addProxyHub", { label, url, managementKey }));
      setLabel("");
      setUrl("");
      setManagementKey("");
      setAdding(false);
    } catch (reason) {
      setError(errorMessage(reason, "Could not add the proxy hub."));
    } finally {
      setSaving(null);
    }
  };

  const toggle = async (hub: ProxyHubSettings) => {
    setSaving(hub.id);
    setError(null);
    try {
      setHubs(await window.tantalus.invoke("setProxyHubEnabled", hub.id, !hub.enabled));
    } catch (reason) {
      setError(errorMessage(reason, "Could not change the proxy hub."));
    } finally {
      setSaving(null);
    }
  };

  const remove = async (hub: ProxyHubSettings) => {
    setSaving(hub.id);
    setError(null);
    try {
      setHubs(await window.tantalus.invoke("removeProxyHub", hub.id));
    } catch (reason) {
      setError(errorMessage(reason, "Could not remove the proxy hub."));
    } finally {
      setSaving(null);
    }
  };

  return (
    <>
      <HubHeading hubs={hubs} adding={adding} onToggle={() => setAdding((shown) => !shown)} />
      <HubRows hubs={hubs} saving={saving} onToggle={toggle} onRemove={remove} />
      <HubForm
        visible={adding && typeof hubs !== "string"}
        busy={saving !== null}
        submitting={saving === "new"}
        label={label}
        url={url}
        managementKey={managementKey}
        onLabel={setLabel}
        onUrl={setUrl}
        onManagementKey={setManagementKey}
        onSubmit={add}
      />
      <SettingsError error={error} />
    </>
  );
}

function HubHeading({
  hubs,
  adding,
  onToggle,
}: {
  hubs: Loadable<ProxyHubSettings[]>;
  adding: boolean;
  onToggle: () => void;
}) {
  return (
    <section className="setting-row hub-heading">
      <div className="setting-copy">
        <h2>Proxy hubs</h2>
        <p>Show every Codex and Claude account pooled by a CLIProxyAPI hub.</p>
      </div>
      {typeof hubs === "string" ? (
        <SettingPending failed={hubs === "unavailable"} />
      ) : (
        <button onClick={onToggle}>{adding ? "Cancel" : "Add hub"}</button>
      )}
    </section>
  );
}

function HubRows({
  hubs,
  saving,
  onToggle,
  onRemove,
}: {
  hubs: Loadable<ProxyHubSettings[]>;
  saving: string | null;
  onToggle: (hub: ProxyHubSettings) => Promise<void>;
  onRemove: (hub: ProxyHubSettings) => Promise<void>;
}) {
  if (typeof hubs === "string") return null;
  return hubs.map((hub) => (
    <section className="setting-row" key={hub.id}>
      <div className="setting-copy">
        <h2>{hub.label}</h2>
        <p>{hub.url}</p>
      </div>
      <div className="hub-controls">
        <Toggle
          label={`${hub.label} proxy hub`}
          checked={hub.enabled}
          busy={saving !== null}
          onToggle={() => void onToggle(hub)}
        />
        <button disabled={saving !== null} onClick={() => void onRemove(hub)}>
          Remove
        </button>
      </div>
    </section>
  ));
}

function HubForm({
  visible,
  busy,
  submitting,
  label,
  url,
  managementKey,
  onLabel,
  onUrl,
  onManagementKey,
  onSubmit,
}: {
  visible: boolean;
  busy: boolean;
  submitting: boolean;
  label: string;
  url: string;
  managementKey: string;
  onLabel: (value: string) => void;
  onUrl: (value: string) => void;
  onManagementKey: (value: string) => void;
  onSubmit: () => Promise<void>;
}) {
  if (!visible) return null;
  return (
    <form
      className="hub-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit();
      }}
    >
      <label>
        Hub URL
        <input
          type="url"
          required
          placeholder="http://127.0.0.1:8317"
          value={url}
          onChange={(event) => onUrl(event.target.value)}
          autoFocus
        />
      </label>
      <label>
        Management key
        <input
          type="password"
          required
          autoComplete="off"
          value={managementKey}
          onChange={(event) => onManagementKey(event.target.value)}
        />
      </label>
      <label>
        Label <span className="optional-label">Optional</span>
        <input value={label} onChange={(event) => onLabel(event.target.value)} />
      </label>
      <button disabled={busy} type="submit">
        {submitting ? "Adding" : "Add hub"}
      </button>
    </form>
  );
}

function SettingsError({ error }: { error: string | null }) {
  return error ? (
    <p className="notice settings-notice" role="alert">
      {error}
    </p>
  ) : null;
}

function errorMessage(reason: unknown, fallback: string): string {
  return reason instanceof Error ? reason.message : fallback;
}
