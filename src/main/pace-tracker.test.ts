import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vite-plus/test";
import { emptyProviderUsage } from "../shared/usage";
import type { UsageSnapshot } from "../shared/usage";
import { defaultPaceSettings } from "../shared/pace";
import { noActivity, PaceTracker } from "./pace-tracker";
import { loadPaceLogs, saveSettings } from "./settings";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

it("forgets what every window learned and starts each again from the current reading", () => {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-pace-"));
  directories.push(directory);
  const log = join(directory, "pace-log.json");
  const now = 1_800_000_000;
  const learned = { firstSeen: now - 30 * 86_400, stretch: null, readings: [2, 3] };
  saveSettings(log, {
    "codex:604800": { ...learned, last: { epoch: now - 600, used: 4, resetAt: null } },
    "claude:18000": { ...learned, last: { epoch: now - 600, used: 9, resetAt: null } },
  });
  const pace = new PaceTracker(log, join(directory, "pace.json"), async () => noActivity);
  const snapshot: UsageSnapshot = {
    codex: {
      ...emptyProviderUsage(),
      seven_day: { used_percent: 5, limit_window_seconds: 604_800, reset_at_epoch: null },
      last_successful_update_epoch: now - 60,
      status: "ready",
    },
    claude: emptyProviderUsage(),
    opencode: emptyProviderUsage(),
    enabled: { codex: true, claude: true, opencode: false },
    proxy_hubs: [],
    pace: { settings: defaultPaceSettings, windows: {} },
  };
  expect(pace.annotate(snapshot, now).pace.windows["codex:604800"]?.status).toBe("learned");

  expect(pace.reset(snapshot, now).pace.windows["codex:604800"]).toMatchObject({ status: "learning" });
  expect(loadPaceLogs(log)).toEqual({
    "codex:604800": {
      firstSeen: now - 60,
      last: { epoch: now - 60, used: 5, resetAt: null },
      stretch: null,
      readings: [],
    },
  });
});
