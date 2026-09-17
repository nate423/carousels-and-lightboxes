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
let nextItemId = 0;
const currentKeyframeRules = new Map();
let currentKeyframeStyleEl = null;
const translateKeyframeRules = new Map();
let translateKeyframeStyleEl = null;
// The scroll-timeline polyfill (Safari) doesn't support animation-timeline
// et al. set as inline styles - it works by parsing real stylesheet rules
// for those properties and matching their selectors against the DOM (see
// getAnimationTimelineOptions in vendor/scroll-timeline.js), the same way
// it discovers everything else here. Inline styles are invisible to it.
// So every item's animation-name/-timeline/-range also gets a generated
// selector rule here, in addition to the inline styles below (which native
// engines read directly, and which win in the CSSOM anyway - same values,
// so no conflict).
const positionRules = new Map();
let positionStyleEl = null;

// Only builds the rule text and points the item at it - doesn't touch the
// shared stylesheets' textContent. Setting textContent is a full
// reparse/recalc of every rule in it, so setup() batches all n items' rules
// and writes each stylesheet exactly once after its items.forEach loop
// instead of n times (was O(n^2) - the likely cause of the jank/freezing
// seen resizing the window, since resize has no debounce and calls setup()
// on every native 'resize' event).
function setItemCurrentKeyframes(item, peakX, range, translateStops, scrollAxis) {
  const currentName = `item-current-${item.dataset.itemId}`;
  currentKeyframeRules.set(
    currentName,
    `@keyframes ${currentName} {
      0% { scale: var(--noncurrent-scale); opacity: var(--noncurrent-opacity); }
      ${peakX * 100}% { scale: 1; opacity: 1; }
      100% { scale: var(--noncurrent-scale); opacity: var(--noncurrent-opacity); }
    }`
  );

  const translateName = `item-translate-${item.dataset.itemId}`;
  const stops = translateStops
    .map(({ percent, value }) => {
      const translateValue = scrollAxis === "x" ? `${value}px 0` : `0 ${value}px`;
      return `${percent}% { translate: ${translateValue}; }`;
    })
    .join("\n      ");
  translateKeyframeRules.set(translateName, `@keyframes ${translateName} {\n      ${stops}\n    }`);

  const animationName = `${currentName}, ${translateName}`;
  const animationTimeline = "--item-reveal, --carousel-scroll";
  const animationRange = `cover ${range.start * 100}% cover ${range.end * 100}%, 0% 100%`;

  item.style.animationName = animationName;
  item.style.animationTimeline = animationTimeline;
  item.style.animationRange = animationRange;

  positionRules.set(
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

function flushKeyframeStyles() {
  currentKeyframeStyleEl = replaceStyleEl(currentKeyframeStyleEl, [...currentKeyframeRules.values()].join("\n"));
  translateKeyframeStyleEl = replaceStyleEl(
    translateKeyframeStyleEl,
    [...translateKeyframeRules.values()].join("\n")
  );
  positionStyleEl = replaceStyleEl(positionStyleEl, [...positionRules.values()].join("\n"));
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
    offsetLength,
    offsetFromStart,
    scrollAxis,
    getAlignmentFraction,
    getScrollPadding,
    getNoncurrentScale
  } = ctx;
  const items = wrapper.querySelectorAll(".carousel-item");
  const alignment = getAlignmentFraction(wrapper);
  const scrollPadding = getScrollPadding(wrapper);
  const { anchors, lengths } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetLength,
    scrollDistance,
    alignment,
    scrollPadding
  );
  const ranges = computeAnimationRanges(anchors, lengths, wrapper[offsetLength], alignment, scrollPadding);

  // Native scroll-timeline progress is 0%/100% at raw scroll offset
  // 0/maxScroll, not at wrapperAnchorPoint - scrollAnchor = scrollOffset +
  // wrapperAnchorPoint (see getItemMetrics), so the reachable scrollAnchor
  // range is [wrapperAnchorPoint, wrapperAnchorPoint + maxScroll]. These are
  // the true breakpoint boundaries (see computeTranslationBreakpoints).
  const wrapperAnchorPoint = wrapperAnchor(wrapper[offsetLength], alignment, scrollPadding);
  const maxScroll = wrapper[scrollSize] - wrapper[offsetLength];
  const percentFor = (scrollAnchor) =>
    maxScroll <= 0
      ? 0
      : Math.min(Math.max(((scrollAnchor - wrapperAnchorPoint) / maxScroll) * 100, 0), 100);

  const breakpoints = computeTranslationBreakpoints(
    anchors,
    lengths,
    getNoncurrentScale(wrapper),
    wrapperAnchorPoint,
    wrapperAnchorPoint + Math.max(maxScroll, 0)
  );

  items.forEach((item, i) => {
    const translateStops = breakpoints.map((bp) => ({
      percent: percentFor(bp.scrollAnchor),
      value: bp.translations[i]
    }));
    setItemCurrentKeyframes(item, ranges[i].peakX, ranges[i], translateStops, scrollAxis);
  });
  flushKeyframeStyles();
} // End setup function

// Scale/opacity/translate are all driven entirely by the CSS scroll-driven
// animations on .carousel-item; this only computes the discrete current
// index for the page dots, since no timeline hands that back to JS.
function apply(ctx) {
  const { wrapper, scrollDistance, offsetLength, offsetFromStart, getAlignmentFraction, getScrollPadding, onProgress } =
    ctx;
  const items = wrapper.querySelectorAll(".carousel-item");
  const { anchors, scrollAnchor } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetLength,
    scrollDistance,
    getAlignmentFraction(wrapper),
    getScrollPadding(wrapper)
  );

  const currentProgress = computeCurrentProgress(anchors, scrollAnchor);
  const currentIndex = computeCurrentIndex(currentProgress, items.length);

  onProgress?.(currentIndex, currentProgress);
} // End apply function

export const cssEffect = { name: "css", onItemCreated, setup, apply };
