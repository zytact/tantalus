// Drive the running preview's window over the Chrome DevTools Protocol that launch.sh opened.
//   drive.ts snapshot                       print the page's accessibility tree
//   drive.ts click <role> <name>            click an element by ARIA role and accessible name
//   drive.ts press <key>                    press a key or chord, e.g. Control+R
//   drive.ts screenshot <dir> [name]        save the window's page as <dir>/<name>.png
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright-core";

const RUN_DIR = "/tmp/opencode/tantalus-verify";
const [command, ...args] = process.argv.slice(2);
const port = readFileSync(join(RUN_DIR, "run.cdp"), "utf8").trim();
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
try {
  const page = browser.contexts().flatMap((context) => context.pages())[0];
  if (!page) throw new Error("The preview has no open window. Open it from the tray or relaunch.");
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
      await page.screenshot({ path });
      console.log(`SCREENSHOT: ${path}`);
      break;
    }
    default:
      throw new Error("usage: drive.ts <snapshot | click ROLE NAME | press KEY | screenshot DIR [NAME]>");
  }
} finally {
  // Disconnects without closing the preview.
  await browser.close();
}
