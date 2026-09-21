// Reusable timing wrapper for a "look" that only knows how to paint a
// per-item itemProgress array - the same 0-1 value computeItemProgress
// produces elsewhere (see looks/ios-box-look.js for the interface this
// expects: onItemCreated, setup, render, setTransitionsEnabled,
// skipItemResizeObserver). This module owns the *behavior* - when the strip
// is genuinely being dragged vs. driven by another carousel, and what
// itemProgress array each case hands the look - not any of the look's own
// per-item visuals.
//
// Two genuinely different rendering paths, chosen fresh every apply() call
// - not one mechanism serving both via a permanently-on CSS transition: that
// would add real, felt lag to the continuous case, and jerky motion right at
// settle, since every high-frequency write would restart the transition's
// easing curve from scratch.
//
//  - Driven by another carousel's own live scroll (linkCarousels'
//    "continuous" aToB mode, via direct writeToDest calls): every item's
//    itemProgress is handed to the look *untransitioned*, straight from live
//    progress, every frame - a plain triangle centered on this item's own
//    index (1 exactly at its own progress, 0 a full item-step either side;
//    the same shape css-effect.js's own item-current keyframe already
//    uses). Zero JS-introduced lag, so it tracks the source's scroll
//    pixel-for-pixel.
//  - Dragged/flicked on this strip directly: nothing continuous at all -
//    everything stays collapsed until the gesture comes to rest, and the
//    item it rests on then animates in via the permanent CSS transition
//    (see main.css). Collapsing and expanding are driven by deliberately
//    different things - see the settle block at the bottom of apply() and
//    the listener in setup() for which, and why. A slow drag around inside
//    one item's zone reads as fully collapsed the entire time it's away
//    from that item's own resting position, and a fast flick through
//    several items never lets an intermediate one finish animating in,
//    since the next target overwrites its transition before it arrives;
//    interrupting and redirecting an in-flight CSS transition is native
//    browser behavior, nothing this module has to implement.
//
// Which path applies comes straight from the engine's own scroll
// attribution (ctx.getScrollSource - see the scroll-attribution block in
// carousel-engine.js): "driven" means an outside driver is writing this
// wrapper's scroll position directly, which is exactly the case where this
// wrapper's motion isn't a real drag on it at all. Nothing here has to be
// kept in sync by hand, and nothing has to infer it from a side effect of
// the layer doing the driving. (Reading
// `wrapper.style.scrollSnapType === "none"` - the inline style
// carousel-link.js writes while relaying - would tie this effect to another
// module's implementation detail with no import between them, and would
// stay true for the whole ~150ms snap-restore tail after the last relayed
// write, rendering the first moments of a genuine drag on the driven path if
// grabbed right as the driver stops. Attribution flips the instant a real
// input lands, with no such gap.)
import {
  getItemMetrics,
  computeCurrentProgress,
  computeCurrentIndex,
  computeItemProgress,
  wrapperAnchor
} from "../carousel-math.js";

// How far the scroll position may sit from an item's own anchor and still
// count as resting on it. In pixels, deliberately, rather than as a
// fraction of an item step: scrollLeft settles to fractional pixel values,
// and at this strip's 23px item pitch, a step-fraction tolerance tight
// enough to matter (e.g. 0.02 steps) works out to under half a pixel -
// tighter than the resting position can actually be trusted to. Anything a
// real drag does clears 2px on its first frame.
const SETTLE_TOLERANCE_PX = 2;

