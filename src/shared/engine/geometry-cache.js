import { getItemMetrics, computeCurrentProgress, wrapperAnchor } from "../carousel-math.js";

// Where every item's anchor point sits, and where the wrapper's own is. Both
// are pure layout, and layout only moves on the events that already rebuild
// it: the spacers being resized, which every one of those events goes
// through (see spacers.js and carousel-engine.js's updateSpacers). So this is
// computed once per such event rather than per frame.
//
// What makes that safe is that no effect changes an item's border box. They
// draw with transforms and with properties confined inside the box
// (the iOS scrubber look is built around this: letting an item's box grow
// feeds the geometry back into the progress derived from it, which is why
// its expansion is drawn as overflow and a transform - see
// .ios-thumbnail-scrubber-item in that page's stylesheet). offsetLeft and
// offsetWidth therefore cannot move between rebuilds,
// and an effect that did move them would opt out of its own correctness,
// not just this cache's.
//
// Driving one carousel from another used to cost three full passes over
// every item per frame - the leader's getCurrentProgress, the follower's
// setProgressDirect, and the effect's own apply - each a querySelectorAll
// and a layout read per item, to move a single scroll offset. Some effects
// cached this themselves and already avoided their share; this is the same
// idea done once for everyone, including the effects that did not.
//
// The scroll position is deliberately not part of it. That is the one thing
// here that does change every frame, and it is a single read rather than one
// per item.
export function createGeometryCache({ wrapper, getItems, getAlignmentFraction, getScrollPadding }) {
  let geometry = null;

  function get() {
    if (geometry) return geometry;

    const items = getItems();
    const alignment = getAlignmentFraction();
    const scrollPadding = getScrollPadding();
    const { anchors, sizes } = getItemMetrics(wrapper, items, alignment, scrollPadding);

    geometry = {
      items,
      anchors,
      sizes,
      alignment,
      wrapperAnchorPoint: wrapperAnchor(wrapper.offsetWidth, alignment, scrollPadding)
    };
    return geometry;
  }

  function invalidate() {
    geometry = null;
  }

  function currentScrollAnchor() {
    return wrapper.scrollLeft + get().wrapperAnchorPoint;
  }

  // Continuous (fractional) "which item is current" - see
  // computeCurrentProgress in carousel-math.js.
  function getCurrentProgress() {
    return computeCurrentProgress(get().anchors, currentScrollAnchor());
  }

  return { get, invalidate, currentScrollAnchor, getCurrentProgress };
}
