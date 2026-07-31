#!/usr/bin/env node
// Minimal chromium-cli-style REPL for driving Job Autopilot when
// chromium-cli itself isn't installed. Reads commands from stdin, one per
// line. Playwright's own selector engine already understands `text=...`
// and `:has-text(...)` the same way chromium-cli's do, so no translation
// layer is needed.
//
// Usage:
//   node .claude/skills/run-job-autopilot/driver.mjs <<'EOF'
//   nav http://localhost:3005
//   wait-for text=Dashboard
//   screenshot /tmp/dashboard.png
//   click text=Sync Gmail leads
//   wait 1000
//   screenshot /tmp/after-click.png
//   text
//   EOF
//
// Commands:
//   nav <url>              go to a URL, waits for networkidle
//   wait-for <selector>     wait up to 15s for a selector to appear
//   click <selector>        click it
//   fill <selector> <text>  fill an input/textarea
//   press <key>             press a keyboard key (e.g. Enter)
//   screenshot [path]       save a screenshot (default /tmp/screenshot-<ts>.png)
//   wait <ms>               fixed wait, only for animations -- prefer wait-for
//   text                    print page.textContent("body") to stdout
//   eval <js>               evaluate JS in the page, print the result

import { chromium } from "playwright";
import readline from "node:readline";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (msg) => {
  if (msg.type() === "error") console.error(`[console.error] ${msg.text()}`);
});

const rl = readline.createInterface({ input: process.stdin });
for await (const line of rl) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const spaceIdx = trimmed.indexOf(" ");
  const cmd = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const arg = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1);

  try {
    switch (cmd) {
      case "nav":
        await page.goto(arg, { waitUntil: "networkidle" });
        console.log(`nav ok: ${arg}`);
        break;
      case "wait-for":
        await page.waitForSelector(arg, { timeout: 15000 });
        console.log(`wait-for ok: ${arg}`);
        break;
      case "click":
        await page.click(arg);
        console.log(`click ok: ${arg}`);
        break;
      case "fill": {
        const fillSpace = arg.indexOf(" ");
        const sel = fillSpace === -1 ? arg : arg.slice(0, fillSpace);
        const val = fillSpace === -1 ? "" : arg.slice(fillSpace + 1);
        await page.fill(sel, val);
        console.log(`fill ok: ${sel}`);
        break;
      }
      case "press":
        await page.keyboard.press(arg);
        console.log(`press ok: ${arg}`);
        break;
      case "screenshot": {
        const path = arg || `/tmp/screenshot-${Date.now()}.png`;
        await page.screenshot({ path });
        console.log(`screenshot saved: ${path}`);
        break;
      }
      case "wait":
        await page.waitForTimeout(Number(arg) || 500);
        break;
      case "text":
        console.log(await page.textContent("body"));
        break;
      case "eval":
        console.log(await page.evaluate(arg));
        break;
      default:
        console.error(`unknown command: ${cmd}`);
    }
  } catch (err) {
    console.error(`command failed: "${trimmed}" -> ${err instanceof Error ? err.message : err}`);
  }
}

await browser.close();
