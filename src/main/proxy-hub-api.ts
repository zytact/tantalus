import { emptyProviderUsage, nowEpoch, subscriptionName } from "../shared/usage";
import type { ProviderUsage, ProxyHubAccount, ProxyHubConfig, ProxyHubProviderId } from "../shared/usage";
import { ReadFailure } from "./failure";
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
  private readonly rejected = new WeakSet<ProxyHubConfig>();

  constructor(private readonly request: typeof fetch = fetch) {}

  async read(config: ProxyHubConfig): Promise<ProxyHubAccount[]> {
    const accounts = await this.authFiles(config);
    return Promise.all(accounts.map((account) => this.accountReads.run(() => this.readAccount(config, account))));
  }

  async runAccount(
    config: ProxyHubConfig,
    id: string,
    provider: ProxyHubProviderId,
    ensureAvailable: () => void = () => {},
  ): Promise<void> {
    await this.accountReads.run(async () => {
      ensureAvailable();
      const account = (await this.authFiles(config)).find(
        (account) => account.id === id && account.provider === provider,
      );
      if (!account) throw new ProxyHubError("The hub account is no longer enabled or available.");
      ensureAvailable();
      const models = await this.management(config, `model-definitions/${provider}`);
      const model = startModel(models, provider);
      ensureAvailable();
      const claude = provider === "claude";
      const result = await this.apiCall(
        config,
        account,
        claude ? "https://api.anthropic.com/v1/messages" : "https://chatgpt.com/backend-api/codex/responses",
        {
          model,
          ...(claude
            ? {
                max_tokens: 1,
                system: "You are Claude Code, Anthropic's official CLI for Claude.",
                messages: [{ role: "user", content: "OK" }],
              }
            : {
                instructions: "Reply OK.",
                store: false,
                stream: true,
                reasoning: { effort: "low" },
                input: [{ role: "user", content: [{ type: "input_text", text: "OK" }] }],
              }),
        },
      );
      if (claude && field(result, "type") !== "message")
        throw new ProxyHubError("The hub did not complete the window-start prompt.");
    });
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
    const [usage, plan] = await Promise.all([
      (account.provider === "codex" ? this.readCodex(config, account) : this.readClaude(config, account)).catch(
        (error: unknown): ProviderUsage => {
          if (error instanceof ProxyHubRejected) throw error;
          return {
            ...emptyProviderUsage(),
            status: "error",
            error_message:
              error instanceof ReadFailure ? error.message : "The hub could not read this account's usage.",
            error_reason: error instanceof ReadFailure ? error.reason : null,
          };
        },
      ),
      this.readPlan(config, account),
    ]);
    return { id: account.id, email: account.email, plan, provider: account.provider, usage };
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
    const [value, subscription, credits] = await Promise.all([
      this.apiCall(config, account, `${CODEX_BASE}/usage`),
      account.accountId
        ? this.apiCall(
            config,
            account,
            `${SUBSCRIPTION_URL}?account_id=${encodeURIComponent(account.accountId)}`,
          ).catch((error: unknown) => {
            if (error instanceof ProxyHubRejected) throw error;
            return null;
          })
        : null,
      this.apiCall(config, account, CREDITS_URL)
        .then((response) => availableCredits(response, nowEpoch()))
        .catch(() => null),
    ]);
    if (!codexUsageResponse(value)) throw new ProxyHubError("The hub returned an unexpected provider response.");
    const now = nowEpoch();
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

  private async apiCall(config: ProxyHubConfig, account: AuthFile, url: string, data?: unknown): Promise<unknown> {
    const response = await this.management(
      config,
      "api-call",
      {
        auth_index: account.authIndex,
        method: data === undefined ? "GET" : "POST",
        ...(data === undefined ? {} : { data: JSON.stringify(data) }),
        url,
        header: upstreamHeaders(account, data !== undefined),
      },
      data === undefined ? TIMEOUT_MILLISECONDS : 120_000,
    );
    const body = providerBody(response, account.provider);
    if (data !== undefined && account.provider === "codex") {
      if (!completedResponse(body)) throw new ProxyHubError("The hub did not complete the window-start prompt.");
      return null;
    }
    try {
      return JSON.parse(body);
    } catch {
      throw new ProxyHubError("The hub returned an unexpected provider response.");
    }
  }

  private async management(
    config: ProxyHubConfig,
    path: string,
    body?: unknown,
    timeout = TIMEOUT_MILLISECONDS,
  ): Promise<unknown> {
    if (this.rejected.has(config)) throw new ProxyHubRejected("The hub refused management access.");
    let url: string;
    try {
      url = new URL(`/v0/management/${path}`, config.url).toString();
    } catch {
      throw new ProxyHubError("The hub URL is not valid.");
    }
    let response: Response;
    try {
      response = await this.request(url, managementRequest(config, body, timeout));
    } catch {
      throw new ProxyHubError("The hub management request failed.");
    }
    if (response.status === 401 || response.status === 403) this.rejected.add(config);
    if (!response.ok) throw managementFailure(response.status);
    try {
      return await response.json();
    } catch {
      throw new ProxyHubError("The hub management request failed.");
    }
  }
}

function managementRequest(config: ProxyHubConfig, body: unknown, timeout: number): RequestInit {
  return {
    method: body === undefined ? "GET" : "POST",
    headers: {
      authorization: `Bearer ${config.managementKey}`,
      accept: "application/json",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeout),
  };
}

function upstreamHeaders(account: AuthFile, generating: boolean) {
  if (account.provider === "codex")
    return {
      Authorization: "Bearer $TOKEN$",
      "Content-Type": "application/json",
      "OpenAI-Beta": "codex-1",
      Originator: "Codex Desktop",
      ...(account.accountId ? { "Chatgpt-Account-Id": account.accountId } : {}),
    };
  return {
    Authorization: "Bearer $TOKEN$",
    ...claudeHeaders,
    ...(generating
      ? {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "oauth-2025-04-20,claude-code-20250219",
          "x-app": "cli",
        }
      : {}),
  };
}

function providerBody(response: unknown, provider: ProxyHubProviderId): string {
  const status = field(response, "status_code");
  const body = field(response, "body");
  if (typeof status !== "number" || !Number.isInteger(status) || typeof body !== "string")
    throw new ProxyHubError("The hub returned an unexpected provider response.");
  if (status === 401 && provider === "claude") throw new ReadFailure("rejected");
  if (status < 200 || status >= 300) throw new ProxyHubError(`The provider refused the hub request (${status}).`);
  return body;
}

function completedResponse(body: string): boolean {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .some((line) => {
      try {
        return field(JSON.parse(line.slice(5).trim()), "type") === "response.completed";
      } catch {
        return false;
      }
    });
}

function startModel(value: unknown, provider: ProxyHubProviderId): string {
  const models = field(value, "models");
  const ids = Array.isArray(models)
    ? models.flatMap((model) => {
        const id = field(model, "id");
        return typeof id === "string" ? [id] : [];
      })
    : [];
  const supported = ids.filter((id) => id.startsWith(provider === "claude" ? "claude-" : "gpt-"));
  const model = supported.find((id) => /haiku|luna|mini/.test(id)) ?? supported[0];
  if (!model) throw new ProxyHubError("The hub account has no supported model for starting a window.");
  return model;
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
