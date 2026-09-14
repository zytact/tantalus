// Drive the running preview's window over the Chrome DevTools Protocol that launch.sh opened.
//   drive.ts snapshot                       print the page's accessibility tree
//   drive.ts click <role> <name>            click an element by ARIA role and accessible name
//   drive.ts press <key>                    press a key or chord, e.g. Control+R
//   drive.ts screenshot <dir> [name]        save the window's page as <dir>/<name>.png
// Prefix any command with `--web <url>` to run it against the remote access page instead, in a fresh
// headless Chrome at phone size. TANTALUS_CHROME overrides the Chrome executable.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const RUN_DIR = "/tmp/opencode/tantalus-verify";
const argv = process.argv.slice(2);
const webUrl = argv[0] === "--web" ? argv[1] : null;
const [command, ...args] = webUrl ? argv.slice(2) : argv;
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
  switch (command) {
    case "snapshot":
      console.log(await page.locator("body").ariaSnapshot());
      break;
    case "click": {
      const [role, name] = args;
      await page.getByRole(role as Parameters<typeof page.getByRole>[0], { name, exact: true }).click();
      console.log(`CLICKED ${role} "${name}"`);
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
        "usage: drive.ts [--web URL] <snapshot | click ROLE NAME | press KEY | screenshot DIR [NAME]>",
      );
  }
} finally {
  // Disconnects without closing the preview, or closes the headless Chrome a --web run launched.
  await browser.close();
}
