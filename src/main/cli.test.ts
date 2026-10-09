import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { resolveCli } from "./cli";
import type { Host } from "./cli";

const host = (platform: NodeJS.Platform, env: NodeJS.ProcessEnv, programs: string[], home = "/home/a"): Host => ({
  platform,
  env,
  home,
  exists: (path) => programs.includes(path),
});

describe("CLI lookup", () => {
  it("prefers the PATH over the known install directories", () => {
    const linux = host("linux", { PATH: "/usr/bin" }, ["/usr/bin/claude", "/home/a/.local/bin/claude"]);
    expect(resolveCli("claude", null, null, linux)?.file).toBe("/usr/bin/claude");
  });

  it("finds a Homebrew CLI from the bare PATH a macOS app gets", () => {
    const mac = host("darwin", { PATH: "/usr/bin:/bin" }, ["/opt/homebrew/bin/codex"], "/Users/a");
    expect(resolveCli("codex", null, null, mac)?.label).toBe("/opt/homebrew/bin/codex");
    expect(resolveCli("claude", null, null, mac)).toBeNull();
  });

  it("runs an npm shim on Windows through cmd.exe with every argument quoted", () => {
    const shim = "C:\\Users\\A B\\AppData\\Roaming\\npm\\codex.cmd";
    const windows = host("win32", { PATH: "", APPDATA: "C:\\Users\\A B\\AppData\\Roaming" }, [shim], "C:\\Users\\A B");
    const cli = resolveCli("codex", null, null, windows);
    expect(cli).toMatchObject({ file: `"${shim}"`, shell: true, label: shim });
    expect(cli?.args.every((arg) => arg.startsWith('"') && arg.endsWith('"'))).toBe(true);
  });

  it("runs the CLI natively for the Windows sign-in and in its distribution for a WSL one", () => {
    const native = "C:\\Users\\a\\.local\\bin\\claude.exe";
    const windows = host("win32", { PATH: "" }, [native], "C:\\Users\\a");
    expect(resolveCli("claude", null, null, windows)?.file).toBe(native);
    const cli = resolveCli("claude", null, "Ubuntu", windows);
    expect(cli?.file).toBe("wsl.exe");
    expect(cli?.args.slice(0, 7)).toEqual(["-d", "Ubuntu", "--cd", "/tmp", "--exec", "sh", "-lc"]);
    expect(cli?.args[8]).toBe("claude");
    expect(cli?.label).toBe("claude in WSL (Ubuntu)");
  });

  it("applies a configured Windows path to the Windows sign-in only", () => {
    const configured = "D:\\tools\\codex.exe";
    const windows = host("win32", { PATH: "" }, [], "C:\\Users\\a");
    expect(resolveCli("codex", configured, null, windows)?.file).toBe(configured);
    expect(resolveCli("codex", configured, "Debian", windows)?.label).toBe("codex in WSL (Debian)");
  });

  it("runs a configured POSIX path inside WSL on Windows", () => {
    const windows = host("win32", { PATH: "" }, [], "C:\\Users\\a");
    expect(resolveCli("codex", "/home/a/.local/bin/codex", null, windows)?.label).toBe(
      "/home/a/.local/bin/codex in WSL",
    );
  });

  it.runIf(process.platform !== "win32").each([0, 7])(
    "runs the WSL shell command in an empty temporary directory and preserves exit code %i",
    (code) => {
      const directory = mkdtempSync(join(tmpdir(), "tantalus-cli-test-"));
      try {
        const program = join(directory, "cli with spaces ' $(false)");
        writeFileSync(program, `#!/bin/sh\ntest -z "$(ls -A)" || exit 99\nprintf '%s\\n' "$PWD" "$@"\nexit ${code}\n`, {
          mode: 0o700,
        });
        const cli = resolveCli("codex", program, null, host("win32", {}, []));
        if (!cli) throw new Error("Expected a WSL command");
        const shell = cli.args.slice(cli.args.indexOf("--exec") + 1);
        const args = ["spaces and 'quotes'", "$(false)", "semi;colon", ""];
        const [file, ...shellArgs] = shell;
        if (!file) throw new Error("Expected a shell");
        const result = spawnSync(file, [...shellArgs, ...args], { encoding: "utf8", cwd: directory });
        expect(result.error).toBeUndefined();
        expect(result.status).toBe(code);
        const [cwd, ...received] = result.stdout.slice(0, -1).split("\n");
        if (!cwd) throw new Error("Expected a temporary working directory");
        expect(cwd).toMatch(/^\/tmp\/tantalus-start\./);
        expect(cwd).not.toBe(directory);
        expect(received).toEqual([...shell.slice(4), ...args]);
        expect(existsSync(cwd)).toBe(false);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
