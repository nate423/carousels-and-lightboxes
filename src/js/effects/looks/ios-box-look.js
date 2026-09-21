// The iOS Photos scrubber's per-item paint: fixed-size thumbnails at a
// constant gap, where render() takes each item's itemProgress (see
// computeItemProgress in carousel-math.js) - 1 for fully expanded/current, 0
// for fully collapsed - and interpolates both the thumbnail's width and the
// padding around it accordingly. Knows nothing about dragging or settling;
// settle-effect.js computes the itemProgress array (continuous while
// driven, one-hot at rest) and calls render() with it.
//
// Every item's layout box stays a fixed, identical width, always - the
// expansion is drawn entirely with overflow and transforms, which layout
// can't see. Growing an item's box for real (padding-inline on the item,
// width on the thumb) would feed back into carousel-math's own geometry:
// getItemMetrics derives each item's anchor from its offsetLeft/offsetWidth,
// so the widths this effect writes would determine progress and progress
// would determine the widths. At this strip's 23px item pitch that loop can
// move an item's offsetLeft by 30px purely depending on where the expansion
// currently sits - enough to visibly judder while the main carousel drives
// this strip (each frame's write inverted against anchors the previous
// frame had already moved), and enough to strand an item permanently
// collapsed (the settle check in settle-effect.js measures distance from an
// item's own anchor, which means nothing while anchors move under it). With
// the box fixed, anchors are constant for the lifetime of a setup() call -
// which is also why they're cached there rather than re-read per frame.
import { getItemMetrics, computeScrollAnchorForProgress, wrapperAnchor } from "../../carousel-math.js";

const stateByWrapper = new WeakMap();

function onItemCreated(item) {
  item.classList.add("ios-thumbnail-scrubber-item");
  const thumb = document.createElement("div");
  thumb.classList.add("ios-thumbnail-scrubber-thumb");
  item.appendChild(thumb);
}

function setup(ctx) {
  const { wrapper, scrollDistance, offsetSize, offsetFromStart, getAlignmentFraction, getScrollPadding } = ctx;
  const items = [...wrapper.querySelectorAll(".carousel-item")];
  const style = getComputedStyle(wrapper);
  const itemWidth = parseFloat(style.getPropertyValue("--ios-item-width")) || 20;
  const expandedWidth = parseFloat(style.getPropertyValue("--ios-expanded-width")) || 30;
  const expandedPadding = parseFloat(style.getPropertyValue("--ios-expanded-padding")) || 10;
  const alignment = getAlignmentFraction(wrapper);
  const scrollPadding = getScrollPadding(wrapper);

  // Read once per setup rather than per frame: item boxes are a fixed width
  // that nothing this look does can change (see the header), so these can
  // only move on the events that call setup() in the first place - init,
  // resize, alignment change. render() then needs no layout reads at all.
  const { anchors } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetSize,
    scrollDistance,
    alignment,
    scrollPadding
  );

  stateByWrapper.set(wrapper, {
    items,
    anchors,
    wrapperAnchorPoint: wrapperAnchor(wrapper[offsetSize], alignment, scrollPadding),
    alignment,
    gap: parseFloat(style.gap) || 0,
    itemWidth,
    // How much wider the thumb itself gets when fully expanded...
    thumbGrowth: expandedWidth - itemWidth,
    // ...versus how much room the expanded item takes from its neighbors,
    // which also includes the breathing space either side of it. Both are
    // drawn as overflow around the item's own fixed box, so only this
    // second number decides how far the neighbors get pushed away.
    footprintGrowth: expandedWidth - itemWidth + 2 * expandedPadding
  });
}

// Lays the items out a second time, in pure visual terms - each one
// occupying its real rendered footprint at the real gap, rather than the
// uniform fixed box the scroller actually contains - and moves each item by
// the difference between where that visual layout wants it and where its
// box already is. Anchored so that whichever (fractional) item position the
// scroll is currently at lands on the wrapper's anchor point, which is the
// same thing the box layout is doing, so the two agree exactly whenever
// every footprint equals its box (i.e. everything collapsed: no transforms
// at all) and diverge smoothly as one item expands.
function render(ctx, { itemProgresses, currentProgress, scrollAnchor }) {
  const state = stateByWrapper.get(ctx.wrapper);
  const { items, anchors, alignment, gap, itemWidth, thumbGrowth, footprintGrowth } = state;

  const visualAnchors = new Array(items.length);
  let visualStart = 0;
  for (let i = 0; i < items.length; i++) {
    const footprint = itemWidth + itemProgresses[i] * footprintGrowth;
    visualAnchors[i] = visualStart + footprint * alignment;
    visualStart += footprint + gap;
  }

  // Same inverse-interpolation the box layout's own anchor went through
  // (computeCurrentProgress is what produced currentProgress from
  // scrollAnchor), so both sides of the subtraction below are "where the
  // current position sits" in their respective layouts.
  const visualAnchorAtProgress = computeScrollAnchorForProgress(visualAnchors, currentProgress);

  items.forEach((item, i) => {
    const translation =
      visualAnchors[i] - visualAnchorAtProgress - (anchors[i] - scrollAnchor);
    item.style.transform = `translate3d(${translation.toFixed(2)}px, 0, 0)`;

    const thumb = item.firstElementChild;
    thumb.style.width = (itemWidth + itemProgresses[i] * thumbGrowth).toFixed(2) + "px";
    // The thumb grows symmetrically around its box's center (the item is a
    // centering flex container), but the anchor point the visual layout
    // above places each footprint by is alignment-dependent. At center
    // alignment those coincide and this is 0; at start/end alignment it
    // re-centers the thumb inside the footprint the neighbors actually
    // made room for, instead of leaving it half-overlapping one side.
    const thumbOffset = itemProgresses[i] * footprintGrowth * (0.5 - alignment);
    thumb.style.transform = `translate3d(${thumbOffset.toFixed(2)}px, 0, 0)`;
  });
}

// Overriding the permanent CSS transition (see main.css) is a per-path
// toggle, not a per-frame write: the driven path is continuous already (a
// new, only-slightly-different target every frame), so transitioning each of
// those tiny steps would just be the lag/jerkiness the settle/driven split
// was built to remove - but re-asserting "none" on every item on every frame
// is a style write per item per frame that changes nothing.
function setTransitionsEnabled(ctx, enabled) {
  const { items } = stateByWrapper.get(ctx.wrapper);
  const value = enabled ? "" : "none";
  items.forEach((item) => {
    item.style.transition = value;
    item.firstElementChild.style.transition = value;
  });
}

// This look owns every item's rendering, and none of what it writes
// (transforms, and a width on the thumb inside a fixed-width box) changes
// an item's own border box - so carousel-engine's item-level ResizeObserver
// has nothing real to recover here, and running its full refresh off one
// would just be churn.
export const iosBoxLook = { onItemCreated, setup, render, setTransitionsEnabled, skipItemResizeObserver: true };
