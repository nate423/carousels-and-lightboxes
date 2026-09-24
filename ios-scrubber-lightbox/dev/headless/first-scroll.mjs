// How long the main carousel's first scroll takes to handle on the iOS
// scrubber page, and the longest frame just after it - the delay before the
// strip started following in #17. Every scroll listener on the main carousel
// counts, the polyfill's included, from the moment the scroll event is
// dispatched to the moment the last one has run.
//
// Meant for WebKit (the polyfill, as on Safari 17.4 and iOS 18), where #17
// was ~120ms against ~10ms now.
//
//   node dev/headless/first-scroll.mjs [chromium|webkit] [url] [runs]
import { launch, openPage, badge, wheel } from "./lib.mjs";

const [engine = "webkit", url = "http://localhost:56576/ios-scrubber/", runs = "3"] = process.argv.slice(2);
const browser = await launch(engine);
console.log(engine, browser.version());
for (let run = 0; run < Number(runs); run++) {
  const page = await openPage(browser, url);
  await page.evaluate(() => {
    window.__m = { handler: [], frames: [] };
    const main = document.getElementById("main-carousel");
    let dispatched = 0;
    let first = true;
    // Captured on the document, before any listener on the carousel runs.
    document.addEventListener("scroll", (e) => { if (e.target === main && e.isTrusted) dispatched = performance.now(); }, { capture: true });
    // Added last, so it runs after every other listener on the carousel.
    main.addEventListener("scroll", (e) => {
      if (!e.isTrusted) return;
      window.__m.handler.push(performance.now() - dispatched);
      if (!first) return;
      first = false;
      const start = performance.now();
      let last = start;
      const tick = (t) => {
        window.__m.frames.push(t - last);
        last = t;
        if (t - start < 1000) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  });
  await wheel(page, "#main-carousel", 120, 6, { gap: 30, settle: 1500 });
  const { handler, frames } = await page.evaluate(() => window.__m);
  const polyfill = await page.evaluate(() => document.documentElement.hasAttribute("data-scroll-timeline-polyfill"));
  console.log(
    `first scroll ${handler[0]?.toFixed(1)}ms`,
    `later ≤${Math.max(0, ...handler.slice(1)).toFixed(1)}ms`,
    `longest frame ${Math.max(...frames).toFixed(1)}ms`,
    `polyfill ${polyfill}`,
    "|",
    await badge(page)
  );
  await page.close();
}
await browser.close();
