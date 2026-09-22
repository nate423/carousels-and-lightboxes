// The default carousel look: every item scales and fades toward its
// noncurrent state the further it sits from the current one, with a
// translate compensating for the gap that scaling opens between neighbours.
//
// All of it comes from native scroll-driven animations (`animation-range`
// plus per-item @keyframes) on .carousel-item - scale and opacity off the
// per-item --item-reveal view-timeline, translate off the wrapper-level
// --carousel-scroll scroll-timeline, both declared in the page's stylesheet.
// This module only precomputes that animation geometry (setup); apply()
// derives the current index for a navigator, which is the one thing no
// timeline can hand back to JS.
//
// Shared by the scale-fade page and the filmstrip page, whose strip is this
// same look tuned smaller.
// The same look computed by hand, item by item, on every scroll frame
// instead of once as @keyframes, is archived at
// archive/proto-v1/js/effects/looks/scale-fade-look.js - the reference
// implementation to check this one's output against.
import {
  computeCurrentProgress,
  computeCurrentIndex,
  computeScrollAnchorForProgress,
  computeAnimationRanges,
  computeTranslationBreakpoints
} from "../carousel-math.js";
import { RuleSheet } from "./style-swap.js";

// `animation-timing-function` (including the linear() control-point syntax)
// applies independently *within* each keyframe-to-keyframe segment, re-based
// to that segment's own local 0-1 - it can't shift *where* a keyframe's
// value actually falls across the overall range. Placing an item's peak at
// an arbitrary, per-item asymmetric position (see computeAnimationRanges'
// peakX) instead requires giving that item its own @keyframes rule with the
// "scale: 1" stop declared at that exact percentage. Every item needs a
// distinct, stable id for this (assigned in onItemCreated) and a shared
// stylesheet holding one generated rule per item, rebuilt whenever setup()
// recomputes geometry. The gap-compensating translate gets the same
// treatment (see computeTranslationBreakpoints in carousel-math.js for why
// it's exactly representable this way too), just off a second, wrapper-level
// scroll-timeline instead of the per-item view-timeline - see the page's
// stylesheet.
// Item ids just need to be unique site-wide (they're used in a
// `[data-item-id="N"]` selector - see below), so this counter alone stays
// module-global; it never needs resetting.
let nextItemId = 0;

// Everything else - the generated keyframe/position rules and the <style>
// elements holding them - is kept one-per-wrapper (via this WeakMap) rather
// than as module-level singletons. With a single shared set, every
// carousel using this look (the filmstrip page runs two at once - its main
// carousel and the strip navigating it)
// would flush the exact same 3 <style> elements on every one of their setup()
// calls, so each carousel's own resize/alignment churn forces a full
// teardown-and-reinsert of every OTHER carousel's rules too. The
// scroll-timeline polyfill (see below) only (re)parses a <style> element at
// the moment it's inserted, so that churn means it's constantly re-discovering
// rules for items whose animations may already be running - a window where a
// freshly-(re)dispatched animationstart can race the polyfill's own
// MutationObserver-driven parse of the very rule it needs, permanently
// missing the timeline hijack for whichever items lose that race. Scoping
// the rules/style-elements per wrapper means one carousel's churn no longer
// touches another's.
const stateByWrapper = new WeakMap();

function getWrapperState(wrapper) {
  let state = stateByWrapper.get(wrapper);
  if (!state) {
    state = {
      currentKeyframeSheet: new RuleSheet(),
      translateKeyframeSheet: new RuleSheet(),
      // The scroll-timeline polyfill (Safari) doesn't support
      // animation-timeline et al. set as inline styles - it works by parsing
      // real stylesheet rules for those properties and matching their
      // selectors against the DOM (see getAnimationTimelineOptions in
      // vendor/scroll-timeline.js), the same way it discovers everything
      // else here. Inline styles are invisible to it. So every item's
      // animation-name/-timeline/-range also gets a generated selector rule
      // here, in addition to the inline styles below (which native engines
      // read directly, and which win in the CSSOM anyway - same values, so
      // no conflict).
      positionSheet: new RuleSheet()
    };
    stateByWrapper.set(wrapper, state);
  }
  return state;
}

