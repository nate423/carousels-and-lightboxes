// A switch for trying fixes to the iOS 27 bug where a carousel's items
// vanish near the edge of the screen while it scrolls natively - about
// where the item would have left the screen at full size, even though
// scaled down and moved inward it is still in view. It doesn't reproduce
// headless, so each candidate is a query parameter to try on the device:
// ?edge=<name>. Off with no parameter. The compare page passes it through
// to both panes.
//
// Temporary: whichever works moves into the carousel's own stylesheet, and
// this goes.
const EXPERIMENTS = {
  // Asks for each item's own layer up front, with its transforms expected.
  willchange: `.carousel-item, .expand-effect-thumb { will-change: translate, scale, opacity; }`,
  // Makes each item's drawn area much larger than its box, invisibly, in
  // case the renderer decides what's on screen from that area.
  outline: `.carousel-item { outline: 400px solid transparent; }`,
  backface: `.carousel-item, .expand-effect-thumb { backface-visibility: hidden; }`,
  // Each item's snap slot as a layer of its own, around the transformed
  // item.
  slotlayer: `.carousel-item-snap-fix { will-change: transform; }`,
  // The earlier workaround for a different WebKit bug, taken off, in case
  // it's part of this one.
  noisolate: `.carousel-item { isolation: auto; }`
};

export function applyEdgeExperiment() {
  const name = new URLSearchParams(location.search).get("edge");
  const css = EXPERIMENTS[name];
  if (!css) return;
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  document.documentElement.dataset.edgeExperiment = name;
}
