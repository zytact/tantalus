import { describe, expect, it } from "vite-plus/test";
import { emptyProviderUsage, namedHubAccounts, remainingUsage } from "./usage";
import type { ProxyHubProviderId } from "./usage";

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
