// Shared by the headless checks in this folder: launching a browser, scrolling
// a carousel with the mouse wheel, and the per-frame probe they inject into
// the iOS scrubber page. See README.md.
import { readdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { chromium, webkit } from "playwright-core";

// Playwright 1.43's own Chromium build isn't needed: any Chrome for Testing a
// newer Playwright left in its cache drives the same. CHROMIUM_PATH overrides.
function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = join(homedir(), "Library/Caches/ms-playwright");
  const builds = existsSync(cache) ? readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse() : [];
  for (const build of builds) {
    const path = join(cache, build, "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
    if (existsSync(path)) return path;
  }
  throw new Error("No Chromium found - set CHROMIUM_PATH, or run: npx playwright install chromium");
}

// "webkit" is WebKit 17.4 with no scroll timelines of its own, so the pages
// load the scroll-timeline polyfill, as Safari 17.4 and iOS 18 do.
export async function launch(engine) {
  if (engine === "webkit") return webkit.launch();
  if (engine === "chromium") return chromium.launch({ executablePath: chromiumPath() });
  throw new Error(`Unknown engine "${engine}" - use chromium or webkit`);
}

export async function openPage(browser, url) {
  const page = await browser.newPage({ viewport: { width: 393, height: 800 } });
  page.on("pageerror", (error) => console.log("PAGE ERROR", error.message));
  await page.goto(url);
  await page.waitForTimeout(1500);
  return page;
}

// The page's version badge (dev/version-badge-plugin.js), so the output says
// what was measured.
export function badge(page) {
  return page.evaluate(() => document.body.lastElementChild.textContent);
}

export async function wheel(page, selector, dx, steps, { gap = 16, settle = 1200 } = {}) {
  const box = await page.locator(selector).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(dx, 0);
    await page.waitForTimeout(gap);
  }
  await page.waitForTimeout(settle);
}

// Injected into the iOS scrubber page. Reads the look's dimensions from the
// strip's own custom properties, and on every frame - just after it, once
// every animation frame callback including the engine's has run - records
// the main carousel's progress as measured from where its items are, and
// what the strip and the main carousel's centre items actually show.
export const PROBE = () => {
  const main = document.getElementById("main-carousel");
  const strip = document.getElementById("strip");
  const items = [...main.querySelectorAll(".carousel-item")];
  const thumbs = [...strip.querySelectorAll(".expand-effect-thumb")];
  const css = getComputedStyle(strip);
  const px = (name) => parseFloat(css.getPropertyValue(name));
  const width = px("--expand-item-width");
  const grown = px("--expand-item-width-grown");
  const footprint = grown - width + 2 * px("--expand-grown-padding");
  const stripItems = [...strip.querySelectorAll(".expand-effect-item")];
  const pitch = stripItems[1].offsetLeft - stripItems[0].offsetLeft;
  const noncurrentOpacity = parseFloat(getComputedStyle(main).getPropertyValue("--noncurrent-opacity"));

  // What a thumbnail shows: its own box, cut to the clipping edges around it.
  function visible(thumb) {
    const box = thumb.getBoundingClientRect();
    let left = box.left;
    let right = box.right;
    for (const edge of [thumb.closest(".expand-effect-left-edge"), thumb.closest(".expand-effect-right-edge")]) {
      if (!edge) continue;
      const clip = edge.getBoundingClientRect();
      left = Math.max(left, clip.left);
      right = Math.min(right, clip.right);
    }
    return { centre: (left + right) / 2, width: right - left };
  }

  function mainProgress() {
    const box = main.getBoundingClientRect();
    const mid = box.x + box.width / 2;
    const centres = items.map((item) => { const r = item.getBoundingClientRect(); return r.x + r.width / 2; });
    for (let i = 0; i < centres.length - 1; i++) {
      if (mid >= centres[i] && mid <= centres[i + 1]) return i + (mid - centres[i]) / (centres[i + 1] - centres[i]);
    }
    return mid < centres[0] ? 0 : centres.length - 1;
  }

  // How far the strip is from the expand look at full strength, at the main
  // carousel's progress: the worst of the seven thumbnails around the centre.
  function stripError(P) {
    const box = strip.getBoundingClientRect();
    const mid = box.x + box.width / 2;
    let error = 0;
    const c = Math.round(P);
    for (let i = Math.max(0, c - 3); i <= Math.min(thumbs.length - 1, c + 3); i++) {
      const shown = visible(thumbs[i]);
      const u = i - P;
      const lo = Math.min(Math.max(1 + u, 0), 1);
      const hi = Math.min(Math.max(u, 0), 1);
      const expectedWidth = width + (lo - hi) * (grown - width);
      const expectedCentre = (i - P) * pitch + footprint * ((lo + hi) / 2 - 0.5);
      error = Math.max(error, Math.abs(shown.width - expectedWidth), Math.abs(shown.centre - mid - expectedCentre));
    }
    return error;
  }

  // How far the main carousel's centre items are from the fade's opacity.
  function opacityError(P) {
    let error = 0;
    const c = Math.round(P);
    for (let i = Math.max(0, c - 1); i <= Math.min(items.length - 1, c + 1); i++) {
      const expected = noncurrentOpacity + (1 - noncurrentOpacity) * Math.max(1 - Math.abs(P - i), 0);
      error = Math.max(error, Math.abs(Number(getComputedStyle(items[i]).opacity) - expected));
    }
    return error;
  }

  // The thumbnail nearest the strip's centre: which, and how wide it shows.
  function centreThumb() {
    const box = strip.getBoundingClientRect();
    const mid = box.x + box.width / 2;
    const shown = thumbs.map(visible);
    let k = 0;
    shown.forEach((s, i) => { if (Math.abs(s.centre - mid) < Math.abs(shown[k].centre - mid)) k = i; });
    return { k, width: shown[k].width };
  }

  // Where the main carousel's last real scroll event said it was, read
  // before any of the page's own listeners run.
  let reportedLeft = main.scrollLeft;
  window.addEventListener("scroll", (event) => {
    if (event.isTrusted && event.target === main) reportedLeft = main.scrollLeft;
  }, true);

  window.__frames = [];
  function measure() {
    const P = mainProgress();
    // Past either end the look winds its end item down, which the formula
    // above doesn't describe.
    if (P <= 0.02 || P >= items.length - 1.02) return;
    window.__frames.push({ P, strip: stripError(P), opacity: opacityError(P), centre: centreThumb(), reported: reportedLeft, left: main.scrollLeft });
  }
  function frame() {
    setTimeout(measure, 0);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  window.__takeFrames = () => { const frames = window.__frames; window.__frames = []; return frames; };
};

export function round(n, places = 2) {
  return Number(n.toFixed(places));
}
