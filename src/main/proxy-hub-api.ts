import { emptyProviderUsage, nowEpoch, subscriptionName } from "../shared/usage";
import type { ProviderUsage, ProxyHubAccount, ProxyHubConfig, ProxyHubProviderId } from "../shared/usage";
import { claudeHeaders } from "./api";
import {
  field,
  parseClaudeProfile,
  parseClaudeResets,
  parseClaudeUsage,
  parseCodexUsage,
  parseCodexSubscription,
  parseCredits,
  stringAt,
} from "./parse";

type AuthFile = {
  id: string;
  authIndex: string;
  provider: ProxyHubProviderId;
  email: string | null;
  accountId: string | null;
  plan: string | null;
  subscriptionActiveUntilEpoch: number | null;
};

const CODEX_BASE = "https://chatgpt.com/backend-api/wham";
const CREDITS_URL = `${CODEX_BASE}/rate-limit-reset-credits`;
const SUBSCRIPTION_URL = "https://chatgpt.com/backend-api/subscriptions";
const CLAUDE_BASE = "https://api.anthropic.com/api/oauth";
const TIMEOUT_MILLISECONDS = 12_000;

/** A failure whose message is safe to show. */
export class ProxyHubError extends Error {}

/** The hub refused the management key. CLIProxyAPI bans an address after five refusals, so a hub
 * that refused must not be read again with the same key. */
export class ProxyHubRejected extends ProxyHubError {}

export class ProxyHubApi {
  private readonly accountReads = new ConcurrencyLimit(4);

  constructor(private readonly request: typeof fetch = fetch) {}

  async read(config: ProxyHubConfig): Promise<ProxyHubAccount[]> {
    const accounts = await this.authFiles(config);
    return Promise.all(accounts.map((account) => this.accountReads.run(() => this.readAccount(config, account))));
  }

  private async authFiles(config: ProxyHubConfig): Promise<AuthFile[]> {
    const value = await this.management(config, "auth-files").catch((error: unknown): never => {
      throw error instanceof ProxyHubRejected ? error : new ProxyHubError("The hub could not list accounts.");
    });
    const files = field(value, "files");
    if (!Array.isArray(files)) throw new ProxyHubError("The hub could not list accounts.");
    return files.flatMap((file) => {
      const account = authFile(file);
      return account ? [account] : [];
    });
  }

  private async readAccount(config: ProxyHubConfig, account: AuthFile): Promise<ProxyHubAccount> {
    const usage = await (
      account.provider === "codex" ? this.readCodex(config, account) : this.readClaude(config, account)
    ).catch((error: unknown): ProviderUsage => {
      if (error instanceof ProxyHubRejected) throw error;
      return {
        ...emptyProviderUsage(),
        status: "error",
        error_message: "The hub could not read this account's usage.",
      };
    });
    return {
      id: account.id,
      email: account.email,
      plan: await this.readPlan(config, account),
      provider: account.provider,
      usage,
    };
  }

  /** The hub decodes a Codex account's ID token, plan included. A Claude account's plan needs a
   * profile read, and an account whose plan cannot be read still shows its usage. */
  private async readPlan(config: ProxyHubConfig, account: AuthFile): Promise<string | null> {
    if (account.provider === "codex") return account.plan ? subscriptionName(account.plan) : null;
    const profile = await this.apiCall(config, account, `${CLAUDE_BASE}/profile`).catch((error: unknown) => {
      if (error instanceof ProxyHubRejected) throw error;
      return null;
    });
    return parseClaudeProfile(profile).plan;
  }

  private async readCodex(config: ProxyHubConfig, account: AuthFile): Promise<ProviderUsage> {
    const [value, subscription] = await Promise.all([
      this.apiCall(config, account, `${CODEX_BASE}/usage`),
      account.accountId
        ? this.apiCall(
            config,
            account,
            `${SUBSCRIPTION_URL}?account_id=${encodeURIComponent(account.accountId)}`,
          ).catch(() => null)
        : null,
    ]);
    if (!codexUsageResponse(value)) throw new ProxyHubError("The hub returned an unexpected provider response.");
    const now = nowEpoch();
    const credits = await this.apiCall(config, account, CREDITS_URL)
      .then((response) => availableCredits(response, now))
      .catch(() => null);
    return ready(
      {
        ...parseCodexUsage(value, now),
        subscription_active_until_epoch: parseCodexSubscription(subscription) ?? account.subscriptionActiveUntilEpoch,
        ...(credits === null ? {} : parseCredits({ credits })),
      },
      now,
    );
  }

  private async readClaude(config: ProxyHubConfig, account: AuthFile): Promise<ProviderUsage> {
    const value = await this.apiCall(config, account, `${CLAUDE_BASE}/usage?cedar_ember=1`);
    if (!claudeUsageResponse(value)) throw new ProxyHubError("The hub returned an unexpected provider response.");
    return ready({ ...parseClaudeUsage(value), ...parseClaudeResets(value) }, nowEpoch());
  }

