// Effect for the iOS-style thumbnail scrubber (see
// navigators/ios-thumbnail-scrubber.js) - not a general-purpose effect like
// css/js/origin-effect.js; purpose-built for this navigator's specific DOM
// (the .ios-thumbnail-scrubber-thumb child every item gets, set up in
// onItemCreated) and horizontal axis.
//
// The load-bearing invariant here is that *every item's layout box is a
// fixed, identical width, always* - the expansion is drawn entirely with
// overflow and transforms, which layout can't see. An earlier version grew
// the current item for real (padding-inline on the item, width on the
// thumb, both animated every scroll frame), and that made the scroller's own
// geometry a function of this effect's output: carousel-math's
// getItemMetrics derives progress by reading item.offsetLeft/offsetWidth, so
// progress determined the widths and the widths determined progress.
// Measured on the demo page, an item's offsetLeft moved by 30px - more than
// a full 23px item pitch - purely depending on where the expansion currently
// sat. Two symptoms, one cause:
//   - the strip visibly juddered while the main carousel drove it, because
//     each frame's scroll write was inverted against anchors the previous
//     frame's write had already moved;
//   - it would get stuck collapsed, because the settle test below asks how
//     far the resting position is from an item's own anchor, and that
//     distance was meaningless while the anchors moved under it.
// With the box fixed, anchors are constant for the lifetime of a setup()
// - which is also why they're cached there rather than re-read per frame.
//
// Two genuinely different rendering paths, chosen fresh every apply() call
// - not one "clever" mechanism trying to serve both (an earlier version
// tried a permanently-on CSS transition for everything, which turned out to
// add real, felt lag to the continuous case and produce jerky motion right
// as it settled, since every high-frequency write was restarting the
// transition's easing curve from scratch):
//
//  - Driven by the main carousel's own live scroll (linkCarousels'
//    "continuous" aToB mode, via direct writeToDest calls): every item's
//    closeness is written *untransitioned*, straight from live progress,
//    every frame - a plain triangle centered on this item's own index (1
//    exactly at its own progress, 0 a full item-step either side; the same
//    shape css-effect.js's own item-current keyframe already uses for the
//    original scrubber). Zero JS-introduced lag, so it tracks the source's
//    scroll pixel-for-pixel, matching the original scrubber's own
//    continuous feel.
//  - Dragged/flicked on this strip directly: nothing continuous at all -
//    everything stays collapsed until the gesture comes to rest, and the
//    item it rests on then animates in via the permanent CSS transition
//    (see main.css). Collapsing and expanding are driven by deliberately
//    different things - see the settle block at the bottom of apply() and
//    the listeners in setup() for which, and why. A slow drag around inside
//    one item's zone reads as fully collapsed the entire time it's away
//    from that item's own resting position, and a fast flick through
//    several items never lets an intermediate one finish animating in,
//    since the next target overwrites its transition before it arrives;
//    interrupting and redirecting an in-flight CSS transition is native
//    browser behavior, nothing this module has to implement.
//
// Note what falls out of the fixed box for the drag path specifically:
// with every item collapsed, each one's rendered footprint is exactly its
// layout box, so every translation is 0 and a drag is pure native scrolling
// at the real 23px item pitch - finger and thumbnails move together, with
// no JS-computed positions involved at all until it settles.
//
// Which path applies comes straight from the engine's own scroll
// attribution (ctx.getScrollSource - see the scroll-attribution block in
// carousel-engine.js): "driven" means an outside driver is writing this
// wrapper's scroll position directly, which is exactly the case where this
// wrapper's motion isn't a real drag on it at all. Nothing here has to be
// kept in sync by hand, and nothing has to infer it from a side effect of
// the layer doing the driving. (An earlier version read
// `wrapper.style.scrollSnapType === "none"`, the inline style
// carousel-link.js used to write while relaying. That worked, but it tied
// this effect to another module's implementation detail with no import
// between them, and it stayed true for the whole ~150ms snap-restore tail
// after the last relayed write - so grabbing the strip right as the main
// carousel stopped driving it rendered the first moments of a genuine drag
// on the driven path. Attribution flips the instant a real input lands.)
import {
  getItemMetrics,
  computeCurrentProgress,
  computeCurrentIndex,
  computeItemProgress,
  computeScrollAnchorForProgress,
  wrapperAnchor
} from "../carousel-math.js";

const stateByWrapper = new WeakMap();
// Tracked separately from stateByWrapper, which setup() replaces wholesale
// on every call (init, resize, alignment change) - this must survive those
// replacements so the settle listeners below are only ever attached once
// per wrapper, not once per setup() call.
const settleListenersAttached = new WeakSet();

