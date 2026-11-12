import { Fragment } from "react";
import { riderOf, windowId } from "../shared/pace";
import type { Creature, PaceSnapshot, Rider, WindowPace } from "../shared/pace";
import { poolWindows } from "../shared/pool";
import type { Pool, PoolAccount, PoolWindow } from "../shared/pool";
import { percent, providerNames, remainingUsage, usagePace } from "../shared/usage";
import type { UsageSnapshot, WindowUsage } from "../shared/usage";
import type { StartAttempt } from "../shared/window-start";
import { Email } from "./account-name";
import { CreatureIcon } from "./creature-icon";
import {
  absoluteTime,
  accountChips,
  accountSpend,
  attemptStatus,
  countdown,
  creatureTip,
  creditCount,
  creditExpiry,
  isDegraded,
  learningByUse,
  providerExtras,
  remainingPercent,
  spendTotal,
  statusLine,
  statusTone,
  subscriptionDate,
  usageTier,
  usageValueText,
  windowLabel,
  windowSpan,
} from "./presentation";
import type { AccountChip, AccountSpend } from "./presentation";
import { ProviderIcon } from "./provider-icon";

/** A row of segments holds at most this many accounts, so a large pool wraps instead of thinning its bars. */
const SEGMENTS_PER_ROW = 3;

type Member = { account: PoolAccount; chip: AccountChip };

/** One provider's accounts as a single ledger: who is pooled, then each window as the pool's remaining
 * figure over a bar per account. */
export function PoolSection({
  pool,
  now,
  paces,
  starts,
}: {
  pool: Pool;
  now: number;
  paces: PaceSnapshot["windows"];
  starts: UsageSnapshot["window_starts"];
}) {
  const name = providerNames[pool.provider];
  const chips = accountChips(pool.accounts.map(({ usage }) => usage.email));
  const members = pool.accounts.map((account, index) => ({ account, chip: chips[index]! }));
  const windows = poolWindows(pool, now);
  const paceOf = (account: PoolAccount, { slot, duration }: PoolWindow) =>
    paces[account.paceKey(windowId(slot, duration))];
  return (
    <div className="provider">
      <div className="provider-row">
        <ProviderIcon id={pool.provider} />
        <h2 className="provider-name">{name}</h2>
        <span className="provider-status">
          {members.length === 1 ? "1 account" : `${members.length} accounts pooled`}
        </span>
      </div>
      <ul className="pool-accounts" aria-label={`${name} accounts`}>
        {members.map((member) => (
          <AccountRow key={member.account.key} {...member} now={now} lastStart={starts?.[member.account.startKey]} />
        ))}
      </ul>
      <LearningLine members={members} windows={windows} paceOf={paceOf} />
      {windows.length === 0 && (
        <section className="entry" aria-label="Window unavailable" data-reported="false">
          <div className="entry-head">
            <h3>Window unavailable</h3>
            <strong className="figure">Unavailable</strong>
          </div>
        </section>
      )}
      {windows.map((window) => (
        <WindowEntry
          key={window.slot}
          window={window}
          members={members}
          now={now}
          paceOf={(account) => paceOf(account, window)}
        />
      ))}
      {providerExtras[pool.provider].map((extra) =>
        extra === "spend" ? <Spend key={extra} members={members} /> : <Credits key={extra} members={members} />,
      )}
    </div>
  );
}

/** Two letters from the account's email, tinted per email so accounts sharing initials stay apart. */
function Chip({ chip }: { chip: AccountChip }) {
  return (
    <b
      className="chip"
      style={chip.hue === null ? undefined : ({ "--chip-hue": chip.hue } as React.CSSProperties)}
      aria-hidden="true"
    >
      {chip.text}
    </b>
  );
}

function AccountRow({ account, chip, now, lastStart }: Member & { now: number; lastStart: StartAttempt | undefined }) {
  const { usage } = account;
  return (
    <li>
      <div className="pool-account">
        <Chip chip={chip} />
        <Who account={account} />
        <span className="provider-status" data-tone={statusTone(usage)}>
          {statusLine(usage)}
        </span>
      </div>
      <SubscriptionEnd account={account} now={now} />
      {lastStart && <p className="pool-note">{attemptStatus(lastStart)}</p>}
      {isDegraded(usage) && (
        <p className="notice" role="status">
          {usage.error_message ?? "The last successful reading remains visible."}
        </p>
      )}
    </li>
  );
}

/** The account's email, blurred until clicked, then its plan and the hub it is read through. */
function Who({ account: { name, hub, usage } }: { account: PoolAccount }) {
  const details = [usage.plan, hub].filter((detail) => detail !== null);
  return (
    <span className="pool-who">
      {usage.email === null ? name.label : <Email email={usage.email} label={name.label} />}
      {details.length > 0 && <span className="account-plan"> · {details.join(" · ")}</span>}
    </span>
  );
}

