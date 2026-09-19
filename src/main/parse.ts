import { fiveHourSeconds, monthlySeconds, sevenDaySeconds, unreportedWindow } from "../shared/usage";
import type { ExtraUsage, ProviderUsage, ResetCredit, WindowUsage } from "../shared/usage";

/** The part of a provider's reading its usage response carries. */
export type ParsedUsage = Pick<
  ProviderUsage,
  "five_hour" | "seven_day" | "monthly" | "allowed" | "limit_reached" | "extra_usage"
>;

/** A key of a JSON object, or undefined for anything that is not one. */
export function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value) && Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

export function stringAt(value: unknown, path: readonly string[]): string | null {
  const found = path.reduce(field, value);
  return typeof found === "string" ? found : null;
}

const float = (value: unknown) => (typeof value === "number" ? value : null);
const bool = (value: unknown) => (typeof value === "boolean" ? value : null);

/** Codex identifies its windows by duration rather than by name, and which ones an account has
 * depends on its plan: a Go or free account has only the monthly window, and OpenAI has switched the
 * 5-hour window off for a plan before. So no window is assumed. Each duration is looked for among
 * the reported ones and whichever the account does not have stays unreported. */
export function parseCodexUsage(value: unknown, now: number): ParsedUsage {
  const rateLimit = field(value, "rate_limit");
  const windows = [
    codexWindow(field(rateLimit, "primary_window"), now),
    codexWindow(field(rateLimit, "secondary_window"), now),
  ];
  const window = (seconds: number) =>
    windows.find((window) => window.limit_window_seconds === seconds) ?? unreportedWindow();
  return {
    five_hour: window(fiveHourSeconds),
    seven_day: window(sevenDaySeconds),
    monthly: window(monthlySeconds),
    allowed: bool(field(rateLimit, "allowed")),
    limit_reached: bool(field(rateLimit, "limit_reached")),
    extra_usage: null,
  };
}

/** Claude names its windows instead of reporting a duration, so the duration is supplied here. A
 * `locked_reason` on either window is the only signal that the account is actually cut off. */
export function parseClaudeUsage(value: unknown): ParsedUsage {
  const locked = ["five_hour", "seven_day"].some((key) => {
    const reason = field(field(value, key), "locked_reason");
    return reason !== undefined && reason !== null;
  });
  return {
    five_hour: namedWindow(field(value, "five_hour"), fiveHourSeconds, "utilization", "resets_at"),
    seven_day: namedWindow(field(value, "seven_day"), sevenDaySeconds, "utilization", "resets_at"),
    monthly: unreportedWindow(),
    allowed: !locked,
    limit_reached: locked,
    extra_usage: extraUsage(field(value, "extra_usage")),
  };
}

/** Opencode reports three named windows, so the duration is supplied here too. Each window also
 * carries a `status`, but its vocabulary beyond `ok` is unknown, and reading an unrecognised value as
 * blocked would tell someone they are cut off while they can still work. A window counts as spent
 * only when its own percentage says so. */
export function parseOpencodeUsage(value: unknown): ParsedUsage {
  const usage = field(value, "usage");
  const spent = ["rolling", "weekly", "monthly"].some(
    (key) => (float(field(field(usage, key), "percent")) ?? 0) >= 100,
  );
  return {
    five_hour: namedWindow(field(usage, "rolling"), fiveHourSeconds, "percent", "resetsAt"),
    seven_day: namedWindow(field(usage, "weekly"), sevenDaySeconds, "percent", "resetsAt"),
    monthly: namedWindow(field(usage, "monthly"), monthlySeconds, "percent", "resetsAt"),
    allowed: !spent,
    limit_reached: spent,
    extra_usage: null,
  };
}

/** A window the provider identifies by name rather than by duration. Only the field names differ
 * between providers, so the duration and both keys are supplied by the caller. */
function namedWindow(value: unknown, seconds: number, percent: string, resets: string): WindowUsage {
  if (value === undefined || value === null) return unreportedWindow();
  return {
    used_percent: float(field(value, percent)),
    limit_window_seconds: seconds,
    reset_at_epoch: epoch(field(value, resets)),
  };
}

function extraUsage(value: unknown): ExtraUsage | null {
  if (value === undefined || value === null) return null;
  const currency = field(value, "currency");
  const scale = 10 ** (float(field(value, "decimal_places")) ?? 2);
  const amount = (key: string) => {
    const minor = float(field(value, key));
    return minor === null ? null : minor / scale;
  };
  return {
    enabled: bool(field(value, "is_enabled")) ?? false,
    used_credits: amount("used_credits"),
    monthly_limit: amount("monthly_limit"),
    currency: typeof currency === "string" ? currency : null,
  };
}

const expiryKeys = ["expires_at", "expiresAt", "expiry", "expires", "expiration", "expiration_at"];

export function parseCredits(value: unknown): Pick<ProviderUsage, "reset_credits" | "reset_credit_count"> {
  const items = ["credits", "data", "items"].map((key) => field(value, key)).find(Array.isArray);
  const reset_credits: ResetCredit[] = (items ?? []).map((credit: unknown) => ({
    expires_at_epoch: expiryKeys.map((key) => epoch(field(credit, key))).find((expiry) => expiry !== null) ?? null,
  }));
  const count = field(value, "available_count");
  return {
    reset_credits,
    reset_credit_count:
      typeof count === "number" && Number.isInteger(count) && count >= 0 ? count : (items?.length ?? null),
  };
}

function codexWindow(value: unknown, now: number): WindowUsage {
  const resetAfter = number(field(value, "reset_after_seconds"));
  return {
    used_percent: float(field(value, "used_percent")),
    limit_window_seconds:
      exactInteger(field(value, "limit_window_seconds")) ?? exactInteger(field(value, "window_seconds")),
    reset_at_epoch: resetAfter !== null ? now + resetAfter : epoch(field(value, "reset_at")),
  };
}

/** Providers send some figures as strings, so numeric fields accept "90" and 90 alike, truncating
 * any fractional part. */
function number(value: unknown): number | null {
  if (typeof value === "string") return wholeDigits(value);
  return typeof value === "number" ? Math.trunc(value) : null;
}

/** Digits with an optional fractional part, truncated. Deliberately stricter than `Number`, which
 * would turn "-1e9" into a negative epoch and "" into zero. */
function wholeDigits(text: string): number | null {
  const whole = /^(\d+)(?:\.\d*)?$/.exec(text)?.[1];
  const parsed = Number(whole);
  return whole !== undefined && Number.isSafeInteger(parsed) ? parsed : null;
}

/** Window durations match against 18,000 and 604,800 exactly, so unlike `number` this keeps a
 * fractional value unavailable rather than truncating it into a window it does not belong to. */
function exactInteger(value: unknown): number | null {
  if (typeof value === "string") return value.includes(".") ? null : wholeDigits(value);
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

const RFC_3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/i;

/** Timestamps arrive as an epoch in seconds or milliseconds, or as an RFC 3339 string. */
function epoch(value: unknown): number | null {
  const whole = number(value);
  if (whole !== null) return toSeconds(whole);
  if (typeof value !== "string" || !RFC_3339.test(value)) return null;
  const milliseconds = Date.parse(value.toUpperCase());
  return Number.isNaN(milliseconds) ? null : Math.floor(milliseconds / 1000);
}

/** Epochs above this threshold are milliseconds. It is the year 5138 in seconds, so no plausible
 * second-resolution timestamp reaches it. */
function toSeconds(epoch: number): number {
  return epoch > 100_000_000_000 ? Math.trunc(epoch / 1000) : epoch;
}
