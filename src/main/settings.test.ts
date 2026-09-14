import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";
import {
  defaultSettings,
  loadRemoteSettings,
  loadSettings,
  noProviders,
  noRemoteAccess,
  saveSettings,
} from "./settings";

let directory: string;
afterEach(() => rmSync(directory, { recursive: true, force: true }));
function path() {
  directory = mkdtempSync(join(tmpdir(), "tantalus-settings-"));
  return join(directory, "providers.json");
}

describe("provider settings", () => {
  it("starts from the defaults when nothing is saved", () => {
    expect(loadSettings(path())).toEqual(defaultSettings);
  });

  it("switches every provider off when the file is malformed", () => {
    const file = path();
    writeFileSync(file, "not json");
    expect(loadSettings(file)).toEqual(noProviders);
    writeFileSync(file, '{"codex":"yes","claude":true}');
    expect(loadSettings(file)).toEqual(noProviders);
  });

  it("keeps the choice a file written before Opencode existed recorded", () => {
    const file = path();
    writeFileSync(file, '{"codex":true,"claude":false}');
    expect(loadSettings(file)).toEqual({ codex: true, claude: false, opencode: false });
  });

  it("survives a reload", () => {
    const file = join(path(), "..", "nested", "providers.json");
    saveSettings(file, { codex: true, claude: false, opencode: true });
    expect(loadSettings(file)).toEqual({ codex: true, claude: false, opencode: true });
  });
});

describe("remote access settings", () => {
  it("keeps every route off until one is saved, and when the file is malformed", () => {
    const file = path();
    expect(loadRemoteSettings(file)).toEqual(noRemoteAccess);
    writeFileSync(file, '{"localNetwork":true}');
    expect(loadRemoteSettings(file)).toEqual(noRemoteAccess);
    saveSettings(file, { localNetwork: false, tailscale: true });
    expect(loadRemoteSettings(file)).toEqual({ localNetwork: false, tailscale: true });
  });
});
