// Demo content: boxes at randomly varying sizes. Deliberately not uniform -
// the geometry this carousel derives progress from is measured per item, and
// items that are all the same size hide every mistake in it.
//
// Real content replaces this wholesale: the engine takes a createItem callback
// and has no opinion about what goes in an item.
function randomDimension(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min) + "px";
}

export function createPlaceholderItem(item, i) {
  const itemWidth = randomDimension(50, 300); /* min <> max width */
  const itemHeight = randomDimension(50, 300); /* min <> max height */
  item.textContent = `Item ${i} (${itemWidth} × ${itemHeight})`;
  item.style.width = itemWidth;
  item.style.height = itemHeight;
}
