import { describe, expect, it } from "vite-plus/test";
import { tailscaleFailure } from "./tailscale";

describe("tailscale failures", () => {
  it("names the cause without repeating the CLI's output", () => {
    const failure = tailscaleFailure({ code: 1, stderr: "not logged in, auth key tskey-secret" });
    expect(failure.message).toBe("Tailscale is not signed in.");
    expect(failure.message).not.toContain("tskey");
  });

  it("points at the approval link when Serve is off for the tailnet", () => {
    const link = "https://login.tailscale.com/f/serve?node=abc123";
    expect(
      tailscaleFailure({ killed: true, stdout: `Serve is not enabled.\nTo enable, visit:\n\n  ${link}\n` }).message,
    ).toBe(`Serve is off for this tailnet. Turn it on at ${link}`);
  });

  it("tells a missing CLI and a hung one apart from anything else", () => {
    expect(tailscaleFailure({ code: "ENOENT" }).message).toBe("Tailscale is not installed.");
    expect(tailscaleFailure({ killed: true, stderr: "" }).message).toBe("Tailscale did not respond.");
    expect(tailscaleFailure({ code: 1, stderr: "something new" }).message).toBe("Tailscale could not serve the page.");
  });
});
