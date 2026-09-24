import { describe, expect, it } from "vite-plus/test";
import type { ProxyHubConfig } from "../shared/usage";
import { ProxyHubApi, ProxyHubRejected } from "./proxy-hub-api";

const config = {
  id: "home",
  label: "Home hub",
  url: "http://hub.test:8317",
  managementKey: "management-secret",
  enabled: true,
} satisfies ProxyHubConfig;

type ManagementCall = {
  auth_index: string;
  method: string;
  url: string;
  header: Record<string, string>;
};

function fixture(
  accounts: unknown[] = [
    {
      id: "codex.json",
      auth_index: "codex-auth",
      provider: "codex",
      email: "codex@example.com",
      id_token: {
        chatgpt_account_id: "account-a",
        plan_type: "pro",
        chatgpt_subscription_active_until: "2099-01-01T00:00:00Z",
      },
    },
    { id: "claude.json", auth_index: "claude-auth", provider: "claude", email: "claude@example.com" },
    { id: "off.json", auth_index: "off", provider: "codex", disabled: true },
    { id: "gemini.json", auth_index: "gemini", provider: "gemini" },
  ],
) {
  const calls: ManagementCall[] = [];
  const request: typeof fetch = async (_input, init) => {
    expect(init?.headers).toMatchObject({ authorization: "Bearer management-secret" });
    if (init?.method === "GET") return Response.json({ files: accounts });
    const call = JSON.parse(requestBody(init)) as ManagementCall;
    calls.push(call);
    let body: unknown;
    if (call.url.includes("/subscriptions?")) {
      body = { active_until: "2099-02-01T00:00:00Z" };
    } else if (call.url.endsWith("rate-limit-reset-credits")) {
      body = {
        credits: [
          {
            id: "available",
            status: "available",
            reset_type: "codex_rate_limits",
            expires_at: "2099-01-01T00:00:00Z",
          },
          {
            id: "used",
            status: "redeemed",
            reset_type: "codex_rate_limits",
            expires_at: "2099-01-01T00:00:00Z",
          },
        ],
      };
    } else if (call.url.endsWith("/profile")) {
      body = { organization: { organization_type: "claude_max", rate_limit_tier: "default_claude_max_20x" } };
    } else if (call.auth_index === "claude-auth") {
      body = {
        five_hour: { utilization: 31, resets_at: "2099-01-01T00:00:00Z" },
        cedar_ember: { eligible: true, grants: [{ resets_left: 1, ends_at: "2099-01-01T00:00:00Z" }] },
      };
    } else {
      body = {
        plan_type: "pro",
        rate_limit: { primary_window: { used_percent: 72, limit_window_seconds: 604_800 } },
      };
    }
    return Response.json({ status_code: 200, body: JSON.stringify(body) });
  };
  return { api: new ProxyHubApi(request), calls };
}