// Only builds the rule text and points the item at it - doesn't touch the
// shared stylesheets' textContent. Setting textContent is a full
// reparse/recalc of every rule in it, so setup() batches all n items' rules
// and writes each stylesheet exactly once after its items.forEach loop.
// Writing per-item instead would reparse the whole, growing rule set on
// every one of the n writes - O(n^2) - which would show up as jank or
// freezing on window resize, since resize has no debounce and calls setup()
// on every native 'resize' event.
// Two shapes of the same animation, and which one a carousel gets is the
// difference between the compositor drawing this look and the main thread
// drawing it.
//
// A carousel whose contrast never changes has nothing to multiply its look
// by, so the keyframes can write scale, opacity and translate outright.
// Those are properties the compositor understands, so the whole look keeps
// running when the main thread is busy.
//
// A carousel whose contrast can change needs every drawn value multiplied
// by it, every frame. That has to happen in a calc() reading an animated
// custom property (the page's stylesheet turns the two values below into what
// is drawn),
// and nothing the compositor can evaluate - the animation has to be
// resolved by the style engine each frame instead. Verified the hard way:
// with only this second shape, blocking the main thread for three seconds
// and scrolling froze the look outright, where it had kept animating
// before.
//
// Contrast could not just be composed on top as a second animation, which
// would have avoided the split. Transform lists do compose multiplicatively
// under animation-composition, but what contrast scales is each value's
// *distance from neutral* - 1 + c * (s - 1) - and that is not any factor
// depending on c alone.
function setItemCurrentKeyframes(state, item, peakX, range, translateStops, usesContrast) {
  const currentName = `item-current-${item.dataset.itemId}`;
  state.currentKeyframeSheet.set(
    currentName,
    usesContrast
      ? `@keyframes ${currentName} {
      0% { --item-progress: 0; }
      ${peakX * 100}% { --item-progress: 1; }
      100% { --item-progress: 0; }
    }`
      : `@keyframes ${currentName} {
      0% { scale: var(--noncurrent-scale); opacity: var(--noncurrent-opacity); }
      ${peakX * 100}% { scale: 1; opacity: 1; }
      100% { scale: var(--noncurrent-scale); opacity: var(--noncurrent-opacity); }
    }`
  );

  const translateName = `item-translate-${item.dataset.itemId}`;
  const stops = translateStops
    .map(({ percent, value }) =>
      usesContrast
        ? `${percent}% { --item-shift: ${value}px; }`
        : `${percent}% { translate: ${value}px 0; }`
    )
    .join("\n      ");
  state.translateKeyframeSheet.set(translateName, `@keyframes ${translateName} {\n      ${stops}\n    }`);

  const animationName = `${currentName}, ${translateName}`;
  const animationTimeline = "--item-reveal, --carousel-scroll";
  const animationRange = `cover ${range.start * 100}% cover ${range.end * 100}%, 0% 100%`;

  item.style.animationName = animationName;
  item.style.animationTimeline = animationTimeline;
  item.style.animationRange = animationRange;

  state.positionSheet.set(
    item.dataset.itemId,
    `.carousel-item[data-item-id="${item.dataset.itemId}"] {
      animation-name: ${animationName};
      animation-timeline: ${animationTimeline};
      animation-range: ${animationRange};
    }`
  );
}

function flushKeyframeStyles(state) {
  state.currentKeyframeSheet.flush();
  state.translateKeyframeSheet.flush();
  state.positionSheet.flush();
}

function onItemCreated(item) {
  item.dataset.itemId = String(nextItemId++);
}

