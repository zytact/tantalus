import { afterEach, expect, it, vi } from "vite-plus/test";
import { emptyProviderUsage } from "../shared/usage";
import type { ProviderUsage } from "../shared/usage";
import { accountKey, UsageApi } from "./api";
import { parseCredentials } from "./auth";

afterEach(() => vi.unstubAllGlobals());

const claude = (token: string) =>
  parseCredentials("claude", JSON.stringify({ claudeAiOauth: { accessToken: token, subscriptionType: "pro" } }));

it("reads a Claude sign-in again once it signs in to another account than the one it lends for", async () => {
  const requests = vi.fn(async (url: string) =>
    Response.json(
      url.includes("/profile") ? { account: { email: "first@example.test" } } : { five_hour: { utilization: 10 } },
    ),
  );
  vi.stubGlobal("fetch", requests);
  const api = new UsageApi();
  const hosted: ProviderUsage = { ...emptyProviderUsage(), status: "ready" };
  const known = (_provider: string, key: string | null) =>
    key === accountKey(null, "first@example.test", null) ? hosted : null;

  await api.read("claude", "claude:home", claude("first-token"), () => null);
  const reads = requests.mock.calls.length;
  expect(await api.read("claude", "claude:home", claude("first-token"), known)).toBe(hosted);
  expect(requests).toHaveBeenCalledTimes(reads);

  expect(await api.read("claude", "claude:home", claude("second-token"), known)).not.toBe(hosted);
  expect(requests.mock.calls.length).toBeGreaterThan(reads);
});
