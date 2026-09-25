// Checks that the filmstrip page's two carousels stay in step. Scrolls each
// one in turn, and on every frame compares both carousels' items with what
// the scale-fade look should draw at the scrolled carousel's position. A
// frame more than 0.5px off is bad, such as the other carousel drifting and
// then jumping into place (#15).
//
//   node dev/headless/filmstrip-following.mjs [chromium|webkit] [url]
import { launch, openPage, badge, wheel, round } from "./lib.mjs";

const [engine = "chromium", url = "http://localhost:56576/filmstrip/?seed=14"] = process.argv.slice(2);
const browser = await launch(engine);
const page = await openPage(browser, url);
console.log(engine, browser.version(), "|", await badge(page));

// Runs in the page, using the page's own math.
await page.evaluate(async () => {
  const { getItemMetrics, computeCurrentProgress } = await import("/shared/carousel-math.js");
  const { computeGapCompensatedFrame } = await import("/shared/effects/helpers/gap-compensation.js");
  const carousels = ["main-carousel", "strip"].map((id) => {
    const wrapper = document.getElementById(id);
    const items = [...wrapper.querySelectorAll(".carousel-item")];
    const css = getComputedStyle(wrapper);
    return {
      id,
      wrapper,
      items,
      ...getItemMetrics(wrapper, items),
      noncurrentScale: parseFloat(css.getPropertyValue("--noncurrent-scale"))
    };
  });

  // How far a carousel's items are from the look at progress P: the worst
  // of the seven items nearest the center, in position or width.
  function error(c, P) {
    const { anchors, sizes, wrapper, items } = c;
    const { scales, translations } = computeGapCompensatedFrame(anchors, sizes, c.noncurrentScale, P);
    const i0 = Math.floor(P);
    const anchorAtP = anchors[i0] + (P - i0) * ((anchors[i0 + 1] ?? anchors[i0]) - anchors[i0]);
    const box = wrapper.getBoundingClientRect();
    let worst = 0;
    for (let i = Math.max(0, Math.round(P) - 3); i <= Math.min(items.length - 1, Math.round(P) + 3); i++) {
      const r = items[i].getBoundingClientRect();
      const center = r.left + r.width / 2 - box.left;
      const expectedCenter = anchors[i] - anchorAtP + wrapper.offsetWidth / 2 + translations[i];
      worst = Math.max(worst, Math.abs(center - expectedCenter), Math.abs(r.width - sizes[i] * scales[i]));
    }
    return worst;
  }

  window.__frames = [];
  window.__leader = null;
  function measure() {
    const leader = carousels.find((c) => c.id === window.__leader);
    if (!leader) return;
    const P = computeCurrentProgress(leader.anchors, leader.wrapper.scrollLeft + leader.wrapper.offsetWidth / 2);
    // Skipped near either end, where the scrolled carousel's position stops
    // at the end but the look keeps going.
    if (P <= 0.02 || P >= leader.items.length - 1.02) return;
    const frame = { P };
    carousels.forEach((c) => (frame[c.id] = error(c, P)));
    window.__frames.push(frame);
  }
  function frame() {
    setTimeout(measure, 0);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__lead = (id) => { window.__leader = id; window.__frames = []; };
  window.__takeFrames = () => { const frames = window.__frames; window.__frames = []; return frames; };
});

const scenarios = [
  ["main leads, right", "main-carousel", 100, 8],
  ["strip leads, right", "strip", 40, 8],
  ["strip leads, left", "strip", -40, 6],
  ["main leads, left", "main-carousel", -100, 5]
];
let failed = false;
for (const [label, id, dx, steps] of scenarios) {
  await page.evaluate((id) => window.__lead(id), id);
  await wheel(page, `#${id}`, dx, steps);
  const frames = await page.evaluate(() => window.__takeFrames());
  const worst = (key) => round(Math.max(0, ...frames.map((f) => f[key])));
  const bad = frames.filter((f) => f["main-carousel"] > 0.5 || f.strip > 0.5);
  failed ||= bad.length > 0 || frames.length === 0;
  console.log(
    label.padEnd(20),
    `frames ${frames.length}`,
    `worst main ${worst("main-carousel")}px`,
    `worst strip ${worst("strip")}px`,
    bad.length ? `BAD ${bad.length}: ${JSON.stringify(bad.slice(0, 3).map((f) => ({ P: round(f.P, 3), main: round(f["main-carousel"]), strip: round(f.strip) })))}` : "ok"
  );
}
await browser.close();
process.exitCode = failed ? 1 : 0;
