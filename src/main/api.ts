import { emptyProviderUsage, nowEpoch } from "../shared/usage";
import type { ProviderId, ProviderUsage } from "../shared/usage";
import type { Credentials } from "./auth";
import { ReadFailure } from "./failure";
import {
  parseClaudeProfile,
  parseClaudeResets,
  parseClaudeUsage,
  parseCodexUsage,
  parseCredits,
  parseOpencodeUsage,
} from "./parse";

const endpoints = {
  whamUsage: { origin: "https://chatgpt.com", path: "/backend-api/wham/usage" },
  codexUsage: { origin: "https://chatgpt.com", path: "/backend-api/codex/usage" },
  resetCredits: { origin: "https://chatgpt.com", path: "/backend-api/wham/rate-limit-reset-credits" },
  claudeUsage: { origin: "https://api.anthropic.com", path: "/api/oauth/usage?cedar_ember=1" },
  claudeProfile: { origin: "https://api.anthropic.com", path: "/api/oauth/profile" },
  opencodeUsage: { origin: "https://opencode.ai", path: "/zen/go/v1/usage" },
} as const;
type Endpoint = keyof typeof endpoints;

const TIMEOUT_MILLISECONDS = 12_000;

/** The providers' usage APIs. A preview build can send every request to one fixture origin instead,
 * keeping each provider's own path. */
export class UsageApi {
  constructor(private readonly originOverride: string | null = null) {}

  url(endpoint: Endpoint): string {
    const { origin, path } = endpoints[endpoint];
    return `${(this.originOverride ?? origin).replace(/\/+$/, "")}${path}`;
  }

  async fetch(provider: ProviderId, credentials: Credentials): Promise<ProviderUsage> {
    switch (provider) {
      case "codex":
        return this.fetchCodex(credentials);
      case "claude":
        return this.fetchClaude(credentials);
      case "opencode":
        return this.fetchOpencode(credentials);
    }
  }

  private async fetchCodex(credentials: Credentials): Promise<ProviderUsage> {
    const usage = await this.json("whamUsage", credentials).catch(() => this.json("codexUsage", credentials));
    const credits = await this.json("resetCredits", credentials, codexResetHeaders);
    const now = nowEpoch();
    return ready({ ...parseCodexUsage(usage, now), ...parseCredits(credits), ...identity(credentials) }, now);
  }

  private async fetchClaude(credentials: Credentials): Promise<ProviderUsage> {
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
  ): Promise<unknown> {
    const response = await fetch(this.url(endpoint), {
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
    if (response.status !== 200) throw new ReadFailure("response");
    return response.json().catch((): never => {
      throw new ReadFailure("response");
    });
  }
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