/** Only Codex reports when the paid period ends. */
function SubscriptionEnd({ account: { provider, usage }, now }: { account: PoolAccount; now: number }) {
  const until = usage.subscription_active_until_epoch;
  if (provider !== "codex" || until === null || until <= now) return null;
  return (
    <p className="pool-note">
      Subscription period ends <time dateTime={new Date(until * 1000).toISOString()}>{subscriptionDate(until)}</time>
    </p>
  );
}

/** One sentence per window still learning its usual pace, saying when it is done. Accounts on one plan
 * share a usual pace, so a sentence they share is said once. */
function LearningLine({
  members,
  windows,
  paceOf,
}: {
  members: Member[];
  windows: PoolWindow[];
  paceOf: (account: PoolAccount, window: PoolWindow) => WindowPace | undefined;
}) {
  const learning = new Map(
    windows.flatMap((window) =>
      members.flatMap(({ account }, index) => {
        const pace = window.columns[index] ? paceOf(account, window) : undefined;
        if (pace?.status !== "learning") return [];
        const item = { label: windowLabel(window.slot), until: pace.until };
        return [[JSON.stringify(item), item] as const];
      }),
    ),
  );
  if (learning.size === 0) return null;
  return (
    <p className="pool-note">
      Learning your usual pace.
      {[...learning].map(([key, { label, until }]) => (
        <Fragment key={key}>
          {" "}
          The {label.toLowerCase()}{" "}
          {until.kind === "time" ? (
            <>
              is done <time dateTime={new Date(until.epoch * 1000).toISOString()}>{absoluteTime(until.epoch)}</time>
            </>
          ) : (
            learningByUse(until.in_use)
          )}
          .
        </Fragment>
      ))}
    </p>
  );
}

function Segments({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <div
      className="segments"
      data-many={count > 1}
      style={{ gridTemplateColumns: `repeat(${Math.min(count, SEGMENTS_PER_ROW)}, minmax(0, 1fr))` }}
    >
      {children}
    </div>
  );
}

function WindowEntry({
  window,
  members,
  now,
  paceOf,
}: {
  window: PoolWindow;
  members: Member[];
  now: number;
  paceOf: (account: PoolAccount) => WindowPace | undefined;
}) {
  const label = windowLabel(window.slot);
  const perRow = Math.min(members.length, SEGMENTS_PER_ROW);
  return (
    <section className="entry" aria-label={label}>
      <div className="entry-head">
        <div className="entry-title">
          <h3>
            {label}
            <i>{windowSpan(window.slot)}</i>
          </h3>
          {window.pace && (
            <span className="pace" data-pace={window.pace.status}>
              {window.pace.label}
            </span>
          )}
        </div>
        <Figure remaining={window.remaining} />
      </div>
      <Segments count={members.length}>
        {members.map((member, index) => (
          <Segment
            key={member.account.key}
            {...member}
            label={label}
            usage={window.columns[index] ?? null}
            speed={paceOf(member.account)}
            now={now}
            start={(index % perRow) / perRow}
            share={1 / perRow}
          />
        ))}
      </Segments>
      <NextReset window={window} members={members} now={now} />
    </section>
  );
}

function Figure({ remaining }: { remaining: number | null }) {
  if (remaining === null) return <strong className="figure">Unavailable</strong>;
  return (
    <strong className="figure" aria-label={`${percent(remaining)} remaining`}>
      {percent(remaining)}
    </strong>
  );
}

/** Which account resets first and what that hands back to the pool. One account's caption already says it. */
function NextReset({ window: { next }, members, now }: { window: PoolWindow; members: Member[]; now: number }) {
  if (members.length < 2 || !next) return null;
  return (
    <p className="pool-next">
      {members[next.index]?.chip.text} resets in {countdown(next.resetAt, now)}, handing back{" "}
      {percent(Math.round(next.restores))}
    </p>
  );
}

type SegmentProps = Member & {
  label: string;
  speed: WindowPace | undefined;
  now: number;
  start: number;
  share: number;
};

/** One account's share of a window. `start` and `share` place the segment along its row, from 0 to 1. */
function Segment({ usage, ...props }: SegmentProps & { usage: WindowUsage | null }) {
  if (usage === null) return <Gap chip={props.chip} text={`No ${props.label.toLowerCase()}`} />;
  return <Bar {...props} usage={usage} />;
}

