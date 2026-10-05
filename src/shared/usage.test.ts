import { describe, expect, it } from "vite-plus/test";
import { emptyProviderUsage, numberedHubAccounts } from "./usage";
import type { ProxyHubProviderId } from "./usage";

const account = (id: string, provider: ProxyHubProviderId) => ({
  id,
  email: null,
  plan: null,
  provider,
  usage: emptyProviderUsage(),
});

describe("numberedHubAccounts", () => {
  it("numbers accounts within each provider", () => {
    const numbered = numberedHubAccounts([
      account("a", "claude"),
      account("b", "codex"),
      account("c", "codex"),
      account("d", "claude"),
    ]);
    expect(numbered.map(({ id, number }) => [id, number])).toEqual([
      ["a", 1],
      ["b", 1],
      ["c", 2],
      ["d", 2],
    ]);
  });
});
