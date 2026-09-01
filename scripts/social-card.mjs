/**
 * Renders the image that appears when a link to the site is shared.
 *
 *   node scripts/social-card.mjs
 *
 * Without one, a post on LinkedIn or anywhere else shows a bare text link, and
 * the thing this project is actually about, an answer with its source beside
 * it, is invisible until someone clicks. So the card shows exactly that: a
 * passage on the left, an answer citing it on the right.
 *
 * Drawn with the same tokens as the interface, in the browser that already
 * comes with the test tooling, so there is nothing new to install and the card
 * cannot drift away from the product's own colours.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "playwright";

const out = join(new URL("..", import.meta.url).pathname, "apps", "web", "public", "og.png");

const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><style>
  :root {
    --bg: oklch(0.16 0.008 265);
    --raised: oklch(0.2 0.009 265);
    --sunken: oklch(0.13 0.008 265);
    --line: oklch(0.28 0.01 265);
    --ink: oklch(0.95 0.004 260);
    --muted: oklch(0.72 0.01 260);
    --faint: oklch(0.605 0.012 260);
    --accent: oklch(0.72 0.17 45);
    --accent-contrast: oklch(0.16 0.01 265);
    --highlight: oklch(0.9 0.13 90 / 0.28);
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1200px; height: 630px; background: var(--bg); color: var(--ink);
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    padding: 60px; display: flex; flex-direction: column; gap: 26px;
  }
  .top { display: flex; align-items: center; gap: 14px; }
  .mark { width: 34px; height: 34px; }
  .name { font-size: 25px; font-weight: 600; letter-spacing: -0.02em; }
  h1 { font-size: 58px; font-weight: 600; letter-spacing: -0.035em; line-height: 1.06; max-width: 15ch; }
  .sub { font-size: 22px; color: var(--muted); line-height: 1.45; max-width: 52ch; }
  .panes { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 10px; }
  .pane { background: var(--raised); border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; }
  .label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.09em; color: var(--faint); margin-bottom: 10px; }
  .doc { font-size: 15px; line-height: 1.62; color: var(--muted); }
  .doc mark { background: var(--highlight); color: var(--ink); border-radius: 3px; padding: 1px 2px; }
  .answer { font-size: 16px; line-height: 1.6; color: var(--ink); }
  .cite {
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 19px; height: 19px; padding: 0 5px; margin-left: 4px;
    background: var(--accent); color: var(--accent-contrast);
    border-radius: 5px; font-size: 12px; font-weight: 700; vertical-align: 1px;
  }
  .foot { margin-top: auto; display: flex; align-items: center; gap: 10px; font-size: 17px; color: var(--faint); }
  .dot { width: 4px; height: 4px; border-radius: 50%; background: var(--faint); }
</style></head>
<body>
  <div class="top">
    <svg class="mark" viewBox="0 0 24 24" fill="none">
      <path d="M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9Z" stroke="oklch(0.72 0.17 45)" stroke-width="1.7"
            stroke-linejoin="round"/>
      <path d="m3 7.5 9 4.5 9-4.5M12 12v9" stroke="oklch(0.72 0.17 45)" stroke-width="1.7"
            stroke-linejoin="round" opacity="0.55"/>
    </svg>
    <span class="name">RAG in the Box</span>
  </div>

  <h1>Answers that show their working.</h1>
  <p class="sub">Ask your documents a question. Press a number and the source scrolls to the
     sentence it came from. Runs on the Cloudflare free plan.</p>

  <div class="panes">
    <div class="pane">
      <div class="label">Source document</div>
      <div class="doc">Chlorophyll absorbs light most strongly in the blue and red parts of the
        spectrum. <mark>It reflects green, which is why leaves look green.</mark></div>
    </div>
    <div class="pane">
      <div class="label">Answer</div>
      <div class="answer">Leaves look green because chlorophyll reflects green light while
        absorbing blue and red<span class="cite">1</span></div>
    </div>
  </div>

  <div class="foot">
    <span>Open source</span><span class="dot"></span>
    <span>Self host it free</span><span class="dot"></span>
    <span>rib.mwhassan.com</span>
  </div>
</body>
</html>`;

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
});
await page.setContent(html, { waitUntil: "load" });
const buffer = await page.screenshot({ type: "png" });
await browser.close();

writeFileSync(out, buffer);
console.log(`Wrote ${out} (${Math.round(buffer.length / 1024)} KB, 2400x1260)`);