// Sets each item's `animation-range` from its own geometry, sized to the
// real pixel gap to each neighboring anchor so the falloff reaches
// exactly 0 exactly when that neighbor becomes current (asymmetric
// whenever neighboring items differ in size, which they always do here).
// That asymmetry means the item's own peak (where it's genuinely
// "current") generally doesn't sit at the range's arithmetic midpoint, so
// each item gets its own @keyframes rule (see setItemCurrentKeyframes) with
// the "scale: 1" stop placed at peakX instead of a fixed 50%, keeping the
// peak exactly at this item's real anchor crossing. Pure layout math -
// only needs recomputing when geometry or alignment changes, not on
// scroll.
//
// Known limitation (verified, not a bug here): right after an item
// crosses INTO a fresh animation-range - either this custom sub-range or
// even the plain default `cover 0%`/`100%` - Chromium holds it clamped at
// the boundary's keyframe value for several more pixels of real scroll
// before it starts interpolating, even though the declared range and
// computeTranslationBreakpoints' prediction are both already correct at that point.
// Confirmed at the painted-layout level (getBoundingClientRect, not just
// getComputedStyle) and reproduces identically with no custom range at
// all, so it's inherent to the browser's view-timeline boundary-crossing
// detection, not something derivable from - or fixable via - our own
// geometry. Not compensated for here: any pixel offset that "fixed" it
// would just be hard-coding an unrelated, undocumented implementation
// detail rather than a value that falls out of this math.
function setup(ctx) {
  const { wrapper, getNoncurrentScale } = ctx;
  const state = getWrapperState(wrapper);
  const usesContrast = ctx.usesContrast();
  const { items, anchors, sizes, wrapperAnchorPoint } = ctx.getGeometry();
  const ranges = computeAnimationRanges(anchors, sizes, wrapper.offsetWidth);

  // Native scroll-timeline progress is 0%/100% at raw scroll offset
  // 0/maxScroll, not at wrapperAnchorPoint - scrollAnchor = scrollOffset +
  // wrapperAnchorPoint (see getItemMetrics), so the reachable scrollAnchor
  // range is [wrapperAnchorPoint, wrapperAnchorPoint + maxScroll]. These are
  // the true breakpoint boundaries (see computeTranslationBreakpoints).
  const maxScroll = wrapper.scrollWidth - wrapper.offsetWidth;
  const percentFor = (scrollAnchor) =>
    maxScroll <= 0
      ? 0
      : Math.min(Math.max(((scrollAnchor - wrapperAnchorPoint) / maxScroll) * 100, 0), 100);

  const breakpoints = computeTranslationBreakpoints(
    anchors,
    sizes,
    getNoncurrentScale(wrapper),
    wrapperAnchorPoint,
    wrapperAnchorPoint + Math.max(maxScroll, 0)
  );

  items.forEach((item, i) => {
    const translateStops = breakpoints.map((bp) => ({
      percent: percentFor(bp.scrollAnchor),
      value: bp.translations[i]
    }));
    setItemCurrentKeyframes(state, item, ranges[i].peakX, ranges[i], translateStops, usesContrast);
  });
  flushKeyframeStyles(state);
} // End setup function

// Scale/opacity/translate are all driven entirely by the CSS scroll-driven
// animations on .carousel-item; this only computes the discrete current
// index for the page dots, since no timeline hands that back to JS.
function apply(ctx) {
  const { wrapper, getScrollSource, getDrivenProgress, getGeometry, currentScrollAnchor, onProgress } = ctx;
  // Shared with the engine and with anything else watching this wrapper,
  // rather than re-measured here: this runs on every scroll frame, and a
  // pass over every item is the one thing it must not do per frame.
  const { items, anchors } = getGeometry();
  const scrollAnchor = currentScrollAnchor();

  // While something else is driving this carousel, the driver's progress is
  // the exact one and the scroll position written from it is quantised, so
  // every item's box sits a fraction of a pixel from where that progress
  // belongs. Everything the timelines draw is derived from the scroll
  // position and therefore carries the same error, which is invisible in
  // scale and opacity - fractions of a percent - and plainly visible in
  // position, where it makes the whole strip step a whole quantum at a time
  // instead of gliding. --scroll-error is what the items' translate adds to
  // land where the driver actually asked for; see its block in the page's
  // stylesheet.
  //
  // Zero, and removed, whenever this carousel is scrolling itself: progress
  // is derived from the scroll position then, so the two cannot disagree.
  const isDriven = getScrollSource() === "driven";
  const currentProgress = isDriven ? getDrivenProgress() : computeCurrentProgress(anchors, scrollAnchor);

  if (isDriven) {
    wrapper.style.setProperty(
      "--scroll-error",
      (scrollAnchor - computeScrollAnchorForProgress(anchors, currentProgress)).toFixed(3) + "px"
    );
  } else if (wrapper.style.getPropertyValue("--scroll-error")) {
    wrapper.style.removeProperty("--scroll-error");
  }

  onProgress?.(computeCurrentIndex(currentProgress, items.length), currentProgress);
} // End apply function

export const scaleFadeEffect = { onItemCreated, setup, apply };