// How far the scroll position may sit from an item's own anchor and still
// count as resting on it. In pixels, deliberately, rather than the
// fraction-of-an-item-step this used to be: scrollLeft settles to
// fractional pixel values, and at this strip's 23px item pitch the old
// 0.02 index-steps worked out to under half a pixel - tighter than the
// resting position can actually be trusted to. Anything a real drag does
// clears 2px on its first frame.
const SETTLE_TOLERANCE_PX = 2;

function onItemCreated(item) {
  item.classList.add("ios-thumbnail-scrubber-item");
  const thumb = document.createElement("div");
  thumb.classList.add("ios-thumbnail-scrubber-thumb");
  item.appendChild(thumb);
}

function setup(ctx) {
  const { wrapper, scrollDistance, offsetLength, offsetFromStart, getAlignmentFraction, getScrollPadding } = ctx;
  const items = [...wrapper.querySelectorAll(".carousel-item")];
  const style = getComputedStyle(wrapper);
  const itemWidth = parseFloat(style.getPropertyValue("--ios-item-width")) || 20;
  const expandedWidth = parseFloat(style.getPropertyValue("--ios-expanded-width")) || 30;
  const expandedPadding = parseFloat(style.getPropertyValue("--ios-expanded-padding")) || 10;
  const alignment = getAlignmentFraction(wrapper);
  const scrollPadding = getScrollPadding(wrapper);
  const previous = stateByWrapper.get(wrapper);

  // Read once per setup rather than per frame: item boxes are a fixed width
  // that nothing this effect does can change (see the header), so these
  // can only move on the events that call setup() in the first place -
  // init, resize, alignment change. apply() then needs no layout reads at
  // all, just wrapper.scrollLeft.
  const { anchors } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetLength,
    scrollDistance,
    alignment,
    scrollPadding
  );

  stateByWrapper.set(wrapper, {
    items,
    anchors,
    wrapperAnchorPoint: wrapperAnchor(wrapper[offsetLength], alignment, scrollPadding),
    alignment,
    gap: parseFloat(style.gap) || 0,
    itemWidth,
    // How much wider the thumb itself gets when fully expanded...
    thumbGrowth: expandedWidth - itemWidth,
    // ...versus how much room the expanded item takes from its neighbors,
    // which also includes the breathing space either side of it. Both are
    // drawn as overflow around the item's own fixed box, so only this
    // second number decides how far the neighbors get pushed away.
    footprintGrowth: expandedWidth - itemWidth + 2 * expandedPadding,
    // Which item the own-drag path currently renders as expanded (closeness
    // 1) - null when nothing is, i.e. whenever the strip isn't resting on an
    // item. Deliberately not carried over from a previous state: the
    // settleToNearest() at the end of setup() re-derives it against the
    // geometry just measured, and inheriting it would let that call
    // no-op on an unchanged index while the render it skipped was the one
    // that needed redoing.
    expandedIndex: null,
    // Whether the *previous* apply() call took the driven (untransitioned)
    // path - lets each path notice the handoff and toggle the inline
    // transition override just once, rather than rewriting it every frame.
    wasDriven: previous ? previous.wasDriven : false
  });

  // Expanding happens here and nowhere else: 'scrollend' fires once a whole
  // scroll operation - gesture, momentum and snap correction together - is
  // genuinely over, which is exactly and only when this style wants the
  // centered item to grow. Nothing else needs to infer it.
  //
  // Ignored while something else is driving this wrapper: a relayed write
  // suspends scroll-snap and the browser re-snaps when it's handed back,
  // which ends a "scroll operation" that was our own doing rather than
  // anything the user did.
  if (!settleListenersAttached.has(wrapper)) {
    settleListenersAttached.add(wrapper);
    wrapper.addEventListener("scrollend", () => {
      if (ctx.getScrollSource() === "driven") return;
      settleToNearest(ctx);
    });
  }

  // No scrollend fires for a carousel that has never moved, so the initial
  // current item needs painting directly. setup() only ever runs at rest
  // (init, resize, alignment change), so "whatever is nearest right now" is
  // the settled answer every time.
  settleToNearest(ctx);
}

