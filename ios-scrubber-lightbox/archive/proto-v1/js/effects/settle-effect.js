// Turns a "look" - something that knows only how to paint a per-item
// itemProgress array (see looks/ios-box-look.js and looks/scale-fade-look.js
// for the interface: setup, render, restProgress, onItemCreated, and
// optionally setTransitionsEnabled/skipItemResizeObserver) - into a full
// effect, by computing that array every frame. js-effect.js and
// ios-scrubber-effect.js are both just this wrapped around their own look;
// the natively painted CSS variants do the equivalent of this module's job
// in the stylesheet instead (see css-effect.js / ios-scrubber-css-effect.js).
//
// The array is just the itemProgress triangle around the current position,
// blended toward the look's own restProgress by how much contrast the
// carousel is currently showing. All three come from somewhere else -
// computeItemProgress for the shape, the look for which end is its rest
// state, carousel-engine.js's contrast policy for the amount - so there is
// no separate notion here of settling, of which item is "the expanded one",
// or of how far the scroll has drifted from it.
//
// That used to be this module's bulk, and the policy subsumed all of it.
// Resting on an item is just contrast at full strength with the scroll
// sitting on that item's own anchor, which makes the triangle one-hot
// there by itself; collapsing mid-drag is the "leading" policy setting the
// amount to zero. The engine decides when, from motion state it can see
// directly, and it re-renders this look when that changes at rest, since
// the moment contrast matters most - the gesture just ended - is the one
// with no frame coming.
//
// Two things still belong here, both about the difference between a value
// that is changing continuously and one that is changing once:
//
//  - Which progress to read. While another carousel is driving this one,
//    the driver's own fractional progress is the honest source, not the
//    scroll position it just wrote: a scroll position is quantised, and
//    this strip's whole range is several times shorter than the carousel
//    driving it, so one of its pixels is worth several of the other's.
//    Measured on an iPhone, the main carousel advancing 1px per frame left
//    scrollLeft here unchanged for four frames and then jumped it by a
//    whole one, which turns the smooth curve below into a staircase and
//    reads as flicker. The scroll position is still the right thing to
//    measure on a real gesture, where it is what the finger moved.
//
//  - Whether the look's own CSS transitions should be on. They exist to
//    turn a discrete change into motion, which is exactly right when the
//    only thing changing is contrast, and exactly wrong while the curve
//    itself is moving - every frame would restart the easing from scratch
//    and add felt lag. So they are on whenever this carousel is at rest,
//    or whenever contrast is off and every value is therefore pinned at
//    zero, and off while a live curve is being written. Toggled on change
//    rather than per frame: re-asserting the same value on every item on
//    every frame is a style write per item per frame that changes nothing.
import {
  getItemMetrics,
  computeCurrentProgress,
  computeCurrentIndex,
  computeItemProgress,
  wrapperAnchor,
  transition
} from "../carousel-math.js";

export function settleEffect(look) {
  const stateByWrapper = new WeakMap();

  function setup(ctx) {
    look.setup(ctx);

    const { wrapper, scrollDistance, offsetSize, offsetFromStart, getAlignmentFraction, getScrollPadding } = ctx;
    const items = wrapper.querySelectorAll(".carousel-item");
    const alignment = getAlignmentFraction(wrapper);
    const scrollPadding = getScrollPadding(wrapper);

    // Kept as its own copy rather than reaching into the look's private
    // cache - a small duplication against the coupling that would otherwise
    // tie this module to the look's internal state shape, the same pattern
    // css-effect.js, js-effect.js and origin-effect.js each use
    // independently.
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
      itemCount: items.length,
      anchors,
      wrapperAnchorPoint: wrapperAnchor(wrapper[offsetSize], alignment, scrollPadding),
      // Deliberately unset rather than false, so the first apply() always
      // writes the look's transition state instead of assuming it.
      transitionsEnabled: undefined
    });
  }

  function apply(ctx) {
    const { wrapper, scrollDistance, getScrollSource, getDrivenProgress, getMotionState, onProgress } = ctx;
    const state = stateByWrapper.get(wrapper);
    const { anchors, wrapperAnchorPoint, itemCount } = state;

    const scrollAnchor = wrapper[scrollDistance] + wrapperAnchorPoint;
    const currentProgress =
      getScrollSource() === "driven" ? getDrivenProgress() : computeCurrentProgress(anchors, scrollAnchor);
    const contrast = wrapper.dataset.contrast === "off" ? 0 : 1;

    const transitionsEnabled = getMotionState() === "idle" || contrast === 0;
    if (transitionsEnabled !== state.transitionsEnabled) {
      state.transitionsEnabled = transitionsEnabled;
      look.setTransitionsEnabled?.(ctx, transitionsEnabled);
    }

    // Contrast blends each item's raw itemProgress toward the look's own
    // restProgress (0 or 1 - which end of its own range is "undecorated" is
    // the look's business, not this module's; see looks/ios-box-look.js and
    // looks/scale-fade-look.js for why they differ). At restProgress 0 this
    // reduces to itemProgress * contrast; at restProgress 1, to
    // 1 - (1 - itemProgress) * contrast.
    look.render(ctx, {
      itemProgresses: Array.from({ length: itemCount }, (_, i) =>
        transition(contrast, look.restProgress ?? 0, computeItemProgress(currentProgress, i))
      ),
      currentProgress,
      scrollAnchor
    });

    onProgress?.(computeCurrentIndex(currentProgress, itemCount), currentProgress);
  }

  return {
    onItemCreated: look.onItemCreated,
    setup,
    apply,
    skipItemResizeObserver: look.skipItemResizeObserver
  };
}
