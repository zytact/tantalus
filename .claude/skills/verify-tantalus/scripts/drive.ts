// Drive the running preview's window over the Chrome DevTools Protocol that launch.sh opened.
//   drive.ts snapshot                       print the page's accessibility tree
//   drive.ts click <role> <name>            click an element by ARIA role and accessible name
//   drive.ts fill <role> <name> <text>      replace a field's text, e.g. fill textbox "Hub URL" http://...
//   drive.ts submit <role> <name> <text>    fill a field, then press Enter to submit its form
//   drive.ts scroll|hover|focus <role> <name> scroll to, hover, or focus an element
//   drive.ts press <key>                    press a key or chord, e.g. Control+R
//   drive.ts screenshot <dir> [name]        save the window's page as <dir>/<name>.png
//   drive.ts wait <seconds>                 keep the page open that long
// Join commands with `then` to run them in order on one page, e.g. `click button Refresh then snapshot`.
// A --web page lives only for one invocation, so this is how to read what a click on it did.
// Prefix any command with `--web <url>` to run it against the remote access page instead, in a
// headless Chrome at phone size, or a headless Windows Edge on WSL. Its profile lives in the run directory,
// so a pairing carries over from one --web command to the next until cleanup. TANTALUS_CHROME overrides
// the browser executable.
// Prefix any command with `--scheme light` or `--scheme dark` to render the page in that color scheme
// while the command runs. Without it the page follows the display's scheme. --nth INDEX selects a zero-based match.
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { basename, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import type { Page } from "playwright-core";

// Matches run-dir.sh, so this drives the preview launched from the same checkout.
const ROOT = realpathSync(fileURLToPath(new URL("../../../..", import.meta.url)));
const RUN_DIR = `/tmp/opencode/tantalus-verify/${basename(ROOT)}-${createHash("sha1").update(ROOT).digest("hex").slice(0, 8)}`;
const argv = process.argv.slice(2);
const option = (flag: string) => (argv[0] === flag ? argv.splice(0, 2)[1] : null);
const webUrl = option("--web");
const scheme = option("--scheme");
if (scheme !== null && scheme !== "light" && scheme !== "dark") throw new Error("--scheme takes light or dark.");
const nth = option("--nth");
if (nth !== null && !/^\d+$/.test(nth)) throw new Error("--nth takes a zero-based match index.");
const matchIndex = nth === null ? null : Number(nth);
if (matchIndex !== null && !Number.isSafeInteger(matchIndex)) throw new Error("--nth index is too large.");
/** The commands to run in order, split at each `then`. */
const steps = argv.reduce<string[][]>(
  (list, word) => (word === "then" ? [...list, []] : [...list.slice(0, -1), [...list.at(-1)!, word]]),
  [[]],
);
const phone = { width: 390, height: 844 };
// Matches run-dir.sh: on WSL the preview runs on Windows (see wsl.md).
const windows = Boolean(process.env.WSL_DISTRO_NAME) && !process.env.TANTALUS_VERIFY_LINUX;

/** The page to drive, and how to let it go. */
type Session = { page: Page; close: () => Promise<void> };

/** The preview's window over the DevTools port launch.sh recorded. Closing only disconnects. */
async function previewWindow(): Promise<Session> {
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${readFileSync(join(RUN_DIR, "run.cdp"), "utf8").trim()}`);
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  if (!page) {
    await browser.close();
    throw new Error("The preview has no open window. Open it from the tray or relaunch.");
  }
  return { page, close: () => browser.close() };
}

async function linuxWeb(): Promise<Session> {
  const context = await chromium.launchPersistentContext(join(RUN_DIR, "web-profile"), {
    executablePath: process.env.TANTALUS_CHROME ?? "/usr/bin/google-chrome",
    viewport: phone,
  });
  return { page: await context.newPage(), close: () => context.close() };
}

/** A headless Edge on Windows, where the preview's web port is, reached through windows-relay.mjs. Its
 * profile lives beside the preview's state under %LOCALAPPDATA%, since a profile on WSL's disk fails. */
async function windowsWeb(): Promise<Session> {
  const windowsPath = (path: string) => execFileSync("wslpath", [path], { encoding: "utf8" }).trim();
  const localAppData = execFileSync("cmd.exe", ["/d", "/c", "echo %LOCALAPPDATA%"], { cwd: "/mnt/c", encoding: "utf8" });
  const profile = join(windowsPath(localAppData.trim()), "tantalus-verify", basename(RUN_DIR), "web-profile");
  const portFile = join(profile, "DevToolsActivePort");
  rmSync(portFile, { force: true });
  const edge = process.env.TANTALUS_CHROME ?? "/mnt/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
  const windowsProfile = execFileSync("wslpath", ["-w", profile], { encoding: "utf8" }).trim();
  spawn(edge, [`--user-data-dir=${windowsProfile}`, "--headless", "--no-first-run", "--remote-debugging-port=0"], {
    cwd: "/mnt/c",
    stdio: "ignore",
  }).unref();
  for (let tries = 0; !existsSync(portFile) && tries < 30; tries++) await sleep(500);
  const windowsPort = readFileSync(portFile, "utf8").split("\n")[0].trim();
  const localPort = await new Promise<number>((resolve) => {
    const server = createServer().listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      server.close(() => resolve(port));
    });
  });
  const relay = spawn(process.execPath, [join(import.meta.dirname, "windows-relay.mjs"), windowsPort, String(localPort)], {
    stdio: "ignore",
  });
  await sleep(500);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${localPort}`);
  const page = await browser.contexts()[0].newPage();
  await page.setViewportSize(phone);
  return {
    page,
    close: async () => {
      // Disconnecting would leave Edge running, so ask it to quit.
      await (await browser.newBrowserCDPSession()).send("Browser.close").catch(() => {});
      relay.kill();
    },
  };
}

