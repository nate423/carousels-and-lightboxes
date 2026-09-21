// The iOS Photos scrubber's look, painted by a native scroll-driven
// animation instead of by JS on every frame. The same look computed by hand
// lives in ios-scrubber-effect.js (settle-effect.js wrapped around
// looks/ios-box-look.js) and is still what runs on browsers without
// scroll-driven-animation support; main.js picks between them.
//
// --- Why this needs no keyframes per item -------------------------------
//
// ios-box-look.js lays every item out a second time in visual terms - each
// occupying its real expanded footprint - and translates each item by the
// difference between that layout and its own fixed box. Written out, with
// F = footprintGrowth, a = alignment, P = currentProgress and u = i - P
// (how many items away item i is from current, signed), all of it reduces
// to:
//
//   lo(u)   = clamp(0, 1 + u, 1)
//   hi(u)   = clamp(0, u, 1)
//   grow_i  = lo - hi                                (the 0-1 itemProgress)
//   shift_i = F * (a*lo + (1-a)*hi - a - bend)
//   bend    = (1 - 2a) * frac(P) * (1 - frac(P))
//
// Every item runs that identical formula against its own index, so unlike
// css-effect.js - whose per-item peak sits at a different, geometry-
// dependent place for every item, forcing a generated @keyframes rule each
// - the whole strip needs exactly one animation, advancing one number from
// 0 to n-1 across the scroll range. Each item's own index is a static
// custom property, and main.css does the rest.
//
// Item *sizes* drop out of that derivation entirely: the translate is the
// difference between two layouts, and each item's size appears identically
// in both. What the formula does assume is that every item grows by the
// same amount - an item expanding to some width of its own (its source
// media's aspect, say) makes F per-item, and then the two global terms
// stop being reconstructable from an item's own index. That case wants
// generated per-item keyframes, the way css-effect.js already does it. It
// would still be this one wrapper-level timeline, not a timeline each.
//
// The mapping from scroll offset to progress is linear here because this
// look pins every item's layout box to the same fixed size, so the item
// pitch is uniform - which is what lets the driving animation be two stops
// rather than one per item.
import { computeCurrentProgress, computeCurrentIndex, getItemMetrics, wrapperAnchor } from "../carousel-math.js";

let nextStripId = 0;

const stateByWrapper = new WeakMap();

function onItemCreated(item) {
  item.classList.add("ios-thumbnail-scrubber-item");
  const thumb = document.createElement("div");
  thumb.classList.add("ios-thumbnail-scrubber-thumb");
  item.appendChild(thumb);
}

// One <style> per wrapper holding its progress keyframes, replaced wholesale
// on each setup() - same approach css-effect.js takes, for the same reason:
// the geometry it encodes changes on resize and alignment.
function replaceStyleEl(previous, cssText) {
  const styleEl = document.createElement("style");
  styleEl.textContent = cssText;
  document.head.appendChild(styleEl);
  previous?.remove();
  return styleEl;
}

// `progressDriver` picks where the shared progress comes from. "css" lets
// the scroll-driven animation read this wrapper's own scroll position, and
// costs no JS per frame at all. "js" writes it instead, from the exact
// fractional progress the driver asked for, which is worth having because a
// scroll position is quantised: this strip's range is several times shorter
// than the carousel driving it, so one of its pixels is worth several of the
// other's (measured here: 0.617px of translate per whole pixel of strip
// scroll). Whether that staircase is visible depends on how finely the
// browser reports scroll offsets - not at all on a display reporting half
// pixels, but WebKit on iOS reports whole ones, which is twice as coarse and
// is where settle-effect.js first hit it. Even the "js" path is one property
// write per frame against that look's two per item.
export function iosScrubberCssEffect({ progressDriver = "css" } = {}) {
  function setup(ctx) {
    const { wrapper, scrollDistance, offsetSize, offsetFromStart, getAlignmentFraction, getScrollPadding } = ctx;
    const items = [...wrapper.querySelectorAll(".carousel-item")];
    const style = getComputedStyle(wrapper);
    const itemWidth = parseFloat(style.getPropertyValue("--ios-item-width")) || 20;
    const expandedWidth = parseFloat(style.getPropertyValue("--ios-expanded-width")) || 30;
    const expandedPadding = parseFloat(style.getPropertyValue("--ios-expanded-padding")) || 10;
    const alignment = getAlignmentFraction(wrapper);

    const previous = stateByWrapper.get(wrapper);
    const stripId = previous ? previous.stripId : nextStripId++;

    wrapper.classList.add("ios-scrubber-css");
    // How much wider the thumb itself draws when fully expanded, versus how
    // much room the expanded item takes from its neighbours - which also
    // includes the breathing space either side of it. Both are drawn as
    // overflow around the item's own fixed box, so only the second decides
    // how far the neighbours are pushed away.
    wrapper.style.setProperty("--ios-thumb-growth", expandedWidth - itemWidth + "px");
    wrapper.style.setProperty("--ios-footprint-growth", expandedWidth - itemWidth + 2 * expandedPadding + "px");
    wrapper.style.setProperty("--ios-alignment", alignment);
    items.forEach((item, i) => item.style.setProperty("--ios-index", i));

    const animationName = `ios-progress-${stripId}`;
    const styleEl = replaceStyleEl(
      previous?.styleEl,
      `@keyframes ${animationName} {\n  from { --ios-progress: 0; }\n  to { --ios-progress: ${items.length - 1}; }\n}`
    );
    wrapper.style.animationName = progressDriver === "css" ? animationName : "none";

    const { anchors } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetSize,
      scrollDistance,
      alignment,
      getScrollPadding(wrapper)
    );

    stateByWrapper.set(wrapper, {
      stripId,
      styleEl,
      items,
      anchors,
      alignment,
      wrapperAnchorPoint: wrapperAnchor(wrapper[offsetSize], alignment, getScrollPadding(wrapper))
    });
  }

  function apply(ctx) {
    const { wrapper, scrollDistance, getScrollSource, getDrivenProgress, onProgress } = ctx;
    const { anchors, alignment, wrapperAnchorPoint, items } = stateByWrapper.get(wrapper);

    const currentProgress =
      getScrollSource() === "driven"
        ? getDrivenProgress()
        : computeCurrentProgress(anchors, wrapper[scrollDistance] + wrapperAnchorPoint);

    if (progressDriver === "js") {
      wrapper.style.setProperty("--ios-progress", currentProgress);
    }

    // The one term of the formula that isn't a function of an item's own
    // index - it needs frac(progress), which has no dependable CSS spelling
    // yet. It is identically zero at center alignment, which is the default,
    // so away from center is the only case that costs a write.
    if (alignment !== 0.5) {
      const t = currentProgress - Math.floor(currentProgress);
      wrapper.style.setProperty("--ios-bend", (1 - 2 * alignment) * t * (1 - t));
    }

    onProgress?.(computeCurrentIndex(currentProgress, items.length), currentProgress);
  }

  // This effect owns every item's rendering, and nothing it writes changes
  // an item's own border box, so the engine's item-level ResizeObserver has
  // nothing real to recover here - same reasoning as looks/ios-box-look.js.
  return { onItemCreated, setup, apply, skipItemResizeObserver: true };
}
