import { createHash } from "node:crypto";
import { emptyProviderUsage, nowEpoch } from "../shared/usage";
import type { ProviderId, ProviderUsage, ReadingLookup } from "../shared/usage";
import type { Credentials } from "./auth";
import { ReadFailure } from "./failure";
import {
  parseClaudeProfile,
  parseClaudeResets,
  parseClaudeUsage,
  parseCodexUsage,
  parseCodexSubscription,
  parseCredits,
  parseOpencodeUsage,
} from "./parse";

const endpoints = {
  whamUsage: { origin: "https://chatgpt.com", path: "/backend-api/wham/usage" },
  codexUsage: { origin: "https://chatgpt.com", path: "/backend-api/codex/usage" },
  resetCredits: { origin: "https://chatgpt.com", path: "/backend-api/wham/rate-limit-reset-credits" },
  codexSubscription: { origin: "https://chatgpt.com", path: "/backend-api/subscriptions" },
  claudeUsage: { origin: "https://api.anthropic.com", path: "/api/oauth/usage?cedar_ember=1" },
  claudeProfile: { origin: "https://api.anthropic.com", path: "/api/oauth/profile" },
  opencodeUsage: { origin: "https://opencode.ai", path: "/zen/go/v1/usage" },
} as const;
type Endpoint = keyof typeof endpoints;

const TIMEOUT_MILLISECONDS = 12_000;

/** The providers' usage APIs. A preview build can send every request to one fixture origin instead,
 * keeping each provider's own path. */
export class UsageApi {
  /** The email each direct sign-in's last own read found, with the token that read it. Claude's sign-in
   * file names no account, so this names it until the sign-in changes. */
  private readonly named = new Map<string, { token: string; email: string | null }>();

  constructor(private readonly originOverride: string | null = null) {}

  /** Reads the direct sign-in `signIn`, unless `known` already has a live reading of its account. */
  async read(
    provider: ProviderId,
    signIn: string,
    credentials: Credentials,
    known: ReadingLookup,
  ): Promise<ProviderUsage> {
    const named = this.named.get(signIn);
    const email = credentials.email ?? (named?.token === credentials.accessToken ? named.email : null);
    const reading = known(provider, accountKey(credentials.accountId, email, credentials.accessToken));
    if (reading) return reading;
    const usage = await this.fetch(provider, credentials);
    this.named.set(signIn, { token: credentials.accessToken, email: usage.email });
    return usage;
  }

  url(endpoint: Endpoint): string {
    const { origin, path } = endpoints[endpoint];
    return `${(this.originOverride ?? origin).replace(/\/+$/, "")}${path}`;
  }

  async fetch(provider: ProviderId, credentials: Credentials): Promise<ProviderUsage> {
    const reads = {
      codex: () => this.fetchCodex(credentials),
      claude: () => this.fetchClaude(credentials),
      opencode: () => this.fetchOpencode(credentials),
    };
    const usage = await reads[provider]();
    return { ...usage, account_key: accountKey(credentials.accountId, usage.email, credentials.accessToken) };
  }

  private async fetchCodex(credentials: Credentials): Promise<ProviderUsage> {
    const [usage, credits, subscription] = await Promise.all([
      this.json("whamUsage", credentials).catch(() => this.json("codexUsage", credentials)),
      this.json("resetCredits", credentials, codexResetHeaders),
      credentials.accountId
        ? this.json("codexSubscription", credentials, codexResetHeaders, credentials.accountId).catch(() => null)
        : null,
    ]);
    const now = nowEpoch();
    return ready(
      {
        ...parseCodexUsage(usage, now),
        ...parseCredits(credits),
        ...identity(credentials),
        subscription_active_until_epoch:
          parseCodexSubscription(subscription) ?? credentials.subscription_active_until_epoch,
      },
      now,
    );
  }

  private async fetchClaude(credentials: Credentials): Promise<ProviderUsage> {
    if (credentials.expires_at_epoch !== null && credentials.expires_at_epoch <= nowEpoch()) {
      throw new ReadFailure("expired");
    }
    const [usage, profile] = await Promise.all([
      this.json("claudeUsage", credentials, claudeHeaders),
      this.json("claudeProfile", credentials, claudeHeaders).catch(() => null),
    ]);
    const details = parseClaudeProfile(profile);
    return ready(
      {
        ...parseClaudeUsage(usage),
        ...parseClaudeResets(usage),
        email: details.email ?? credentials.email,
        plan: details.plan ?? credentials.plan,
      },
      nowEpoch(),
    );
  }

  private async fetchOpencode(credentials: Credentials): Promise<ProviderUsage> {
    const usage = await this.json("opencodeUsage", credentials, userAgent);
    return ready({ ...parseOpencodeUsage(usage), ...identity(credentials) }, nowEpoch());
  }

  private async json(
    endpoint: Endpoint,
    credentials: Credentials,
    headers: Record<string, string> = {},
    accountId?: string,
  ): Promise<unknown> {
    const url = accountId ? `${this.url(endpoint)}?account_id=${encodeURIComponent(accountId)}` : this.url(endpoint);
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        accept: "application/json",
        ...(credentials.accountId && { "chatgpt-account-id": credentials.accountId }),
        ...headers,
      },
      signal: AbortSignal.timeout(TIMEOUT_MILLISECONDS),
    }).catch((error: unknown) => {
      throw new ReadFailure(error instanceof DOMException && error.name === "TimeoutError" ? "timeout" : "request");
    });
    if (response.status !== 200) {
      throw new ReadFailure(endpoint === "claudeUsage" && response.status === 401 ? "rejected" : "response");
    }
    return response.json().catch((): never => {
      throw new ReadFailure("response");
    });
  }
}

/** Names an account by its account ID, else its email, so a direct sign-in and a hub account of the same
 * account get the same key on any machine. Without either, the key hashes `token`, which only an
 * Opencode key shares between machines. Null when there is none of the three. */
export function accountKey(accountId: string | null, email: string | null, token: string | null): string | null {
  const parts = accountId
    ? ["account", accountId]
    : email
      ? ["email", email.trim().toLowerCase()]
      : token && ["credential", token];
  return parts ? createHash("sha256").update(JSON.stringify(parts)).digest("hex") : null;
}

function identity(credentials: Credentials): Pick<ProviderUsage, "email" | "plan"> {
  return { email: credentials.email, plan: credentials.plan };
}

function ready(fields: Partial<ProviderUsage>, now: number): ProviderUsage {
  return { ...emptyProviderUsage(), ...fields, last_successful_update_epoch: now, status: "ready" };
}

const userAgent = { "User-Agent": "tantalus/0.1" };
const codexResetHeaders = { "OpenAI-Beta": "codex-1", originator: "Codex Desktop", ...userAgent };
/** Claude tells only its own CLI about banked resets, and recognises it by the `cli` entrypoint and a
 * minimum version in the agent. 2.1.280 is a release that reads them. */
export const claudeHeaders = {
  "anthropic-beta": "oauth-2025-04-20",
  "User-Agent": "claude-cli/2.1.280 (external, cli)",
};
