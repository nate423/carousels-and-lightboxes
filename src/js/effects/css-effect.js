// CSS-driven variant: scale/opacity/translate all come from native
// scroll-driven animations (`animation-range` + per-item @keyframes) on
// .carousel-item - scale/opacity off the per-item --item-reveal
// view-timeline, translate off the wrapper-level --carousel-scroll
// scroll-timeline (see main.css). This module only precomputes that
// animation geometry (setup); apply() just derives the current index for
// the page dots, which is the one thing no timeline can hand back to JS.
import {
  getItemMetrics,
  computeCurrentProgress,
  computeCurrentIndex,
  computeAnimationRanges,
  computeTranslationBreakpoints,
  wrapperAnchor
} from "../carousel-math.js";

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
// scroll-timeline instead of the per-item view-timeline - see main.css.
// Item ids just need to be unique site-wide (they're used in a
// `[data-item-id="N"]` selector - see below), so this counter alone stays
// module-global; it never needs resetting.
let nextItemId = 0;

// Everything else - the generated keyframe/position rules and the <style>
// elements holding them - is kept one-per-wrapper (via this WeakMap) rather
// than as module-level singletons. With a single shared set, every
// cssEffect-driven carousel on the page (there can be several at once - see
// thumbnail-scrubber.js, which runs two more alongside the main carousel)
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
      currentKeyframeRules: new Map(),
      currentKeyframeStyleEl: null,
      translateKeyframeRules: new Map(),
      translateKeyframeStyleEl: null,
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
      positionRules: new Map(),
      positionStyleEl: null
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
function setItemCurrentKeyframes(state, item, peakX, range, translateStops) {
  // Drives --item-progress rather than scale/opacity directly, so the
  // contrast policy can scale the whole look with a transition that this
  // animation does not fight - see the --item-progress block in main.css,
  // which turns the two values below into what is actually drawn.
  const currentName = `item-current-${item.dataset.itemId}`;
  state.currentKeyframeRules.set(
    currentName,
    `@keyframes ${currentName} {
      0% { --item-progress: 0; }
      ${peakX * 100}% { --item-progress: 1; }
      100% { --item-progress: 0; }
    }`
  );

  // Likewise a plain length, with which axis it belongs on left to main.css
  // - the gap it compensates for only exists in proportion to the scaling
  // that opened it, so it has to scale with contrast too, and it can only
  // do that from the same side of the split.
  const translateName = `item-translate-${item.dataset.itemId}`;
  const stops = translateStops
    .map(({ percent, value }) => `${percent}% { --item-shift: ${value}px; }`)
    .join("\n      ");
  state.translateKeyframeRules.set(translateName, `@keyframes ${translateName} {\n      ${stops}\n    }`);

  const animationName = `${currentName}, ${translateName}`;
  const animationTimeline = "--item-reveal, --carousel-scroll";
  const animationRange = `cover ${range.start * 100}% cover ${range.end * 100}%, 0% 100%`;

  item.style.animationName = animationName;
  item.style.animationTimeline = animationTimeline;
  item.style.animationRange = animationRange;

  state.positionRules.set(
    item.dataset.itemId,
    `.carousel-item[data-item-id="${item.dataset.itemId}"] {
      animation-name: ${animationName};
      animation-timeline: ${animationTimeline};
      animation-range: ${animationRange};
    }`
  );
}

// The polyfill only transpiles a <style> element's contents at the moment
// it's added to the DOM (it watches for HTMLStyleElement nodes appearing
// via MutationObserver, then rewrites that element's innerHTML once) - a
// later `.textContent =` on an already-inserted element is just a text-node
// mutation inside it, which the polyfill never sees. So each flush swaps in
// a fresh <style> with its final text already set, rather than mutating the
// previous element's textContent in place.
function replaceStyleEl(prevEl, cssText) {
  const nextEl = document.createElement("style");
  nextEl.textContent = cssText;
  document.head.appendChild(nextEl);
  if (prevEl) prevEl.remove();
  return nextEl;
}

function flushKeyframeStyles(state) {
  state.currentKeyframeStyleEl = replaceStyleEl(
    state.currentKeyframeStyleEl,
    [...state.currentKeyframeRules.values()].join("\n")
  );
  state.translateKeyframeStyleEl = replaceStyleEl(
    state.translateKeyframeStyleEl,
    [...state.translateKeyframeRules.values()].join("\n")
  );
  state.positionStyleEl = replaceStyleEl(state.positionStyleEl, [...state.positionRules.values()].join("\n"));
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
  const {
    wrapper,
    scrollDistance,
    scrollSize,
    offsetSize,
    offsetFromStart,
    getAlignmentFraction,
    getScrollPadding,
    getNoncurrentScale
  } = ctx;
  const state = getWrapperState(wrapper);
  const items = wrapper.querySelectorAll(".carousel-item");
  const alignment = getAlignmentFraction(wrapper);
  const scrollPadding = getScrollPadding(wrapper);
  const { anchors, sizes } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetSize,
    scrollDistance,
    alignment,
    scrollPadding
  );
  const ranges = computeAnimationRanges(anchors, sizes, wrapper[offsetSize], alignment, scrollPadding);

  // Native scroll-timeline progress is 0%/100% at raw scroll offset
  // 0/maxScroll, not at wrapperAnchorPoint - scrollAnchor = scrollOffset +
  // wrapperAnchorPoint (see getItemMetrics), so the reachable scrollAnchor
  // range is [wrapperAnchorPoint, wrapperAnchorPoint + maxScroll]. These are
  // the true breakpoint boundaries (see computeTranslationBreakpoints).
  const wrapperAnchorPoint = wrapperAnchor(wrapper[offsetSize], alignment, scrollPadding);
  const maxScroll = wrapper[scrollSize] - wrapper[offsetSize];
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
    setItemCurrentKeyframes(state, item, ranges[i].peakX, ranges[i], translateStops);
  });
  flushKeyframeStyles(state);
} // End setup function

// Scale/opacity/translate are all driven entirely by the CSS scroll-driven
// animations on .carousel-item; this only computes the discrete current
// index for the page dots, since no timeline hands that back to JS.
function apply(ctx) {
  const { wrapper, scrollDistance, offsetSize, offsetFromStart, getAlignmentFraction, getScrollPadding, onProgress } =
    ctx;
  const items = wrapper.querySelectorAll(".carousel-item");
  const { anchors, scrollAnchor } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetSize,
    scrollDistance,
    getAlignmentFraction(wrapper),
    getScrollPadding(wrapper)
  );

  const currentProgress = computeCurrentProgress(anchors, scrollAnchor);
  const currentIndex = computeCurrentIndex(currentProgress, items.length);

  onProgress?.(currentIndex, currentProgress);
} // End apply function

export const cssEffect = { name: "css", onItemCreated, setup, apply };
