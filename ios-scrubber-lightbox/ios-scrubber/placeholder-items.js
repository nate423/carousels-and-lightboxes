// Demo content: boxes at randomly varying sizes. Deliberately not uniform -
// the geometry this carousel derives progress from is measured per item, and
// items that are all the same size hide every mistake in it.
//
// Real content replaces this wholesale: the engine takes a createItem callback
// and has no opinion about what goes in an item.
//
// ?seed=N makes the sizes repeatable, so two copies of this page can be laid
// out identically - compare/ puts one beside the other.
const seed = new URLSearchParams(location.search).get("seed");
const random = seed === null ? Math.random : seededRandom(Number(seed));

// mulberry32: small, and good enough to scatter box sizes.
function seededRandom(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDimension(min, max) {
  return Math.floor(random() * (max - min + 1) + min) + "px";
}

export function createPlaceholderItem(item, i) {
  const itemWidth = randomDimension(50, 300); /* min <> max width */
  const itemHeight = randomDimension(50, 300); /* min <> max height */
  item.textContent = `Item ${i} (${itemWidth} × ${itemHeight})`;
  item.style.width = itemWidth;
  item.style.height = itemHeight;
}
