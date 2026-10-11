import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
vi.mock("./release", () => ({ verifySignature: (data: Buffer, signature: string) => data.toString() === signature }));

import { installUpdate } from "./update-helper";

const installer = vi.mocked(execFileSync);
let directory: string;
let file: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "tantalus-helper-test-"));
  file = join(directory, "update.rpm");
  writeFileSync(file, "signed");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  installer.mockReset();
});

describe("update helper", () => {
  it("installs its own copy of a signed package, then removes it", () => {
    let installed = "";
    installer.mockImplementation((_command, args) => {
      installed = readFileSync(String(args?.at(-1)), "utf8");
      return "";
    });
    installUpdate(["rpm", file, "signed"]);
    const [command, args] = installer.mock.calls[0];
    const copy = String(args?.at(-1));
    expect([command, args?.slice(0, -1)]).toEqual(["/usr/bin/rpm", ["-U"]]);
    expect(dirname(copy)).not.toBe(directory);
    expect(installed).toBe("signed");
    expect(() => readFileSync(copy)).toThrow();
  });

  it("refuses a downgrade on a deb", () => {
    installUpdate(["deb", file, "signed"]);
    expect(installer.mock.calls[0][1]).toContain("--refuse-downgrade");
  });

  it("runs no installer for a package the release key did not sign", () => {
    expect(() => installUpdate(["rpm", file, "forged"])).toThrow("signature check");
    expect(() => installUpdate(["rpm", directory, "signed"])).toThrow("not a regular file");
    expect(() => installUpdate(["tar", file, "signed"])).toThrow("usage");
    expect(installer).not.toHaveBeenCalled();
  });
});