  private async apiCall(config: ProxyHubConfig, account: AuthFile, url: string): Promise<unknown> {
    const headers =
      account.provider === "codex"
        ? {
            Authorization: "Bearer $TOKEN$",
            "Content-Type": "application/json",
            "OpenAI-Beta": "codex-1",
            Originator: "Codex Desktop",
            ...(account.accountId ? { "Chatgpt-Account-Id": account.accountId } : {}),
          }
        : { Authorization: "Bearer $TOKEN$", ...claudeHeaders };
    const response = await this.management(config, "api-call", {
      auth_index: account.authIndex,
      method: "GET",
      url,
      header: headers,
    });
    const status = field(response, "status_code");
    const body = field(response, "body");
    if (typeof status !== "number" || !Number.isInteger(status) || typeof body !== "string") {
      throw new ProxyHubError("The hub returned an unexpected provider response.");
    }
    if (status < 200 || status >= 300) throw new ProxyHubError(`The provider refused the hub request (${status}).`);
    try {
      return JSON.parse(body);
    } catch {
      throw new ProxyHubError("The hub returned an unexpected provider response.");
    }
  }

  private async management(config: ProxyHubConfig, path: string, body?: unknown): Promise<unknown> {
    let url: string;
    try {
      url = new URL(`/v0/management/${path}`, config.url).toString();
    } catch {
      throw new ProxyHubError("The hub URL is not valid.");
    }
    let response: Response;
    try {
      response = await this.request(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          authorization: `Bearer ${config.managementKey}`,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MILLISECONDS),
      });
    } catch {
      throw new ProxyHubError("The hub management request failed.");
    }
    if (!response.ok) throw managementFailure(response.status);
    try {
      return await response.json();
    } catch {
      throw new ProxyHubError("The hub management request failed.");
    }
  }
}

function managementFailure(status: number): ProxyHubError {
  if (status === 401) return new ProxyHubRejected("The hub rejected the management key.");
  if (status === 403) return new ProxyHubRejected("The hub refused management access.");
  return new ProxyHubError("The hub management request failed.");
}

function authFile(value: unknown): AuthFile | null {
  if (disabledAuthFile(value)) return null;
  const provider = proxyHubProvider(value);
  if (provider === null) return null;
  return {
    id: authFileString(value, "id"),
    authIndex: authFileString(value, "auth_index"),
    provider,
    email: stringAt(value, ["email"]),
    accountId: stringAt(value, ["id_token", "chatgpt_account_id"]),
    plan: stringAt(value, ["id_token", "plan_type"]),
    subscriptionActiveUntilEpoch: parseCodexSubscription({
      active_until:
        field(value, "chatgpt_subscription_active_until") ??
        field(field(value, "id_token"), "chatgpt_subscription_active_until"),
    }),
  };
}

function disabledAuthFile(value: unknown): boolean {
  const disabled = field(value, "disabled");
  if (disabled === undefined) return false;
  if (typeof disabled !== "boolean") throw new ProxyHubError("The hub returned an unexpected account list.");
  return disabled;
}

function proxyHubProvider(value: unknown): ProxyHubProviderId | null {
  const provider = field(value, "provider");
  return provider === "codex" || provider === "claude" ? provider : null;
}

function authFileString(value: unknown, key: string): string {
  const found = field(value, key);
  if (typeof found !== "string" || found.length === 0) {
    throw new ProxyHubError("The hub returned an unexpected account list.");
  }
  return found;
}

function codexUsageResponse(value: unknown): boolean {
  if (!record(value)) return false;
  const rateLimit = value.rate_limit;
  if (rateLimit === null) return true;
  if (!record(rateLimit)) return false;
  return [rateLimit.primary_window, rateLimit.secondary_window].every(
    (window) => window === undefined || window === null || codexWindow(window),
  );
}

function codexWindow(value: unknown): boolean {
  if (!record(value) || typeof value.used_percent !== "number") return false;
  const resetAt = value.reset_at;
  const duration = value.limit_window_seconds;
  return (
    (resetAt === undefined || resetAt === null || typeof resetAt === "string" || typeof resetAt === "number") &&
    (duration === undefined || scalarNumber(duration))
  );
}

function claudeUsageResponse(value: unknown): boolean {
  if (!record(value)) return false;
  if (!Object.hasOwn(value, "five_hour") && !Object.hasOwn(value, "seven_day")) return false;
  return [value.five_hour, value.seven_day].every(
    (window) => window === undefined || window === null || claudeWindow(window),
  );
}

function claudeWindow(value: unknown): boolean {
  if (!record(value) || typeof value.utilization !== "number") return false;
  return value.resets_at === null || typeof value.resets_at === "string";
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function scalarNumber(value: unknown): boolean {
  return typeof value === "number" || (typeof value === "string" && /^\d+(?:\.\d*)?$/.test(value));
}

function ready(fields: Partial<ProviderUsage>, now: number): ProviderUsage {
  return { ...emptyProviderUsage(), ...fields, last_successful_update_epoch: now, status: "ready" };
}

function availableCredits(value: unknown, now: number): unknown[] {
  const credits = field(value, "credits");
  if (!Array.isArray(credits)) throw new ProxyHubError("The hub returned an unexpected credit response.");
  return credits.filter((credit) => {
    const status = field(credit, "status");
    const resetType = field(credit, "reset_type");
    const expiresAt = field(credit, "expires_at");
    return (
      status === "available" &&
      resetType === "codex_rate_limits" &&
      typeof expiresAt === "string" &&
      Date.parse(expiresAt) > now * 1000
    );
  });
}

class ConcurrencyLimit {
  private active = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(private readonly maximum: number) {}

  async run<T>(read: () => Promise<T>): Promise<T> {
    if (this.active >= this.maximum) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    try {
      return await read();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}
