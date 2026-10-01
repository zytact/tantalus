import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { defaultPaceSettings } from "../shared/pace";
import { emptyProviderUsage, fiveHourSeconds } from "../shared/usage";
import type { ProviderUsage, UsageSnapshot } from "../shared/usage";
import type { WindowStartSettings } from "../shared/window-start";
import type { Cli } from "./cli";
import { saveSettings } from "./settings";
import { idleWindow, WindowStarter } from "./window-start";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function reading(epoch: number, used: number, reset: number | null): ProviderUsage {
  return {
    ...emptyProviderUsage(),
    five_hour: { used_percent: used, limit_window_seconds: fiveHourSeconds, reset_at_epoch: reset },
    last_successful_update_epoch: epoch,
    status: "ready",
  };
}

const idle = (epoch: number) => reading(epoch, 0, null);
const running = (epoch: number) => reading(epoch, 4, epoch + 3600);

function snapshot(claude: ProviderUsage): UsageSnapshot {
  return {
    codex: emptyProviderUsage(),
    claude,
    opencode: emptyProviderUsage(),
    enabled: { codex: false, claude: true, opencode: false },
    proxy_hubs: [],
    pace: { settings: defaultPaceSettings, windows: {} },
  };
}

const claudeOnly: WindowStartSettings = {
  enabled: true,
  providers: { claude: { enabled: true, path: null }, codex: { enabled: false, path: null } },
};

function starter(settings: WindowStartSettings, run: (cli: Cli) => Promise<void> = async () => {}) {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-start-"));
  directories.push(directory);
  const path = join(directory, "window-start.json");
  saveSettings(path, settings);
  const cli: Cli = { file: "claude", args: [], shell: false, label: "claude" };
  const runs: Cli[] = [];
  let started = 0;
  const instance = new WindowStarter(
    path,
    async () => cli,
    (command) => {
      runs.push(command);
      return run(command);
    },
    () => started++,
  );
  return { instance, runs, started: () => started };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("idle windows", () => {
  it("reads a window with nothing used and no reset running as idle", () => {
    expect(idleWindow(idle(1000))).toBe(true);
    expect(idleWindow(reading(1000, 0, 1000 + fiveHourSeconds - 5))).toBe(true);
  });

  it("reads a started, used, stale or blocked window as busy", () => {
    expect(idleWindow(reading(1000, 0, 1000 + fiveHourSeconds - 600))).toBe(false);
    expect(idleWindow(reading(1000, 1, null))).toBe(false);
    expect(idleWindow({ ...idle(1000), status: "stale" })).toBe(false);
    expect(idleWindow({ ...idle(1000), allowed: false })).toBe(false);
  });
});

describe("window starter", () => {
  it("starts a window once it has sat idle for 5 minutes, and only once", async () => {
    const { instance, runs, started } = starter(claudeOnly);
    instance.observe(snapshot(idle(1000)));
    instance.observe(snapshot(idle(1200)));
    expect(runs).toHaveLength(0);
    instance.observe(snapshot(idle(1300)));
    instance.observe(snapshot(idle(1310)));
    await settle();
    expect(runs).toHaveLength(1);
    expect(started()).toBe(1);
    expect((await instance.read()).providers.claude.last).toMatchObject({ error: null });
  });

  it("waits again after a reading that is not idle", async () => {
    const { instance, runs } = starter(claudeOnly);
    instance.observe(snapshot(idle(1000)));
    instance.observe(snapshot(running(1200)));
    instance.observe(snapshot(idle(1300)));
    await settle();
    expect(runs).toHaveLength(0);
  });

  it("runs nothing while switched off", async () => {
    const { instance, runs } = starter({ ...claudeOnly, enabled: false });
    instance.observe(snapshot(idle(1000)));
    instance.observe(snapshot(idle(1300)));
    await settle();
    expect(runs).toHaveLength(0);
  });

  it("keeps the reason a start failed", async () => {
    const { instance, started } = starter(claudeOnly, async () => {
      throw new Error("claude exited with code 1: not logged in");
    });
    instance.observe(snapshot(idle(1000)));
    instance.observe(snapshot(idle(1300)));
    await settle();
    expect(started()).toBe(0);
    expect((await instance.read()).providers.claude.last?.error).toBe("claude exited with code 1: not logged in");
  });
});
