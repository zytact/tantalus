import { describe, expect, it } from "vite-plus/test";
import { distributionNames, parseCredentials } from "./auth";
import { ReadFailure } from "./failure";

describe("credentials", () => {
  it("reads every token and account id field alternative", () => {
    for (const raw of [
      '{"tokens":{"access_token":"a","account_id":"id"}}',
      '{"tokens":{"access":"a","accountId":"id"}}',
      '{"access_token":"a","account_id":"id"}',
      '{"access":"a","accountId":"id"}',
      '{"chatgptAuthTokens":{"access_token":"a"},"chatgpt_account_id":"id"}',
      '{"chatgpt_auth":{"access_token":"a"},"chatgptAccountId":"id"}',
    ]) {
      expect(parseCredentials("codex", raw)).toEqual({ accessToken: "a", accountId: "id", email: null, plan: null });
    }
  });

  it("reads the Claude OAuth token and the Opencode Go key", () => {
    expect(parseCredentials("claude", '{"claudeAiOauth":{"accessToken":"a","refreshToken":"r"}}')).toEqual({
      accessToken: "a",
      accountId: null,
      email: null,
      plan: null,
    });
    expect(
      parseCredentials("opencode", '{"google":{"type":"api","key":"g"},"opencode-go":{"type":"api","key":"a"}}'),
    ).toEqual({ accessToken: "a", accountId: null, email: null, plan: "Go" });
  });

  it("tells a file without a token from one that is not JSON", () => {
    const reason = (raw: string) => {
      try {
        parseCredentials("codex", raw);
      } catch (error) {
        return error instanceof ReadFailure ? error.reason : error;
      }
    };
    expect(reason('{"google":{"type":"api","key":"g"}}')).toBe("missingToken");
    expect(reason('{"access_token":""}')).toBe("missingToken");
    expect(reason("{")).toBe("parse");
  });

  it("reads account details from Codex and Claude credentials", () => {
    const payload = Buffer.from(
      JSON.stringify({ email: "codex@example.com", "https://api.openai.com/auth": { chatgpt_plan_type: "plus" } }),
    ).toString("base64url");
    expect(parseCredentials("codex", `{"tokens":{"access_token":"a","id_token":"e30.${payload}.signature"}}`)).toEqual({
      accessToken: "a",
      accountId: null,
      email: "codex@example.com",
      plan: "Plus",
    });
    expect(
      parseCredentials(
        "claude",
        '{"claudeAiOauth":{"accessToken":"a","subscriptionType":"max","rateLimitTier":"default_claude_max_20x"}}',
      ),
    ).toEqual({ accessToken: "a", accountId: null, email: null, plan: "Max 20x" });
  });

  it("reads WSL distribution names from either console encoding", () => {
    expect(distributionNames(Buffer.from("Ubuntu\r\nDebian\r\n", "utf16le"))).toEqual(["Ubuntu", "Debian"]);
    expect(distributionNames(Buffer.from("Ubuntu\nDebian\n"))).toEqual(["Ubuntu", "Debian"]);
    expect(distributionNames(Buffer.alloc(0))).toEqual([]);
  });
});
