import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { readActivity } from "./activity";

let root: string;
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function session(path: string, ageMinutes: number, now: number) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, "");
  const time = new Date(now - ageMinutes * 60_000);
  utimesSync(path, time, time);
}

describe("local activity", () => {
  it("counts a session file changed within the last few polls, and nothing older", async () => {
    root = mkdtempSync(join(tmpdir(), "tantalus-activity-"));
    vi.stubEnv("CODEX_HOME", join(root, "codex"));
    vi.stubEnv("CLAUDE_CONFIG_DIR", join(root, "claude"));
    vi.stubEnv("XDG_DATA_HOME", join(root, "data"));
    const now = new Date(2026, 8, 25, 14, 0).getTime();
    session(join(root, "codex", "sessions", "2026", "09", "25", "rollout.jsonl"), 5, now);
    session(join(root, "claude", "projects", "tantalus", "session.jsonl"), 60, now);
    session(join(root, "data", "opencode", "opencode.db-wal"), 1, now);
    expect(await readActivity(now)).toEqual({ codex: true, claude: false, opencode: true });
  });
});
