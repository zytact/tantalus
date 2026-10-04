import { useEffect, useId, useState } from "react";
import { providerNames } from "../shared/usage";
import type { ProviderId, UsageSnapshot } from "../shared/usage";
import { startProviderIds } from "../shared/window-start";
import type { StartAttempt, StartProviderId, WindowStart } from "../shared/window-start";
import type { Loadable } from "./busy";
import { startStatus, wakeStatus } from "./presentation";
import { ProviderIcon } from "./provider-icon";
import { SettingPending, Toggle } from "./settings-controls";

/** The switch for starting idle 5-hour windows, and under it each provider's status and CLI. Read on
 * every visit, since the last start and the CLI found can change between visits. */
export function WindowStartRows({
  polled,
  snapshot,
}: {
  polled: Loadable<Record<ProviderId, boolean>>;
  snapshot: UsageSnapshot | null;
}) {
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
  }, [snapshot]);

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

  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>Start 5-hour windows</h2>
          <p>
            When a 5-hour window has sat idle for 5 minutes, Tantalus sends a one-word prompt through the CLI to start
            it. For hub accounts, Tantalus sends the prompt through CLIProxyAPI. Each start uses a little of your weekly
            limit.
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
        startProviderIds
          .filter((id) => (typeof polled !== "string" && polled[id]) || hasHubProvider(snapshot, id))
          .map((id) => (
            <StartProviderRow
              key={id}
              id={id}
              provider={start.providers[id]}
              status={providerStatus(start, snapshot, id)}
              showCli={snapshot?.enabled[id] ?? false}
              saving={saving}
              onSavePath={(path) =>
                void save({ ...start, providers: { ...start.providers, [id]: { ...start.providers[id], path } } })
              }
            />
          ))}
      <WakeRow snapshot={snapshot} start={start} saving={saving} onSave={(next) => void save(next)} />
    </>
  );
}

function hasHubProvider(snapshot: UsageSnapshot | null, provider: StartProviderId): boolean {
  return snapshot?.proxy_hubs.some((hub) => hub.accounts.some((account) => account.provider === provider)) ?? false;
}

function currentHubAccounts(start: WindowStart, snapshot: UsageSnapshot | null, provider: StartProviderId) {
  return start.hubs.filter(
    (account) =>
      account.provider === provider &&
      snapshot?.proxy_hubs.some(
        (hub) =>
          hub.id === account.hubId &&
          hub.accounts.some((current) => current.id === account.accountId && current.provider === provider),
      ),
  );
}

function lastAttempt(attempts: (StartAttempt | null)[]): StartAttempt | null {
  const recent = attempts.flatMap((attempt) => (attempt ? [attempt] : [])).toSorted((a, b) => b.epoch - a.epoch);
  return recent.find((attempt) => attempt.error !== null) ?? recent[0] ?? null;
}

function automationAttempt(start: WindowStart, snapshot: UsageSnapshot | null, provider: StartProviderId) {
  const attempts = currentHubAccounts(start, snapshot, provider).map((account) => account.last);
  if (snapshot?.enabled[provider]) attempts.push(start.providers[provider].last);
  return lastAttempt(attempts);
}

function providerStatus(start: WindowStart, snapshot: UsageSnapshot | null, provider: StartProviderId): string {
  const command = snapshot?.enabled[provider]
    ? start.providers[provider].command
    : "an account-specific prompt through the hub";
  return startStatus({ command, last: automationAttempt(start, snapshot, provider) });
}

function wakeStart(start: Loadable<WindowStart>, snapshot: UsageSnapshot): Loadable<WindowStart> {
  if (typeof start === "string") return start;
  return { ...start, lastWake: snapshot.enabled.claude ? start.lastWake : null };
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

function WakeRow({
  snapshot,
  ...props
}: {
  snapshot: UsageSnapshot | null;
  start: Loadable<WindowStart>;
  saving: boolean;
  onSave: (start: WindowStart) => void;
}) {
  if (!snapshot) return null;
  if (!snapshot.enabled.claude && !hasHubProvider(snapshot, "claude")) return null;
  return <WakeControl {...props} start={wakeStart(props.start, snapshot)} />;
}

function WakeControl({
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
  status,
  showCli,
  saving,
  onSavePath,
}: {
  id: StartProviderId;
  provider: WindowStart["providers"][StartProviderId];
  status: string;
  showCli: boolean;
  saving: boolean;
  onSavePath: (path: string | null) => void;
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
          <p>{status}</p>
        </div>
      </section>
      {showCli && (
        <CliPathForm key={provider.path} name={name} provider={provider} saving={saving} onSave={onSavePath} />
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
