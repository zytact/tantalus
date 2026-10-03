import { useEffect, useId, useState } from "react";
import { providerNames } from "../shared/usage";
import type { ProviderId } from "../shared/usage";
import { startProviderIds } from "../shared/window-start";
import type { StartProviderId, StartProviderSettings, WindowStart } from "../shared/window-start";
import type { Loadable } from "./busy";
import { startStatus, wakeStatus } from "./presentation";
import { ProviderIcon } from "./provider-icon";
import { SettingPending, Toggle } from "./settings-controls";

/** The switch for starting idle 5-hour windows, and under it each provider's switch and CLI. Read on
 * every visit, since the last start and the CLI found can change between visits. */
export function WindowStartRows({ polled }: { polled: Loadable<Record<ProviderId, boolean>> }) {
  const [start, setStart] = useState<Loadable<WindowStart>>("loading");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void window.tantalus.invoke("windowStart").then(
      (read) => {
        if (mounted) setStart(read);
      },
      () => {
        if (mounted) setStart("unavailable");
      },
    );
    return () => {
      mounted = false;
    };
  }, []);

  const save = async (next: WindowStart) => {
    setSaving(true);
    setError(null);
    try {
      setStart(await window.tantalus.invoke("setWindowStart", next));
    } catch {
      setError("Could not save the window start setting.");
    } finally {
      setSaving(false);
    }
  };

  const change = (current: WindowStart, id: StartProviderId, patch: Partial<StartProviderSettings>) =>
    void save({ ...current, providers: { ...current.providers, [id]: { ...current.providers[id], ...patch } } });

  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>Start 5-hour windows</h2>
          <p>
            When a 5-hour window has sat idle for 5 minutes, Tantalus sends a one-word prompt through the CLI to start
            it. Each start uses a little of your weekly limit.
          </p>
        </div>
        <StartToggle start={start} saving={saving} onSave={(next) => void save(next)} />
      </section>
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
      {typeof start !== "string" &&
        start.enabled &&
        startProviderIds.map((id) => (
          <StartProviderRow
            key={id}
            id={id}
            provider={start.providers[id]}
            polled={typeof polled !== "string" && polled[id]}
            saving={saving}
            onChange={(patch) => change(start, id, patch)}
          />
        ))}
      <WakeRow start={start} saving={saving} onSave={(next) => void save(next)} />
    </>
  );
}

function StartToggle({
  start,
  saving,
  onSave,
}: {
  start: Loadable<WindowStart>;
  saving: boolean;
  onSave: (start: WindowStart) => void;
}) {
  if (typeof start === "string") return <SettingPending failed={start === "unavailable"} />;
  return (
    <Toggle
      label="Start 5-hour windows"
      checked={start.enabled}
      busy={saving}
      onToggle={() => onSave({ ...start, enabled: !start.enabled })}
    />
  );
}

/** Runs the Claude CLI when Claude's sign-in is rejected. It works apart from window starts. */
function WakeRow({
  start,
  saving,
  onSave,
}: {
  start: Loadable<WindowStart>;
  saving: boolean;
  onSave: (start: WindowStart) => void;
}) {
  const loaded = typeof start !== "string";
  return (
    <section className="setting-row">
      <div className="setting-copy">
        <h2>
          Wake Claude sign-in <span className="beta-label">Beta</span>
        </h2>
        <p>{loaded ? wakeStatus(start) : "Runs the Claude CLI when Claude's sign-in is rejected."}</p>
      </div>
      {loaded ? (
        <Toggle
          label="Wake Claude sign-in"
          checked={start.wake}
          busy={saving}
          onToggle={() => onSave({ ...start, wake: !start.wake })}
        />
      ) : (
        <SettingPending failed={start === "unavailable"} />
      )}
    </section>
  );
}

function StartProviderRow({
  id,
  provider,
  polled,
  saving,
  onChange,
}: {
  id: StartProviderId;
  provider: WindowStart["providers"][StartProviderId];
  polled: boolean;
  saving: boolean;
  onChange: (patch: Partial<StartProviderSettings>) => void;
}) {
  const name = providerNames[id];
  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>
            <ProviderIcon id={id} />
            {name}
          </h2>
          <p>{polled ? startStatus(provider) : `Switch on ${name} above so Tantalus can see its window.`}</p>
        </div>
        <Toggle
          label={`Start ${name} windows`}
          checked={provider.enabled}
          busy={saving}
          onToggle={() => onChange({ enabled: !provider.enabled })}
        />
      </section>
      {provider.enabled && (
        <CliPathForm
          key={provider.path}
          name={name}
          provider={provider}
          saving={saving}
          onSave={(path) => onChange({ path })}
        />
      )}
    </>
  );
}

/** A blank path goes back to looking the CLI up. */
function CliPathForm({
  name,
  provider,
  saving,
  onSave,
}: {
  name: string;
  provider: WindowStart["providers"][StartProviderId];
  saving: boolean;
  onSave: (path: string | null) => void;
}) {
  const [path, setPath] = useState(provider.path ?? "");
  const id = useId();
  return (
    <form
      className="hub-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(path.trim() || null);
      }}
    >
      <div className="hub-key hub-form-wide">
        <label htmlFor={id}>
          {name} CLI <span className="optional-label">Leave blank to look it up</span>
        </label>
        <div className="key-field">
          <input
            id={id}
            spellCheck={false}
            autoComplete="off"
            placeholder={provider.command ?? "Not found"}
            value={path}
            onChange={(event) => setPath(event.target.value)}
          />
          <button disabled={saving} type="submit" aria-label={`Save ${name} CLI`}>
            Save
          </button>
        </div>
      </div>
    </form>
  );
}
