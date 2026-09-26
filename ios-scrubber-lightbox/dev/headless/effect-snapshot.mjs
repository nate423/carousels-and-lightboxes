// Records what every scale-fade carousel on a page draws: each item's
// on-screen box and opacity, at 41 scroll positions, with snapping off.
// Compare two versions' snapshots to check they draw the same thing.
//
//   node dev/headless/effect-snapshot.mjs [chromium|webkit] [url] > a.json
//   node dev/headless/effect-snapshot.mjs compare a.json b.json
import { readFileSync } from "node:fs";
import { launch, openPage, badge, round } from "./lib.mjs";

const [engine = "chromium", url = "http://localhost:56576/filmstrip/?seed=14", other] = process.argv.slice(2);

if (engine === "compare") {
  const a = JSON.parse(readFileSync(url, "utf8"));
  const b = JSON.parse(readFileSync(other, "utf8"));
  console.log(a.badge, "\n", b.badge);
  let failed = false;
  for (const id of Object.keys(a.carousels)) {
    let worstBox = 0;
    let worstOpacity = 0;
    let where = null;
    a.carousels[id].forEach((stop, s) => {
      stop.items.forEach((item, i) => {
        const them = b.carousels[id][s].items[i];
        const box = Math.max(Math.abs(item.left - them.left), Math.abs(item.width - them.width));
        const opacity = Math.abs(item.opacity - them.opacity);
        if (box > worstBox) [worstBox, where] = [box, { scrollLeft: stop.scrollLeft, item: i, a: item, b: them }];
        worstOpacity = Math.max(worstOpacity, opacity);
      });
    });
    const bad = worstBox > 0.5 || worstOpacity > 0.01;
    failed ||= bad;
    console.log(id.padEnd(16), `stops ${a.carousels[id].length}`, `worst box ${round(worstBox)}px`, `worst opacity ${round(worstOpacity, 3)}`, bad ? `BAD ${JSON.stringify(where)}` : "ok");
  }
  process.exitCode = failed ? 1 : 0;
} else {
  const browser = await launch(engine);
  const page = await openPage(browser, url);
  const result = { badge: `${engine} ${browser.version()} | ${await badge(page)}`, carousels: {} };
  const ids = await page.evaluate(() => [...document.querySelectorAll(".scale-fade")].map((w) => w.id));
  for (const id of ids) {
    result.carousels[id] = await page.evaluate(async (id) => {
      const wrapper = document.getElementById(id);
      wrapper.style.scrollSnapType = "none";
      const settle = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))));
      const max = wrapper.scrollWidth - wrapper.clientWidth;
      const stops = [];
      for (let k = 0; k <= 40; k++) {
        wrapper.scrollLeft = Math.round((max * k) / 40);
        await settle();
        const origin = wrapper.getBoundingClientRect().left;
        stops.push({
          scrollLeft: wrapper.scrollLeft,
          items: [...wrapper.querySelectorAll(".carousel-item")].map((item) => {
            const r = item.getBoundingClientRect();
            return { left: r.left - origin, width: r.width, opacity: Number(getComputedStyle(item).opacity) };
          })
        });
      }
      return stops;
    }, id);
  }
  await browser.close();
  console.log(JSON.stringify(result));
}
