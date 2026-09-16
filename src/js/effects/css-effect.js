// CSS-driven variant: scale/opacity come from a native scroll-driven
// animation (`animation-range` + per-item @keyframes) on .carousel-item.
// This module only precomputes that animation geometry (setup) and, on
// scroll, the gap-compensating translate + current index that the CSS
// animation itself can't derive (apply) - see carousel-math.js for why.
import {
  getItemMetrics,
  computeCurrentProgress,
  computeCurrentIndex,
  computeItemFocus,
  computeTranslations,
  computeAnimationRanges,
  transition
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
// recomputes geometry.
let nextFocusId = 0;
const focusKeyframeRules = new Map();
let focusKeyframeStyleEl = null;

function setItemFocusKeyframes(item, peakX) {
  if (!focusKeyframeStyleEl) {
    focusKeyframeStyleEl = document.createElement("style");
    document.head.appendChild(focusKeyframeStyleEl);
  }
  const name = `item-focus-${item.dataset.focusId}`;
  focusKeyframeRules.set(
    name,
    `@keyframes ${name} {
      0% { scale: var(--unfocused-scale); opacity: var(--unfocused-opacity); }
      ${peakX * 100}% { scale: 1; opacity: 1; }
      100% { scale: var(--unfocused-scale); opacity: var(--unfocused-opacity); }
    }`
  );
  focusKeyframeStyleEl.textContent = [...focusKeyframeRules.values()].join("\n");
  item.style.animationName = name;
}

function onItemCreated(item) {
  item.dataset.focusId = String(nextFocusId++);
}

// Sets each item's `animation-range` from its own geometry, sized to the
// real pixel gap to each neighboring anchor so the falloff reaches
// exactly 0 exactly when that neighbor becomes current (asymmetric
// whenever neighboring items differ in size, which they always do here).
// That asymmetry means the item's own peak (where it's genuinely
// "current") generally doesn't sit at the range's arithmetic midpoint, so
// each item gets its own @keyframes rule (see setItemFocusKeyframes) with
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
// computeItemFocus's prediction are both already correct at that point.
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
    offsetLength,
    offsetFromStart,
    getAlignmentFraction,
    getScrollPadding
  } = ctx;
  const items = wrapper.querySelectorAll(".carousel-item");
  const { anchors, lengths } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetLength,
    scrollDistance,
    getAlignmentFraction(wrapper),
    getScrollPadding(wrapper)
  );
  const ranges = computeAnimationRanges(
    anchors,
    lengths,
    wrapper[offsetLength],
    getAlignmentFraction(wrapper),
    getScrollPadding(wrapper)
  );

  items.forEach((item, i) => {
    const { start, end, peakX } = ranges[i];
    item.style.animationRange = `cover ${start * 100}% cover ${end * 100}%`;
    setItemFocusKeyframes(item, peakX);
  });
} // End setup function

// Scale/opacity are driven entirely by the CSS scroll-driven animation on
// .carousel-item; this only computes the gap-compensating translate
// (computeTranslations needs global state - every item's scale-loss
// relative to the current item - which a per-item view-timeline can't
// see) and the discrete current index for the page dots.
function apply(ctx) {
  const {
    wrapper,
    scrollDistance,
    offsetLength,
    offsetFromStart,
    scrollAxis,
    getAlignmentFraction,
    getScrollPadding,
    getUnfocusedScale,
    updatePageIndicator
  } = ctx;
  const items = wrapper.querySelectorAll(".carousel-item");
  const { anchors, lengths, scrollAnchor } = getItemMetrics(
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

  const focus = computeItemFocus(
    anchors,
    lengths,
    wrapper[offsetLength],
    getAlignmentFraction(wrapper),
    getScrollPadding(wrapper),
    scrollAnchor
  );
  const unfocusedScale = getUnfocusedScale(wrapper);
  const scales = focus.map((f) => transition(f, unfocusedScale, 1));

  const translations = computeTranslations(anchors, lengths, scales, currentProgress);

  items.forEach((item, i) => {
    item.style.translate =
      scrollAxis === "x"
        ? `${translations[i]}px 0` // X-axis translation
        : `0 ${translations[i]}px`; // Y-axis translation
  });

  updatePageIndicator(wrapper, currentIndex);
} // End apply function

export const cssEffect = { name: "css", onItemCreated, setup, apply };