function Bar({ account, chip, label, usage, speed, now, start, share }: SegmentProps & { usage: WindowUsage }) {
  const used = usage.used_percent;
  const remaining = used === null ? undefined : remainingUsage(used);
  const pace = usagePace(usage, now);
  const rider = riderOf(speed);
  return (
    <div className="segment">
      <div
        className="rule"
        data-tier={usageTier(used)}
        role="progressbar"
        aria-label={`${account.name.label} ${label.toLowerCase()} remaining`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={remaining}
        aria-valuetext={usageValueText(used, pace, rider)}
      >
        <span className="rule-fill" style={{ width: `${remaining ?? 0}%` }} />
        {pace && (
          <span
            className="pace-marker"
            style={{ left: `${remainingUsage(pace.expectedPercent)}%` }}
            aria-hidden="true"
          />
        )}
        <CreatureRider rider={rider} used={used} resetAt={usage.reset_at_epoch} now={now} start={start} share={share} />
      </div>
      <p className="segment-caption">
        <Chip chip={chip} />
        <b>{remainingPercent(used)}</b>
        <Reset usage={usage} now={now} />
      </p>
    </div>
  );
}

/** Where an account has nothing to draw a bar for. */
function Gap({ chip, text }: { chip: AccountChip; text: string }) {
  return (
    <div className="segment" data-gap="true">
      <span className="segment-gap" />
      <p className="segment-caption">
        <Chip chip={chip} />
        <span>{text}</span>
      </p>
    </div>
  );
}

/** When the window resets. A window nothing has been spent from has no reset until it is used. */
function Reset({ usage: { used_percent: used, reset_at_epoch: reset }, now }: { usage: WindowUsage; now: number }) {
  if (reset === null) return <span>{used === 0 ? "Not started" : "No reset reported"}</span>;
  return (
    <span title={`Resets ${absoluteTime(reset)}`}>
      <span aria-hidden="true">↻ </span>
      <span className="visually-hidden">resets in </span>
      {countdown(reset, now)}
    </span>
  );
}

const creatureNames = { dragon: "Dragon", tortoise: "Tortoise" } satisfies Record<Creature, string>;

/** Rides the bar at the fill head. The tooltip opens on hover and on focus, and slides along with the
 * head's place in the whole row, so it stays inside the page from either end. */
function CreatureRider({
  rider,
  used,
  resetAt,
  now,
  start,
  share,
}: {
  rider: Rider | null;
  used: number | null;
  resetAt: number | null;
  now: number;
  start: number;
  share: number;
}) {
  if (!rider || used === null) return null;
  const head = remainingUsage(used);
  const tip = creatureTip(rider, used, resetAt, now);
  return (
    <span
      className="creature"
      data-kind={rider.kind}
      style={{ left: `${head}%` }}
      tabIndex={0}
      role="img"
      aria-label={`${creatureNames[rider.kind]}: ${tip}`}
    >
      <CreatureIcon kind={rider.kind} />
      <span
        className="creature-tip"
        style={{ transform: `translateX(-${(start + (head / 100) * share) * 100}%)` }}
        aria-hidden="true"
      >
        {tip}
      </span>
    </span>
  );
}

/** Claude bills overflow against a monthly allowance, one per account. The figure adds up what the
 * accounts with it switched on have left. */
function Spend({ members }: { members: Member[] }) {
  const extras = members.map(({ account }) => account.usage.extra_usage);
  if (extras.every((extra) => extra === null)) return null;
  return (
    <section className="entry" aria-label="Extra usage">
      <div className="entry-head">
        <h3>
          Extra usage<i>remaining</i>
        </h3>
        <strong className="figure">{spendTotal(extras)}</strong>
      </div>
      <Segments count={members.length}>
        {members.map(({ account, chip }, index) => (
          <SpendSegment key={account.key} chip={chip} spend={accountSpend(extras[index] ?? null)} />
        ))}
      </Segments>
    </section>
  );
}

function SpendSegment({ chip, spend }: { chip: AccountChip; spend: AccountSpend }) {
  if (spend.state !== "on") return <Gap chip={chip} text={spend.state === "off" ? "Off" : "Not reported"} />;
  return (
    <div className="segment">
      <div className="rule">
        <span className="rule-fill" style={{ width: `${spend.share ?? 0}%` }} />
      </div>
      <p className="segment-caption">
        <Chip chip={chip} />
        <b>{spend.left}</b>
        <span>of {spend.limit}</span>
      </p>
    </div>
  );
}

/** Codex and Claude bank credits that reset a spent window early. Each account lists its own by expiry. */
function Credits({ members }: { members: Member[] }) {
  const counts = members.flatMap(({ account }) => account.usage.reset_credit_count ?? []);
  return (
    <section className="entry" aria-label="Reset credits">
      <div className="entry-head">
        <h3>
          Reset credits<i>banked</i>
        </h3>
        <strong className="figure">
          {counts.length > 0 ? counts.reduce((sum, count) => sum + count, 0) : "Unavailable"}
        </strong>
      </div>
      <Segments count={members.length}>
        {members.map((member) => (
          <CreditSegment key={member.account.key} {...member} />
        ))}
      </Segments>
    </section>
  );
}

function CreditSegment({ account: { usage }, chip }: Member) {
  const credits = usage.reset_credits;
  return (
    <div className="segment">
      <p className="segment-caption">
        <Chip chip={chip} />
        <b>{creditCount(usage.reset_credit_count)}</b>
      </p>
      {credits.length === 0 && !!usage.reset_credit_count && (
        <p className="segment-credits">No credit details available.</p>
      )}
      <ol className="segment-credits">
        {credits.map((credit, index) => (
          <li key={index}>{creditExpiry(credit.expires_at_epoch)}</li>
        ))}
      </ol>
    </div>
  );
}
