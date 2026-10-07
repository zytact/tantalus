// Drive the running preview's window over the Chrome DevTools Protocol that launch.sh opened.
//   drive.ts snapshot                       print the page's accessibility tree
//   drive.ts click <role> <name>            click an element by ARIA role and accessible name
//   drive.ts fill <role> <name> <text>      replace a field's text, e.g. fill textbox "Hub URL" http://...
//   drive.ts scroll|hover|focus <role> <name> scroll to, hover, or focus an element
//   drive.ts press <key>                    press a key or chord, e.g. Control+R
//   drive.ts screenshot <dir> [name]        save the window's page as <dir>/<name>.png
// Prefix any command with `--web <url>` to run it against the remote access page instead, in a fresh
// headless Chrome at phone size. TANTALUS_CHROME overrides the Chrome executable.
// Prefix any command with `--scheme light` or `--scheme dark` to render the page in that color scheme
// while the command runs. Without it the page follows the display's scheme. --nth INDEX selects a zero-based match.
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

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
const [command, ...args] = argv;
const browser = webUrl
  ? await chromium.launch({ executablePath: process.env.TANTALUS_CHROME ?? "/usr/bin/google-chrome" })
  : await chromium.connectOverCDP(`http://127.0.0.1:${readFileSync(join(RUN_DIR, "run.cdp"), "utf8").trim()}`);
try {
  const page = webUrl
    ? await browser.newPage({ viewport: { width: 390, height: 844 } })
    : browser.contexts().flatMap((context) => context.pages())[0];
  if (!page) throw new Error("The preview has no open window. Open it from the tray or relaunch.");
  if (webUrl) {
    const response = await page.goto(webUrl);
    if (!response?.ok()) throw new Error(`The remote page answered ${response?.status() ?? "nothing"}.`);
    // The snapshot arrives over server-sent events after the page loads.
    await page.locator("h2").first().waitFor({ timeout: 10_000 });
  }
  await page.waitForLoadState("load");
  if (scheme) await page.emulateMedia({ colorScheme: scheme });
  const target = (role: string, name: string) => {
    const matches = page.getByRole(role as Parameters<typeof page.getByRole>[0], { name, exact: true });
    return matchIndex === null ? matches : matches.nth(matchIndex);
  };
  switch (command) {
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
    default:
      throw new Error(
        "usage: drive.ts [--web URL] [--scheme light|dark] [--nth INDEX] <snapshot | click ROLE NAME | fill ROLE NAME TEXT | scroll ROLE NAME | hover ROLE NAME | focus ROLE NAME | press KEY | screenshot DIR [NAME]>",
      );
  }
} finally {
  // Disconnects without closing the preview, or closes the headless Chrome a --web run launched.
  await browser.close();
}
