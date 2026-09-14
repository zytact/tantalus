import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { emptyProviderUsage } from "../shared/usage";
import type { ProviderId, ProviderUsage, UsageSnapshot } from "../shared/usage";
import { ReadFailure } from "./failure";
import { applyReading, nextBackoff, settled, UsageState } from "./usage-state";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
function settingsPath() {
  const directory = mkdtempSync(join(tmpdir(), "tantalus-state-"));
  directories.push(directory);
  return join(directory, "providers.json");
}

const ready = (used: number): ProviderUsage => ({
  ...emptyProviderUsage(),
  seven_day: { used_percent: used, limit_window_seconds: 604_800, reset_at_epoch: null },
  last_successful_update_epoch: 1,
  status: "ready",
});

/** A provider read that finishes only when the test releases it. */
function heldReads() {
  const reads: { id: ProviderId; release: (usage: ProviderUsage) => void }[] = [];
  const read = (id: ProviderId) => new Promise<ProviderUsage>((release) => reads.push({ id, release }));
  return { reads, read };
}

describe("usage state", () => {
  it("never reads a disabled provider", async () => {
    const read: ProviderId[] = [];
    const state = new UsageState(
      settingsPath(),
      async (id) => {
        read.push(id);
        return ready(1);
      },
      () => {},
    );
    await state.refresh();
    expect(read).toEqual(["codex", "claude"]);
  });

  it("drops a reading for a provider switched off while it was read", async () => {
    const { reads, read } = heldReads();
    const state = new UsageState(settingsPath(), read, () => {});
    const refreshed = state.refresh();
    await state.setProviderEnabled("codex", false);
    for (const { release } of reads) release(ready(42));
    expect((await refreshed).codex.status).toBe("loading");
    expect((await refreshed).claude.status).toBe("ready");
  });

  it("folds a refresh asked for mid-read into one more pass that both callers get", async () => {
    const { reads, read } = heldReads();
    const published: UsageSnapshot[] = [];
    const state = new UsageState(settingsPath(), read, (snapshot) => published.push(snapshot));
    const first = state.refresh();
    const second = state.refresh();
    expect(second).toBe(first);
    for (const { release } of reads.splice(0)) release(ready(1));
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve));
    expect(reads).toHaveLength(2);
    for (const { release } of reads) release(ready(2));
    expect((await first).codex.seven_day.used_percent).toBe(2);
    expect(published).toHaveLength(1);
  });

  it("reads a provider switched on during a refresh", async () => {
    const { reads, read } = heldReads();
    const state = new UsageState(settingsPath(), read, () => {});
    const refreshed = state.refresh();
    const enabled = state.setProviderEnabled("opencode", true);
    for (const { release } of reads.splice(0)) release(ready(1));
    await new Promise((resolve) => setTimeout(resolve));
    expect(reads.map(({ id }) => id)).toEqual(["codex", "claude", "opencode"]);
    for (const { release } of reads) release(ready(3));
    expect((await enabled).opencode.status).toBe("ready");
    expect(await refreshed).toBe(await enabled);
  });

  it("keeps the current snapshot when the choice cannot be saved", async () => {
    const path = settingsPath();
    const state = new UsageState(
      path,
      async () => ready(42),
      () => {},
    );
    await state.refresh();
    const directory = join(path, "..");
    rmSync(directory, { recursive: true });
    writeFileSync(directory, "not a directory");
    expect(() => state.setProviderEnabled("codex", false)).toThrow();
    expect(state.snapshot.enabled.codex).toBe(true);
    expect(state.snapshot.codex.seven_day.used_percent).toBe(42);
  });
});

describe("failed readings", () => {
  it("keep a previous reading as stale and tell a missing login from a failure", () => {
    expect(applyReading(ready(5), new ReadFailure("timeout")).status).toBe("stale");
    expect(applyReading(ready(5), new ReadFailure("timeout")).seven_day.used_percent).toBe(5);
    expect(applyReading(emptyProviderUsage(), new ReadFailure("missingToken")).status).toBe("auth_missing");
    const failed = applyReading(emptyProviderUsage(), new ReadFailure("response"));
    expect(failed.status).toBe("error");
    expect(failed.error_message).toBe("The usage service returned an unexpected response");
  });
});

describe("polling", () => {
  it("retries a failure sooner and climbs back to the normal interval", () => {
    const waits: number[] = [];
    let backoff: number | null = null;
    for (let attempt = 0; attempt < 9; attempt++) {
      backoff = nextBackoff(false, backoff, 5000, 300_000);
      if (backoff !== null) waits.push(backoff);
    }
    expect(waits.slice(0, 3)).toEqual([5000, 10_000, 20_000]);
    expect(waits.at(-1)).toBe(300_000);
    expect(nextBackoff(true, backoff, 5000, 300_000)).toBeNull();
  });

  it("does not hold back for a disabled provider", () => {
    const snapshot: UsageSnapshot = {
      codex: ready(1),
      claude: { ...emptyProviderUsage(), status: "error" },
      opencode: emptyProviderUsage(),
      enabled: { codex: true, claude: true, opencode: false },
    };
    expect(settled(snapshot)).toBe(false);
    expect(settled({ ...snapshot, enabled: { codex: true, claude: false, opencode: false } })).toBe(true);
  });
});