// Expands whichever item the strip is currently resting on. Only ever called
// from a position known to be at rest, so it doesn't second-guess that with
// a tolerance check - with mandatory scroll-snap, "nearest" at rest is the
// item the browser has snapped to.
function settleToNearest(ctx) {
  const { wrapper, scrollDistance } = ctx;
  const state = stateByWrapper.get(wrapper);
  const scrollAnchor = wrapper[scrollDistance] + state.wrapperAnchorPoint;
  const currentProgress = computeCurrentProgress(state.anchors, scrollAnchor);
  setExpanded(ctx, computeCurrentIndex(currentProgress, state.items.length));
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
function render(state, closenesses, currentProgress, scrollAnchor) {
  const { items, anchors, alignment, gap, itemWidth, thumbGrowth, footprintGrowth } = state;

  const visualAnchors = new Array(items.length);
  let visualStart = 0;
  for (let i = 0; i < items.length; i++) {
    const footprint = itemWidth + closenesses[i] * footprintGrowth;
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
    thumb.style.width = (itemWidth + closenesses[i] * thumbGrowth).toFixed(2) + "px";
    // The thumb grows symmetrically around its box's center (the item is a
    // centering flex container), but the anchor point the visual layout
    // above places each footprint by is alignment-dependent. At center
    // alignment those coincide and this is 0; at start/end alignment it
    // re-centers the thumb inside the footprint the neighbors actually
    // made room for, instead of leaving it half-overlapping one side.
    const thumbOffset = closenesses[i] * footprintGrowth * (0.5 - alignment);
    thumb.style.transform = `translate3d(${thumbOffset.toFixed(2)}px, 0, 0)`;
  });
}

// Overriding the permanent CSS transition (see main.css) is a per-path
// toggle, not a per-frame write: the driven path is continuous already (a
// new, only-slightly-different target every frame), so transitioning each of
// those tiny steps would just be the lag/jerkiness this split was built to
// remove - but re-asserting "none" on every item on every frame is a style
// write per item per frame that changes nothing.
function setTransitionsEnabled(items, enabled) {
  const value = enabled ? "" : "none";
  items.forEach((item) => {
    item.style.transition = value;
    item.firstElementChild.style.transition = value;
  });
}

// The one way the own-drag path ever changes what's expanded, shared by the
// snap-event listeners and by apply()'s own fallback check so both can't
// drift apart. `index` of null means "nothing expanded" - a one-hot map
// against null is simply all zeros, which is the collapsed state.
function setExpanded(ctx, index) {
  const { wrapper, scrollDistance } = ctx;
  const state = stateByWrapper.get(wrapper);
  if (index === state.expandedIndex) return;
  state.expandedIndex = index;

  const scrollAnchor = wrapper[scrollDistance] + state.wrapperAnchorPoint;
  render(
    state,
    state.items.map((_, i) => (i === index ? 1 : 0)),
    computeCurrentProgress(state.anchors, scrollAnchor),
    scrollAnchor
  );
}

function apply(ctx) {
  const { wrapper, scrollDistance, getScrollSource, onProgress } = ctx;
  const state = stateByWrapper.get(wrapper);
  const { items, anchors, wrapperAnchorPoint } = state;

  const scrollAnchor = wrapper[scrollDistance] + wrapperAnchorPoint;
  const currentProgress = computeCurrentProgress(anchors, scrollAnchor);
  const isDriven = getScrollSource() === "driven";

  if (isDriven) {
    if (!state.wasDriven) {
      setTransitionsEnabled(items, false);
      state.wasDriven = true;
      // The tent below renders every item's closeness directly off live
      // progress, never off "which one is expanded", so expandedIndex would
      // otherwise sit here stale for the whole drive and then be diffed
      // against on the way out.
      state.expandedIndex = null;
    }
    render(
      state,
      items.map((_, i) => computeItemProgress(currentProgress, i)),
      currentProgress,
      scrollAnchor
    );
  } else {
    if (state.wasDriven) {
      // Handoff back from the driven path: restore the transition, then
      // collapse everything so the diff below starts from a clean, accurate
      // slate. Doubles as the "collapse the instant you start dragging the
      // thumb" behavior.
      setTransitionsEnabled(items, true);
      state.wasDriven = false;
      render(state, items.map(() => 0), currentProgress, scrollAnchor);
    }

    // Collapsing only. Expanding belongs to 'scrollend' (see setup()) - this
    // runs on every scroll frame, and anything that expands from here
    // necessarily expands mid-gesture.
    //
    // Measured against whatever is *currently* expanded: once the scroll has
    // moved off that item's own anchor, it isn't resting on it any more.
    // Position is the right question here precisely because it has to be
    // answered on the very first frame of a drag, before any event exists.
    if (
      state.expandedIndex !== null &&
      Math.abs(scrollAnchor - state.anchors[state.expandedIndex]) > SETTLE_TOLERANCE_PX
    ) {
      setExpanded(ctx, null);
    }
  }

  onProgress?.(computeCurrentIndex(currentProgress, items.length), currentProgress);
}

// This effect owns every item's rendering, and none of what it writes
// (transforms, and a width on the thumb inside a fixed-width box) changes
// an item's own border box - so carousel-engine's item-level ResizeObserver
// has nothing real to recover here, and running its full refresh off one
// would just be churn.
export const iosScrubberEffect = { onItemCreated, setup, apply, skipItemResizeObserver: true };
