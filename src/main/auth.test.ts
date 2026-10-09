import { describe, expect, it } from "vite-plus/test";
import { dataDirectories, distributionNames, findSignIns, parseCredentials } from "./auth";
import type { SignInHost } from "./auth";
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
      expect(parseCredentials("codex", raw)).toEqual({
        accessToken: "a",
        accountId: "id",
        email: null,
        plan: null,
        subscription_active_until_epoch: null,
        expires_at_epoch: null,
      });
    }
  });

  it("reads the Claude OAuth token and the Opencode Go key", () => {
    expect(parseCredentials("claude", '{"claudeAiOauth":{"accessToken":"a","refreshToken":"r"}}')).toEqual({
      accessToken: "a",
      accountId: null,
      email: null,
      plan: null,
      subscription_active_until_epoch: null,
      expires_at_epoch: null,
    });
    expect(
      parseCredentials("opencode", '{"google":{"type":"api","key":"g"},"opencode-go":{"type":"api","key":"a"}}'),
    ).toEqual({
      accessToken: "a",
      accountId: null,
      email: null,
      plan: "Go",
      subscription_active_until_epoch: null,
      expires_at_epoch: null,
    });
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
      JSON.stringify({
        email: "codex@example.com",
        "https://api.openai.com/auth": {
          chatgpt_plan_type: "plus",
          chatgpt_subscription_active_until: "2099-01-01T00:00:00Z",
        },
      }),
    ).toString("base64url");
    expect(parseCredentials("codex", `{"tokens":{"access_token":"a","id_token":"e30.${payload}.signature"}}`)).toEqual({
      accessToken: "a",
      accountId: null,
      email: "codex@example.com",
      plan: "Plus",
      subscription_active_until_epoch: 4_070_908_800,
      expires_at_epoch: null,
    });
    expect(
      parseCredentials(
        "claude",
        '{"claudeAiOauth":{"accessToken":"a","subscriptionType":"max","rateLimitTier":"default_claude_max_20x"}}',
      ),
    ).toEqual({
      accessToken: "a",
      accountId: null,
      email: null,
      plan: "Max 20x",
      subscription_active_until_epoch: null,
      expires_at_epoch: null,
    });
  });

  it("reads Claude's expiry in milliseconds and leaves unknown expiry unreported", () => {
    const credentials = (expiresAt: unknown) =>
      parseCredentials("claude", JSON.stringify({ claudeAiOauth: { accessToken: "a", expiresAt } }));
    expect(credentials(1_791_023_563_253).expires_at_epoch).toBe(1_791_023_563);
    for (const expiresAt of [undefined, null, "1791023563253", 0, -1]) {
      expect(credentials(expiresAt).expires_at_epoch).toBeNull();
    }
  });

  it("reads WSL distribution names from either console encoding", () => {
    expect(distributionNames(Buffer.from("Ubuntu\r\nDebian\r\n", "utf16le"))).toEqual(["Ubuntu", "Debian"]);
    expect(distributionNames(Buffer.from("Ubuntu\nDebian\n"))).toEqual(["Ubuntu", "Debian"]);
    expect(distributionNames(Buffer.alloc(0))).toEqual([]);
  });
});

describe("sign-in discovery", () => {
  /** A Windows host with a Codex login in the Windows home and in two WSL homes. Every path it is asked
   * about is recorded, so a test can prove a source was never touched. */
  function windowsHost(env: NodeJS.ProcessEnv = {}) {
    const files = new Set([
      "C:\\Users\\a\\.codex\\auth.json",
      "\\\\wsl.localhost\\Ubuntu\\home\\a\\.codex\\auth.json",
      "\\\\wsl.localhost\\Ubuntu\\root\\.codex\\auth.json",
    ]);
    const touched: string[] = [];
    let listed = 0;
    const host: SignInHost = {
      platform: "win32",
      env,
      home: "C:\\Users\\a",
      exists: async (path) => {
        touched.push(path);
        return files.has(path);
      },
      list: async (path) => {
        touched.push(path);
        return path === "\\\\wsl.localhost\\Ubuntu\\home" ? ["a", "b"] : null;
      },
      distributions: async () => {
        listed += 1;
        return ["Ubuntu"];
      },
    };
    return { host, touched, listed: () => listed };
  }

  const ids = (signIns: { id: string; distribution: string | null }[]) =>
    signIns.map(({ id, distribution }) => [id, distribution]);

  it("finds every login across the Windows home and each WSL home", async () => {
    const { host } = windowsHost();
    expect(ids(await findSignIns("codex", { windows: true, wsl: true }, host))).toEqual([
      ["home", null],
      ["wsl:Ubuntu:/home/a", "Ubuntu"],
      ["wsl:Ubuntu:/root", "Ubuntu"],
    ]);
  });

  it("never touches WSL with WSL off", async () => {
    const { host, touched, listed } = windowsHost();
    expect(ids(await findSignIns("codex", { windows: true, wsl: false }, host))).toEqual([["home", null]]);
    expect(await dataDirectories("codex", { windows: true, wsl: false }, host)).toEqual(["C:\\Users\\a\\.codex"]);
    expect(listed()).toBe(0);
    expect(touched.some((path) => path.startsWith("\\\\wsl"))).toBe(false);
  });

  it("reads only WSL logins with Windows off", async () => {
    const { host, touched } = windowsHost();
    expect(ids(await findSignIns("codex", { windows: false, wsl: true }, host))).toEqual([
      ["wsl:Ubuntu:/home/a", "Ubuntu"],
      ["wsl:Ubuntu:/root", "Ubuntu"],
    ]);
    expect(touched.some((path) => path.startsWith("C:"))).toBe(false);
  });

  it("relocates only the Windows login with the provider's variable", async () => {
    const { host } = windowsHost({ CODEX_HOME: "D:\\codex" });
    const signIns = await findSignIns("codex", { windows: true, wsl: true }, { ...host, exists: async () => true });
    expect(signIns.map(({ path }) => path)).toEqual([
      "D:\\codex\\auth.json",
      "\\\\wsl.localhost\\Ubuntu\\home\\a\\.codex\\auth.json",
      "\\\\wsl.localhost\\Ubuntu\\home\\b\\.codex\\auth.json",
      "\\\\wsl.localhost\\Ubuntu\\root\\.codex\\auth.json",
    ]);
  });

  it("reads the home folder alone, whatever the toggles, off Windows", async () => {
    const { host, listed } = windowsHost();
    const linux: SignInHost = { ...host, platform: "linux", home: "/home/a", exists: async () => true };
    expect(ids(await findSignIns("claude", { windows: false, wsl: true }, linux))).toEqual([["home", null]]);
    expect(listed()).toBe(0);
  });
});
