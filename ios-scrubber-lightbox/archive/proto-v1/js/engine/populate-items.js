function defaultCreateItem(item, index) {
  item.textContent = `Item ${index}`;
}

// The ratio an itemSizing derives its main-axis size from: the source
// media's own, which varies per item, or one authored ratio shared by every
// item. "origin" is a callback rather than a list of ratios because what
// counts as the origin is the caller's business - today every carousel that
// asks for it reads the rendered size of another carousel's items, which
// are the same thing as the source media; once there is real media with its
// own intrinsic resolution the two come apart, and only the callback has to
// change.
function aspectFor(size, index) {
  return typeof size.origin === "function" ? size.origin(index) : size.aspect;
}

// Fixes an item's cross-axis size and derives its main-axis size from a
// ratio - the shape both filmstrip navigators need, where thumbnails line up
// along one axis at a constant thickness. A carousel that passes no
// itemSizing at all is the other case entirely: its items are whatever size
// their content makes them, on both axes, which is what every main carousel
// here wants.
//
// Which axis is which comes from the wrapper's own scrollAxis, so a vertical
// strip fixes its width and derives its height rather than always fixing
// height as if every strip were horizontal.
function applyItemSizing(item, index, itemSizing, scrollAxis) {
  if (!itemSizing) return;

  const { crossSize, size } = itemSizing;
  const crossSide = scrollAxis === "x" ? "height" : "width";
  const mainSide = scrollAxis === "x" ? "width" : "height";

  let mainSize;
  if (typeof size === "number") {
    mainSize = size;
  } else {
    const aspect = aspectFor(size, index);
    mainSize = scrollAxis === "x" ? crossSize * aspect : crossSize / aspect;
  }

  item.style[crossSide] = crossSize + "px";
  item.style[mainSide] = Math.round(mainSize) + "px";
}

// Builds itemCount items into wrapper, immediately before insertBefore (the
// trailing spacer - see spacers.js), and wires each one's click to
// onItemClick(index). Leaves resizing the spacers to the caller, since that
// depends on state (geometry invalidation) this module doesn't own.
export function populateItems(
  wrapper,
  insertBefore,
  { itemCount, effect, createItem = defaultCreateItem, itemSizing, scrollAxis, onItemClick }
) {
  for (let i = 0; i < itemCount; i++) {
    const snapFixDiv = document.createElement("div");
    snapFixDiv.classList.add("carousel-item-snap-fix");

    const item = document.createElement("div");
    item.classList.add("carousel-item");
    effect.onItemCreated(item);
    // Before createItem, so a caller that wants to size one item specially
    // can still do it there without this overwriting the result.
    applyItemSizing(item, i, itemSizing, scrollAxis);
    createItem(item, i);

    snapFixDiv.appendChild(item);
    wrapper.insertBefore(snapFixDiv, insertBefore);

    item.addEventListener("click", () => onItemClick(i));
  }
}
