import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("electron", () => ({ app: { getVersion: () => "0.0.1" } }));

import { Updater } from "./update";

afterEach(() => vi.unstubAllGlobals());

describe("direct update limit", () => {
  it("offers a fresh install without requiring an automatic update asset", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ version: "0.0.25", minimumVersion: "0.0.10", notices: [], platforms: {} })),
        ),
    );
    const updater = new Updater(vi.fn(), vi.fn());
    expect(await updater.check()).toEqual({ version: "0.0.25", manualInstall: true, notices: [] });
    await expect(updater.install([])).rejects.toThrow("fresh install");
  });
});
