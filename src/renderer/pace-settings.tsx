import { useState } from "react";
import { creatureFor, pacePresets, paceWindows } from "../shared/pace";
import type { PacePreset, PaceSettings, WindowPace } from "../shared/pace";
import type { UsageSnapshot } from "../shared/usage";
import { absoluteTime, perHour, span, windowLabel } from "./presentation";
import { SettingPending, Toggle } from "./settings-controls";

const presets = [
  { id: "calm", name: "Calm" },
  { id: "normal", name: "Normal" },
  { id: "eager", name: "Eager" },
] as const satisfies readonly { id: PacePreset; name: string }[];

/** The switch for both creatures, how big a change they wait for, and what each window has learned. */
export function PaceSettingsRows({
  snapshot,
  failed,
  onSnapshot,
}: {
  snapshot: UsageSnapshot | null;
  failed: boolean;
  onSnapshot: (snapshot: UsageSnapshot) => void;
}) {
  const { saving, error, save } = useSave(onSnapshot);
  return (
    <>
      <section className="setting-row">
        <div className="setting-copy">
          <h2>Dragon and tortoise</h2>
          <p>
            Tantalus learns how fast you usually use each window. A dragon rides the bar when you go much faster than
            that, and a tortoise when you go much slower.
          </p>
        </div>
        <PaceToggle settings={snapshot?.pace.settings} failed={failed} saving={saving} onSave={save} />
      </section>
      {error && (
        <p className="notice settings-notice" role="alert">
          {error}
        </p>
      )}
      <PaceDetails snapshot={snapshot} saving={saving} onSave={save} />
    </>
  );
}

function useSave(onSnapshot: (snapshot: UsageSnapshot) => void) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (next: PaceSettings) => {
    setSaving(true);
    setError(null);
    try {
      onSnapshot(await window.tantalus.invoke("setPaceSettings", next));
    } catch {
      setError("Could not save the dragon and tortoise setting.");
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, save: (next: PaceSettings) => void save(next) };
}

function PaceToggle({
  settings,
  failed,
  saving,
  onSave,
}: {
  settings: PaceSettings | undefined;
  failed: boolean;
  saving: boolean;
  onSave: (settings: PaceSettings) => void;
}) {
  if (!settings) return <SettingPending failed={failed} />;
  return (
    <Toggle
      label="Dragon and tortoise"
      checked={settings.enabled}
      busy={saving}
      onToggle={() => onSave({ ...settings, enabled: !settings.enabled })}
    />
  );
}

type TitledPace = { key: string; title: string; pace: WindowPace };

/** Shown only while the creatures are switched on. */
function PaceDetails({
  snapshot,
  saving,
  onSave,
}: {
  snapshot: UsageSnapshot | null;
  saving: boolean;
  onSave: (settings: PaceSettings) => void;
}) {
  if (!snapshot?.pace.settings.enabled) return null;
  const { settings } = snapshot.pace;
  const windows = titledPaces(snapshot);
  const learned = windows.flatMap(({ pace }) => (pace.status === "learned" ? [pace] : []));
  return (
    <section className="pace-settings" aria-label="Dragon and tortoise details">
      <div className="setting-copy">
        <h2>How big a change</h2>
        <p>How far from your usual pace a window has to move before one shows.</p>
      </div>
      <div className="pace-presets">
        {presets.map(({ id, name }) => {
          const kinds = learned.flatMap(({ readings, usual_rate }) =>
            readings.map((reading) => creatureFor(reading, usual_rate, id, true)),
          );
          const dragons = kinds.filter((kind) => kind === "dragon").length;
          const tortoises = kinds.filter((kind) => kind === "tortoise").length;
          return (
            <button
              key={id}
              aria-pressed={settings.preset === id}
              disabled={saving}
              onClick={() => onSave({ ...settings, preset: id })}
            >
              {name}
              <small>{pacePresets[id]}× faster or slower</small>
              {learned.length > 0 && (
                <small>
                  Recently {plural(dragons, "dragon")}, {plural(tortoises, "tortoise")}
                </small>
              )}
            </button>
          );
        })}
      </div>
      {windows.map(({ key, title, pace }) =>
        pace.status === "learning" ? (
          <Learning key={key} title={title} pace={pace} />
        ) : (
          <Learned key={key} title={title} pace={pace} preset={settings.preset} />
        ),
      )}
    </section>
  );
}

function Learning({ title, pace }: { title: string; pace: Extract<WindowPace, { status: "learning" }> }) {
  return (
    <div className="pace-window">
      <h3>
        {title}
        <i className="pace-window-meta">
          {span(pace.watched_seconds)} of {span(pace.learn_seconds)}
        </i>
      </h3>
      <div className="rule">
        <span className="rule-fill" style={{ width: `${(pace.watched_seconds / pace.learn_seconds) * 100}%` }} />
      </div>
      <p>
        {pace.until.kind === "time" ? (
          <>
            Done learning{" "}
            <time dateTime={new Date(pace.until.epoch * 1000).toISOString()}>{absoluteTime(pace.until.epoch)}</time>.
          </>
        ) : pace.until.in_use ? (
          "Needs a little more use to finish."
        ) : (
          "Starts when you next use it."
        )}
      </p>
    </div>
  );
}

function Learned({
  title,
  pace,
  preset,
}: {
  title: string;
  pace: Extract<WindowPace, { status: "learned" }>;
  preset: PacePreset;
}) {
  const peak = Math.max(...pace.readings);
  return (
    <div className="pace-window">
      <h3>
        {title}
        <i className="pace-window-meta">recent readings</i>
      </h3>
      <div className="spark" aria-hidden="true">
        {pace.readings.map((reading, index) => (
          <span
            key={index}
            style={{ height: `${Math.max(4, (reading / peak) * 100)}%` }}
            data-kind={creatureFor(reading, pace.usual_rate, preset, true) ?? undefined}
          />
        ))}
      </div>
      <p>
        Usual <b>{perHour(pace.usual_rate)}</b> · Right now{" "}
        <b>{pace.current.kind === "moving" ? perHour(pace.current.rate) : pace.current.kind}</b>
      </p>
    </div>
  );
}

/** Every window with a pace, named after its provider or hub account. */
function titledPaces(snapshot: UsageSnapshot): TitledPace[] {
  return paceWindows(snapshot).flatMap(({ key, owner, duration }) => {
    const pace = snapshot.pace.windows[key];
    return pace ? [{ key, title: `${owner} · ${windowLabel(duration)}`, pace }] : [];
  });
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;