describe("CLIProxyAPI usage", () => {
  it("reads every supported account through the built-in management API", async () => {
    const test = fixture();
    const accounts = await test.api.read(config);

    expect(accounts.map(({ id, provider, email, plan }) => ({ id, provider, email, plan }))).toEqual([
      {
        id: "codex.json",
        provider: "codex",
        email: "codex@example.com",
        plan: "Pro",
      },
      {
        id: "claude.json",
        provider: "claude",
        email: "claude@example.com",
        plan: "Max 20x",
      },
    ]);
    expect(accounts[0]?.usage.seven_day.used_percent).toBe(72);
    expect(accounts[0]?.usage.reset_credit_count).toBe(1);
    expect(accounts[0]?.usage.subscription_active_until_epoch).toBe(4_073_587_200);
    expect(accounts[1]?.usage.five_hour.used_percent).toBe(31);
    expect(accounts[1]?.usage.reset_credit_count).toBe(1);
    expect(test.calls.map((call) => call.auth_index).sort()).toEqual([
      "claude-auth",
      "claude-auth",
      "codex-auth",
      "codex-auth",
      "codex-auth",
    ]);
    expect(test.calls.every((call) => call.header.Authorization === "Bearer $TOKEN$")).toBe(true);
    expect(test.calls.find((call) => call.auth_index === "codex-auth")?.header["Chatgpt-Account-Id"]).toBe("account-a");
    const claudeUsage = test.calls.find((call) => call.auth_index === "claude-auth" && call.url.includes("/usage"));
    expect(claudeUsage?.url).toMatch(/\?cedar_ember=1$/);
    expect(claudeUsage?.header["User-Agent"]).toMatch(/^claude-cli\//);
  });

  it("reads each Claude plan without letting a failed profile cost the usage reading", async () => {
    const request: typeof fetch = async (_input, init) => {
      if (init?.method === "GET") {
        return Response.json({
          files: [
            { id: "pro", auth_index: "pro", provider: "claude" },
            { id: "unknown", auth_index: "unknown", provider: "claude" },
          ],
        });
      }
      const call = JSON.parse(requestBody(init)) as ManagementCall;
      if (!call.url.endsWith("/profile")) {
        return Response.json({ status_code: 200, body: JSON.stringify({ five_hour: null }) });
      }
      const profile = { organization: { organization_type: "claude_pro", rate_limit_tier: "default_claude_ai" } };
      return Response.json({
        status_code: call.auth_index === "pro" ? 200 : 500,
        body: JSON.stringify(call.auth_index === "pro" ? profile : { error: "unavailable" }),
      });
    };
    const accounts = await new ProxyHubApi(request).read(config);
    expect(accounts.map(({ plan, usage }) => ({ plan, status: usage.status }))).toEqual([
      { plan: "Pro", status: "ready" },
      { plan: null, status: "ready" },
    ]);
  });

  it("keeps a successful usage reading when reset credits fail", async () => {
    const request: typeof fetch = async (_input, init) => {
      if (init?.method === "GET") {
        return Response.json({ files: [{ id: "a", auth_index: "a", provider: "codex" }] });
      }
      const call = JSON.parse(requestBody(init)) as ManagementCall;
      return Response.json({
        status_code: call.url.endsWith("rate-limit-reset-credits") ? 503 : 200,
        body: JSON.stringify(
          call.url.endsWith("rate-limit-reset-credits")
            ? { token: "do-not-publish" }
            : { rate_limit: { primary_window: { used_percent: 18, limit_window_seconds: 18_000 } } },
        ),
      });
    };
    const accounts = await new ProxyHubApi(request).read(config);
    expect(accounts[0]?.usage.five_hour.used_percent).toBe(18);
    expect(accounts[0]?.usage.reset_credit_count).toBeNull();
    expect(JSON.stringify(accounts)).not.toContain("do-not-publish");
  });

  it("isolates account failures without publishing an upstream body or the management key", async () => {
    const request: typeof fetch = async (_input, init) => {
      if (init?.method === "GET") {
        return Response.json({
          files: [
            { id: "bad", auth_index: "bad", provider: "codex" },
            { id: "good", auth_index: "good", provider: "claude" },
          ],
        });
      }
      const call = JSON.parse(requestBody(init)) as ManagementCall;
      return Response.json({
        status_code: call.auth_index === "bad" ? 401 : 200,
        body: JSON.stringify(
          call.auth_index === "bad" ? { token: "do-not-publish" } : { seven_day: { utilization: 25, resets_at: null } },
        ),
      });
    };
    const accounts = await new ProxyHubApi(request).read(config);
    expect(accounts[0]?.usage.status).toBe("error");
    expect(accounts[1]?.usage.status).toBe("ready");
    expect(JSON.stringify(accounts)).not.toContain("do-not-publish");
    expect(JSON.stringify(accounts)).not.toContain(config.managementKey);
  });

  it.each(["null", "{}", JSON.stringify({ error: "upstream unavailable" })])(
    "rejects malformed provider body %s instead of publishing empty ready usage",
    async (body) => {
      const request: typeof fetch = async (_input, init) => {
        if (init?.method === "GET") {
          return Response.json({ files: [{ id: "claude", auth_index: "claude", provider: "claude" }] });
        }
        return Response.json({ status_code: 200, body });
      };
      const accounts = await new ProxyHubApi(request).read(config);
      expect(accounts[0]?.usage.status).toBe("error");
      expect(accounts[0]?.usage.error_message).toBe("The hub could not read this account's usage.");
    },
  );

  it("accepts the numeric strings supported by the shared Codex parser", async () => {
    const request: typeof fetch = async (_input, init) => {
      if (init?.method === "GET") {
        return Response.json({ files: [{ id: "codex", auth_index: "codex", provider: "codex" }] });
      }
      const call = JSON.parse(requestBody(init)) as ManagementCall;
      const body = call.url.endsWith("rate-limit-reset-credits")
        ? { credits: [] }
        : { rate_limit: { primary_window: { used_percent: 25, limit_window_seconds: "18000" } } };
      return Response.json({ status_code: 200, body: JSON.stringify(body) });
    };
    const accounts = await new ProxyHubApi(request).read(config);
    expect(accounts[0]?.usage.status).toBe("ready");
    expect(accounts[0]?.usage.five_hour.used_percent).toBe(25);
  });

  it.each([
    [401, "The hub rejected the management key."],
    [403, "The hub refused management access."],
  ])("treats a %i from the hub as a refusal", async (status, message) => {
    const request: typeof fetch = async () => Response.json({ error: "invalid management key" }, { status });
    const reading = new ProxyHubApi(request).read(config);
    await expect(reading).rejects.toThrow(ProxyHubRejected);
    await expect(reading).rejects.toThrow(message);
  });

  it("treats a refusal while reading an account or its plan as a refusal of the whole hub", async () => {
    const refusing =
      (refused: (call: ManagementCall) => boolean): typeof fetch =>
      async (_input, init) => {
        if (init?.method === "GET") return Response.json({ files: [{ id: "a", auth_index: "a", provider: "claude" }] });
        const call = JSON.parse(requestBody(init)) as ManagementCall;
        return refused(call)
          ? Response.json({ error: "invalid management key" }, { status: 401 })
          : Response.json({ status_code: 200, body: JSON.stringify({ five_hour: null }) });
      };
    await expect(new ProxyHubApi(refusing(() => true)).read(config)).rejects.toThrow(ProxyHubRejected);
    const profileRefused = refusing((call) => call.url.endsWith("/profile"));
    await expect(new ProxyHubApi(profileRefused).read(config)).rejects.toThrow(ProxyHubRejected);
  });

  it("caps account reads across concurrent hubs", async () => {
    let active = 0;
    let maximum = 0;
    const request: typeof fetch = async (input, init) => {
      if (init?.method === "GET") {
        const url = typeof input === "string" || input instanceof URL ? input : input.url;
        const host = new URL(url).host;
        return Response.json({
          files: Array.from({ length: 5 }, (_, index) => ({
            id: `${host}-${index}`,
            auth_index: `${host}-${index}`,
            provider: "claude",
          })),
        });
      }
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return Response.json({ status_code: 200, body: JSON.stringify({ five_hour: null }) });
    };
    const api = new ProxyHubApi(request);
    await Promise.all([api.read(config), api.read({ ...config, id: "work", url: "http://work.test:8317" })]);
    expect(maximum).toBe(4);
  });

  it("rejects malformed account lists without exposing the management key", async () => {
    const api = fixture([{ id: "broken", provider: "codex" }]).api;
    const error = await api.read(config).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("unexpected account list");
    expect((error as Error).message).not.toContain(config.managementKey);
  });
});

function requestBody(init: RequestInit | undefined): string {
  if (typeof init?.body !== "string") throw new Error("Expected a JSON request body.");
  return init.body;
}