export function settleEffect(look) {
  const stateByWrapper = new WeakMap();
  // Tracked separately from stateByWrapper, which setup() replaces wholesale
  // on every call (init, resize, alignment change) - this must survive those
  // replacements so the settle listener below is only ever attached once
  // per wrapper, not once per setup() call.
  const settleListenersAttached = new WeakSet();

  // Expands whichever item the strip is currently resting on. Only ever
  // called from a position known to be at rest, so it doesn't second-guess
  // that with a tolerance check - with mandatory scroll-snap, "nearest" at
  // rest is the item the browser has snapped to.
  function settleToNearest(ctx) {
    const { wrapper, scrollDistance } = ctx;
    const state = stateByWrapper.get(wrapper);
    const scrollAnchor = wrapper[scrollDistance] + state.wrapperAnchorPoint;
    const currentProgress = computeCurrentProgress(state.anchors, scrollAnchor);
    setExpanded(ctx, computeCurrentIndex(currentProgress, state.itemCount));
  }

  // The one way the own-drag path ever changes what's expanded, shared by
  // the scrollend listener and by apply()'s own fallback check so both can't
  // drift apart. `index` of null means "nothing expanded" - a one-hot map
  // against null is simply all zeros, which is the collapsed state.
  function setExpanded(ctx, index) {
    const { wrapper, scrollDistance } = ctx;
    const state = stateByWrapper.get(wrapper);
    if (index === state.expandedIndex) return;
    state.expandedIndex = index;

    const scrollAnchor = wrapper[scrollDistance] + state.wrapperAnchorPoint;
    look.render(ctx, {
      itemProgresses: Array.from({ length: state.itemCount }, (_, i) => (i === index ? 1 : 0)),
      currentProgress: computeCurrentProgress(state.anchors, scrollAnchor),
      scrollAnchor
    });
  }

  function setup(ctx) {
    look.setup(ctx);

    const { wrapper, scrollDistance, offsetLength, offsetFromStart, getAlignmentFraction, getScrollPadding } = ctx;
    const items = wrapper.querySelectorAll(".carousel-item");
    const alignment = getAlignmentFraction(wrapper);
    const scrollPadding = getScrollPadding(wrapper);

    // Kept as its own copy rather than reaching into the look's private
    // cache - a small duplication vs. the coupling that would otherwise tie
    // this module to the look's internal state shape, same pattern
    // css-effect.js/js-effect.js/origin-effect.js already each use
    // independently.
    const { anchors } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetLength,
      scrollDistance,
      alignment,
      scrollPadding
    );

    const previous = stateByWrapper.get(wrapper);
    stateByWrapper.set(wrapper, {
      itemCount: items.length,
      anchors,
      wrapperAnchorPoint: wrapperAnchor(wrapper[offsetLength], alignment, scrollPadding),
      // Which item the own-drag path currently renders as expanded
      // (itemProgress 1) - null when nothing is, i.e. whenever the strip isn't
      // resting on an item. Deliberately not carried over from a previous
      // state: settleToNearest() below re-derives it against the geometry
      // just measured, and inheriting it would let that call no-op on an
      // unchanged index while the render it skipped was the one that needed
      // redoing.
      expandedIndex: null,
      // Whether the *previous* apply() call took the driven (untransitioned)
      // path - lets each path notice the handoff and toggle the look's
      // transition override just once, rather than rewriting it every frame.
      wasDriven: previous ? previous.wasDriven : false
    });

    // Expanding happens here and nowhere else: 'scrollend' fires once a
    // whole scroll operation - gesture, momentum and snap correction
    // together - is genuinely over, which is exactly and only when this
    // wrapper wants the resting item to grow. Nothing else needs to infer
    // it.
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
    // (init, resize, alignment change), so "whatever is nearest right now"
    // is the settled answer every time.
    settleToNearest(ctx);
  }

  function apply(ctx) {
    const { wrapper, scrollDistance, getScrollSource, getDrivenProgress, onProgress } = ctx;
    const state = stateByWrapper.get(wrapper);
    const { anchors, wrapperAnchorPoint, itemCount } = state;

    const scrollAnchor = wrapper[scrollDistance] + wrapperAnchorPoint;
    const isDriven = getScrollSource() === "driven";

    // While driven, take the progress from the driver rather than measuring
    // the scroll position it just wrote. A scroll position is quantised to
    // whole pixels, and this strip's whole range is several times shorter
    // than the carousel driving it, so one of its pixels is worth several of
    // the other's: measured on an iPhone, the main carousel advancing 1px
    // per frame left scrollLeft here unchanged for four frames and then
    // jumped it by a whole one. Deriving progress from that turns the smooth
    // tent below into a staircase, stepping every item's translate by
    // ~0.65px at a time, which is the visible flicker. The scroll position
    // is still the right thing to measure on the drag path, where it is
    // what the finger actually moved.
    const currentProgress = isDriven ? getDrivenProgress() : computeCurrentProgress(anchors, scrollAnchor);

    if (isDriven) {
      if (!state.wasDriven) {
        look.setTransitionsEnabled(ctx, false);
        state.wasDriven = true;
        // The tent below renders every item's itemProgress directly off live
        // progress, never off "which one is expanded", so expandedIndex
        // would otherwise sit here stale for the whole drive and then be
        // diffed against on the way out.
        state.expandedIndex = null;
      }
      look.render(ctx, {
        itemProgresses: Array.from({ length: itemCount }, (_, i) => computeItemProgress(currentProgress, i)),
        currentProgress,
        scrollAnchor
      });
    } else {
      if (state.wasDriven) {
        // Handoff back from the driven path: restore the transition, then
        // collapse everything so the diff below starts from a clean,
        // accurate slate. Doubles as the "collapse the instant you start
        // dragging the thumb" behavior.
        look.setTransitionsEnabled(ctx, true);
        state.wasDriven = false;
        look.render(ctx, { itemProgresses: Array(itemCount).fill(0), currentProgress, scrollAnchor });
      }

      // Collapsing only. Expanding belongs to 'scrollend' (see setup()) -
      // this runs on every scroll frame, and anything that expands from
      // here necessarily expands mid-gesture.
      //
      // Measured against whatever is *currently* expanded: once the scroll
      // has moved off that item's own anchor, it isn't resting on it any
      // more. Position is the right question here precisely because it has
      // to be answered on the very first frame of a drag, before any event
      // exists.
      if (state.expandedIndex !== null && Math.abs(scrollAnchor - anchors[state.expandedIndex]) > SETTLE_TOLERANCE_PX) {
        setExpanded(ctx, null);
      }
    }

    onProgress?.(computeCurrentIndex(currentProgress, itemCount), currentProgress);
  }

  return {
    onItemCreated: look.onItemCreated,
    setup,
    apply,
    skipItemResizeObserver: look.skipItemResizeObserver
  };
}