const { page, close } = await (webUrl ? (windows ? windowsWeb() : linuxWeb()) : previewWindow());
try {
  if (webUrl) {
    const response = await page.goto(webUrl);
    if (!response?.ok()) throw new Error(`The remote page answered ${response?.status() ?? "nothing"}.`);
    // The snapshot arrives over server-sent events after the page loads. An unpaired browser gets
    // the pairing form instead.
    await page.locator("h2, form").first().waitFor({ timeout: 10_000 });
  }
  await page.waitForLoadState("load");
  if (scheme) await page.emulateMedia({ colorScheme: scheme });
  const target = (role: string, name: string) => {
    const matches = page.getByRole(role as Parameters<typeof page.getByRole>[0], { name, exact: true });
    return matchIndex === null ? matches : matches.nth(matchIndex);
  };
  for (const [command, ...args] of steps) switch (command) {
    case "snapshot":
      console.log(await page.locator("body").ariaSnapshot());
      break;
    case "click": {
      const [role, name] = args;
      await target(role, name).click();
      console.log(`CLICKED ${role} "${name}"`);
      break;
    }
    case "fill": {
      const [role, name, text] = args;
      await target(role, name).fill(text);
      console.log(`FILLED ${role} "${name}"`);
      break;
    }
    case "submit": {
      const [role, name, text] = args;
      await target(role, name).fill(text);
      await target(role, name).press("Enter");
      await page.waitForLoadState("load");
      console.log(`SUBMITTED ${role} "${name}"`);
      break;
    }
    case "scroll": {
      const [role, name] = args;
      await target(role, name).scrollIntoViewIfNeeded();
      console.log(`SCROLLED to ${role} "${name}"`);
      break;
    }
    case "hover": {
      const [role, name] = args;
      await target(role, name).hover();
      console.log(`HOVERED ${role} "${name}"`);
      break;
    }
    case "focus": {
      const [role, name] = args;
      await page.keyboard.press("Tab");
      await target(role, name).focus();
      console.log(`FOCUSED ${role} "${name}"`);
      break;
    }
    case "press":
      await page.keyboard.press(args[0]);
      console.log(`PRESSED ${args[0]}`);
      break;
    case "screenshot": {
      const path = join(args[0], `${args[1] ?? "screenshot"}.png`);
      await page.screenshot({ path, fullPage: webUrl !== null });
      console.log(`SCREENSHOT: ${path}`);
      break;
    }
    case "wait":
      await page.waitForTimeout(Number(args[0]) * 1000);
      console.log(`WAITED ${args[0]}s`);
      break;
    default:
      throw new Error(
        "usage: drive.ts [--web URL] [--scheme light|dark] [--nth INDEX] <snapshot | click ROLE NAME | fill ROLE NAME TEXT | submit ROLE NAME TEXT | scroll ROLE NAME | hover ROLE NAME | focus ROLE NAME | press KEY | screenshot DIR [NAME] | wait SECONDS> [then <command> ...]",
      );
  }
} finally {
  await close();
}
