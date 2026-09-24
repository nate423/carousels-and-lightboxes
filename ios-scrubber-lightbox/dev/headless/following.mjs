// Whether each linked carousel on the iOS scrubber page draws exactly what
// it should on every frame, while the other one leads it: the strip against
// the expand look's formula, the main carousel's centre items against the
// fade's, both from the main carousel's measured progress. A frame that's
// off - the first or last of following, say - shows up as a bad frame.
//
//   node dev/headless/following.mjs [chromium|webkit] [url]
import { launch, openPage, badge, wheel, PROBE, round } from "./lib.mjs";

const [engine = "chromium", url = "http://localhost:56576/ios-scrubber/"] = process.argv.slice(2);
const browser = await launch(engine);
const page = await openPage(browser, url);
console.log(engine, browser.version(), "|", await badge(page));
await page.evaluate(PROBE);

// While the strip leads it's flattened (flattenWhileLeading), which the
// formula doesn't describe, so only the main carousel is checked then.
const scenarios = [
  ["main leads, right", "#main-carousel", 100, 8, true],
  ["strip leads, right", "#strip", 60, 8, false],
  ["strip leads, left", "#strip", -60, 6, false],
  ["main leads, left", "#main-carousel", -100, 5, true]
];
let failed = false;
for (const [label, selector, dx, steps, checkStrip] of scenarios) {
  await page.evaluate(() => window.__takeFrames());
  await wheel(page, selector, dx, steps);
  const frames = await page.evaluate(() => window.__takeFrames());
  const bad = frames.filter((f) => (checkStrip && f.strip > 0.5) || f.opacity > 0.02);
  failed ||= bad.length > 0;
  console.log(
    label.padEnd(20),
    `frames ${frames.length}`,
    checkStrip ? `worst strip ${round(Math.max(0, ...frames.map((f) => f.strip)))}px` : "strip flattened, not checked",
    `worst opacity ${round(Math.max(0, ...frames.map((f) => f.opacity)), 3)}`,
    bad.length ? `BAD ${bad.length}: ${JSON.stringify(bad.slice(0, 3).map((f) => ({ P: round(f.P, 3), strip: round(f.strip), opacity: round(f.opacity, 3) })))}` : "ok"
  );
}
await browser.close();
process.exitCode = failed ? 1 : 0;
