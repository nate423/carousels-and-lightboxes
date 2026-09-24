// Whether the iOS strip's centre thumbnail ever changes width abruptly while
// it flattens and grows back: dragging and letting go, dragging again while
// it grows back, and the main carousel taking over. It eases over 200ms, so
// a frame-to-frame change of more than a few pixels is a flicker - #3's
// flash back to collapsed was 12px.
//
// Time-based animations stall for a few frames at a time in headless
// WebKit, so this is only meaningful in Chromium.
//
//   node dev/headless/flattening.mjs [chromium|webkit] [url]
import { launch, openPage, badge, wheel, PROBE, round } from "./lib.mjs";

const [engine = "chromium", url = "http://localhost:56576/ios-scrubber/"] = process.argv.slice(2);
const browser = await launch(engine);
const page = await openPage(browser, url);
console.log(engine, browser.version(), "|", await badge(page));
await page.evaluate(PROBE);

const LIMIT = 4;
const scenarios = [
  ["drag strip, settle", async () => { await wheel(page, "#strip", 40, 6, { settle: 900 }); }],
  ["drag again mid-grow-back", async () => {
    await wheel(page, "#strip", -40, 3, { settle: 260 });
    await wheel(page, "#strip", -40, 3, { settle: 90 });
    await wheel(page, "#strip", 40, 2, { settle: 900 });
  }],
  ["main takes over", async () => {
    await wheel(page, "#strip", 40, 4, { settle: 250 });
    await wheel(page, "#main-carousel", 120, 4);
  }],
  ["main takes over, strip flat", async () => {
    await wheel(page, "#strip", 40, 4, { settle: 40 });
    await wheel(page, "#main-carousel", 120, 6);
  }]
];
let failed = false;
for (const [label, run] of scenarios) {
  await page.evaluate(() => window.__takeFrames());
  await run();
  const frames = await page.evaluate(() => window.__takeFrames());
  let worst = 0;
  let at = -1;
  for (let i = 1; i < frames.length; i++) {
    // Only between frames showing the same thumbnail at the centre.
    if (frames[i].centre.k !== frames[i - 1].centre.k) continue;
    const step = Math.abs(frames[i].centre.width - frames[i - 1].centre.width);
    if (step > worst) [worst, at] = [step, i];
  }
  failed ||= worst > LIMIT;
  const around = at < 0 ? [] : frames.slice(Math.max(0, at - 3), at + 3).map((f) => round(f.centre.width));
  console.log(
    label.padEnd(28),
    `frames ${frames.length}`,
    `rests at ${round(frames.at(-1)?.centre.width ?? 0)}px`,
    `worst step ${round(worst)}px`,
    worst > LIMIT ? `FLICKER around ${JSON.stringify(around)}` : "ok"
  );
}
await browser.close();
process.exitCode = failed ? 1 : 0;
