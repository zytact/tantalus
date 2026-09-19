import { Fragment, useEffect, useId, useState } from "react";
import type { ProxyHubInput } from "../shared/ipc";
import type { ProxyHubSettings } from "../shared/usage";
import type { Loadable } from "./busy";
import { SettingPending, Toggle } from "./settings-controls";

/** The hub whose form is open, or "new" while one is being added. */
type Editing = ProxyHubSettings | "new" | null;

export function ProxyHubSettingsRows() {
  const [hubs, setHubs] = useState<Loadable<ProxyHubSettings[]>>("loading");
  const [editing, setEditing] = useState<Editing>(null);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  /** Marks `key` as saving while `change` runs, and says whether it went through. */
  const save = async (key: string, change: () => Promise<ProxyHubSettings[]>, failure: string) => {
    setSaving(key);
    setError(null);
    try {
      setHubs(await change());
      return true;
    } catch (reason) {
      setError(errorMessage(reason, failure));
      return false;
    } finally {
      setSaving(null);
    }
  };

  const submit = async (input: ProxyHubInput) => {
    if (editing === null) return;
    const saved =
      editing === "new"
        ? await save("new", () => window.tantalus.invoke("addProxyHub", input), "Could not add the proxy hub.")
        : await save(
            editing.id,
            () => window.tantalus.invoke("updateProxyHub", editing.id, input),
            "Could not save the proxy hub.",
          );
    if (saved) setEditing(null);
  };

  const toggle = (hub: ProxyHubSettings) =>
    save(
      hub.id,
      () => window.tantalus.invoke("setProxyHubEnabled", hub.id, !hub.enabled),
      "Could not change the proxy hub.",
    );

  const remove = (hub: ProxyHubSettings) =>
    save(hub.id, () => window.tantalus.invoke("removeProxyHub", hub.id), "Could not remove the proxy hub.");

  const form = (hub: ProxyHubSettings | null) => {
    const key = hub?.id ?? "new";
    return <HubForm key={key} hub={hub} busy={saving !== null} submitting={saving === key} onSubmit={submit} />;
  };

  return (
    <>
      <HubHeading
        hubs={hubs}
        adding={editing === "new"}
        onToggle={() => setEditing((open) => (open === "new" ? null : "new"))}
      />
      {typeof hubs !== "string" &&
        hubs.map((hub) => {
          const open = editing !== null && editing !== "new" && editing.id === hub.id;
          return (
            <Fragment key={hub.id}>
              <HubRow
                hub={hub}
                editing={open}
                busy={saving !== null}
                onEdit={() => setEditing(open ? null : hub)}
                onToggle={() => void toggle(hub)}
                onRemove={() => void remove(hub)}
              />
              {open && form(hub)}
            </Fragment>
          );
        })}
      {editing === "new" && typeof hubs !== "string" && form(null)}
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

function HubRow({
  hub,
  editing,
  busy,
  onEdit,
  onToggle,
  onRemove,
}: {
  hub: ProxyHubSettings;
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onToggle: () => void;
  onRemove: () => void;
}) {
  return (
    <section className="setting-row">
      <div className="setting-copy">
        <h2>{hub.label}</h2>
        <p>{hub.url}</p>
      </div>
      <div className="hub-controls">
        <Toggle label={`${hub.label} proxy hub`} checked={hub.enabled} busy={busy} onToggle={onToggle} />
        <button disabled={busy} aria-label={`${editing ? "Cancel editing" : "Edit"} ${hub.label}`} onClick={onEdit}>
          {editing ? "Cancel" : "Edit"}
        </button>
        <button disabled={busy} onClick={onRemove}>
          Remove
        </button>
      </div>
    </section>
  );
}

/** Adds a hub, or edits `hub`. The saved key never reaches the window, so an edit starts with the key
 * blank and leaving it blank keeps it. */
function HubForm({
  hub,
  busy,
  submitting,
  onSubmit,
}: {
  hub: ProxyHubSettings | null;
  busy: boolean;
  submitting: boolean;
  onSubmit: (input: ProxyHubInput) => Promise<void>;
}) {
  const initial = hub ?? { label: "", url: "" };
  const [label, setLabel] = useState(initial.label);
  const [url, setUrl] = useState(initial.url);
  const [managementKey, setManagementKey] = useState("");
  const [idle, pending] = hub ? ["Save hub", "Saving"] : ["Add hub", "Adding"];
  return (
    <form
      className="hub-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onSubmit({ label, url, managementKey });
      }}
    >
      <label>
        Hub URL
        <input
          type="url"
          required
          placeholder="http://127.0.0.1:8317"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          autoFocus
        />
      </label>
      <KeyField editing={hub !== null} value={managementKey} onChange={setManagementKey} />
      <label className="hub-form-wide">
        Label <span className="optional-label">Optional</span>
        <input value={label} onChange={(event) => setLabel(event.target.value)} />
      </label>
      <button disabled={busy} type="submit">
        {submitting ? pending : idle}
      </button>
    </form>
  );
}

function KeyField({
  editing,
  value,
  onChange,
}: {
  editing: boolean;
  value: string;
  onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  const id = useId();
  const toggle = shown ? "Hide" : "Show";
  return (
    <div className="hub-key">
      <label htmlFor={id}>
        Management key {editing && <span className="optional-label">Leave blank to keep it</span>}
      </label>
      <div className="key-field">
        <input
          id={id}
          type={shown ? "text" : "password"}
          required={!editing}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
        <button type="button" aria-label={`${toggle} management key`} onClick={() => setShown((current) => !current)}>
          {toggle}
        </button>
      </div>
    </div>
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
