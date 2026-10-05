import { describe, expect, it } from "vite-plus/test";
import { emptyProviderUsage, namedHubAccounts } from "./usage";
import type { ProxyHubProviderId } from "./usage";

const account = (id: string, provider: ProxyHubProviderId, email: string | null = null) => ({
  id,
  email,
  plan: null,
  provider,
  usage: emptyProviderUsage(),
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
