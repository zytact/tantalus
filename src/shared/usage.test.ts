import { describe, expect, it } from "vite-plus/test";
import { defaultPaceSettings } from "./pace";
import { emptyProviderUsage, liveReading, namedHubAccounts, remainingUsage } from "./usage";
import type { ProxyHubProviderId, UsageSnapshot } from "./usage";

const account = (id: string, provider: ProxyHubProviderId, email: string | null = null) => ({
  id,
  email,
  plan: null,
  provider,
  usage: emptyProviderUsage(),
});

describe("remaining usage", () => {
  it("counts down to zero within the allowance", () => {
    expect([0, 12.7, 40, 100, 140, -5].map((used) => remainingUsage(used))).toEqual([100, 87.3, 60, 0, 0, 100]);
    expect(remainingUsage(350, 2000)).toBe(1650);
  });
});

describe("liveReading", () => {
  const hubAccount = (key: string, status: "ready" | "error") => ({
    ...account("a.json", "claude", "a@example.com"),
    plan: "Max 5x",
    usage: { ...emptyProviderUsage(), account_key: key, status },
  });
  const snapshot = (status: "ready" | "error"): UsageSnapshot => ({
    enabled: { codex: false, claude: false, opencode: false },
    sign_ins: null,
    accounts: [],
    proxy_hubs: [
      {
        id: "hub",
        url: "http://hub.test",
        label: "Hub",
        accounts: [hubAccount("key-a", status)],
        last_successful_update_epoch: null,
        status: "ready",
        error_message: null,
      },
    ],
    pace: { settings: defaultPaceSettings, windows: {} },
  });

  it("finds a hub's live reading by provider and key, with the email and plan the hub keeps beside it", () => {
    expect(liveReading(snapshot("ready"), "claude", "key-a")).toMatchObject({ email: "a@example.com", plan: "Max 5x" });
    expect(liveReading(snapshot("ready"), "codex", "key-a")).toBeNull();
    expect(liveReading(snapshot("ready"), "claude", null)).toBeNull();
  });

  it("lends nothing for a reading that failed", () => {
    expect(liveReading(snapshot("error"), "claude", "key-a")).toBeNull();
  });
});

describe("namedHubAccounts", () => {
  it("names accounts by email, numbering them within each provider for those without one", () => {
    const named = namedHubAccounts({
      label: "Work",
      accounts: [
        account("a", "claude"),
        account("b", "codex", "b@example.com"),
        account("c", "codex"),
        account("d", "claude"),
      ],
    });
    expect(named.map(({ id, name }) => [id, name])).toEqual([
      ["a", { title: "Work · Claude 1", email: null, label: "Work · Claude 1" }],
      ["b", { title: "Work · Codex", email: "b@example.com", label: "Work · Codex 1" }],
      ["c", { title: "Work · Codex 2", email: null, label: "Work · Codex 2" }],
      ["d", { title: "Work · Claude 2", email: null, label: "Work · Claude 2" }],
    ]);
  });
});
