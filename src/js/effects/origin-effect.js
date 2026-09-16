// CSS-driven variant, independent of css-effect.js: instead of scaling every
// item from its center (which pulls both edges inward and needs a whole
// second gap-compensating translate timeline to fix - see css-effect.js /
// computeTranslations in carousel-math.js), each item's transform-origin is
// anchored at whichever edge is *away* from the current item - its own
// leading edge while still approaching current (i > currentProgress), its
// own trailing edge once it's passed (i < currentProgress). Scaling then
// never moves the anchored edge, and only ever retreats the facing edge away
// from its neighbor - so gaps can only grow relative to the layout's natural
// gap, never shrink into an overlap, with no translate needed at all.
//
// This only produces a clean, evenly-spaced result when every item is the
// same length along the scroll axis - the "no translate needed" property
// specifically relies on there being nothing to compensate for between
// unequal neighbors. computeAnimationRanges still handles uneven lengths
// without error, it just won't look as evenly spaced.
//
// The origin needs to flip at the exact instant currentProgress crosses this
// item's own index - which is exactly where scale reaches 1 (peakX in its
// own --item-reveal range, the same range computeAnimationRanges already
// produces for the scale/opacity keyframes). It must NOT flip at the
// midpoint between two items (i.e. off the discrete currentIndex) - at that
// midpoint scaleDiff is nonzero on both sides, so flipping there would be a
// real, visible jump, not a no-op (same reasoning computeTranslations
// already documents for the translate case - see carousel-math.js).
//
// That flip point can't live on the same per-item --item-reveal view-timeline
// range used for scale/opacity, though: Chromium holds an item clamped at its
// animation-range boundary keyframe for several pixels of real scroll after
// it crosses INTO a fresh range before it starts interpolating (see the
// "Known limitation" comment on css-effect.js's setup) - so the incoming
// item's origin (and scale) lags a beat behind the outgoing item's, which is
// already mid-range and unaffected. Solution: drive the origin flip off the
// wrapper-level --carousel-scroll scroll-timeline instead (already declared
// generically for every non-JS effect in main.css) - it spans the full
// 0%-100% scroll range from the start, so there's no range-entry event to
// clamp against. Each item only needs one precomputed flip percentage (where
// its own anchor sits in the full scroll range), not the breakpoint array
// css-effect.js needs for translate. Scale/opacity stay on --item-reveal,
// unaffected.
//
// The flip itself must be a real, instantaneous step, not an animated
// transition between the two origin values - verified empirically that two
// @keyframes stops at the identical offset do NOT reliably produce a hard
// cut here; transform-origin (a fully animatable position) instead
// interpolates smoothly across the *entire* segment on either side, meaning
// the pivot drifts continuously well before and after the crossing instead
// of holding at one edge until exactly the crossing - which, combined with
// the concurrent scale change, is what actually produces the "swing." A
// per-keyframe `animation-timing-function: steps(1, jump-end)` forces a true
// hold-then-snap instead: the origin holds at the approach-side value for
// the entire [0%, flipPercent] segment and jumps to the passed-side value
// only exactly at flipPercent, with no interpolation in between.
import {
  getItemMetrics,
  computeCurrentProgress,
  computeCurrentIndex,
  computeAnimationRanges,
  wrapperAnchor
} from "../carousel-math.js";

let nextItemId = 0;
const keyframeRules = new Map();
let keyframeStyleEl = null;
// Same constraint as css-effect.js's positionRules: the scroll-timeline
// polyfill only discovers animation-name/-timeline/-range from real
// stylesheet rules, not inline styles, so every item also gets a generated
// selector rule pointing at the same keyframes.
const positionRules = new Map();
let positionStyleEl = null;

function replaceStyleEl(prevEl, cssText) {
  const nextEl = document.createElement("style");
  nextEl.textContent = cssText;
  document.head.appendChild(nextEl);
  if (prevEl) prevEl.remove();
  return nextEl;
}

function flushStyles() {
  keyframeStyleEl = replaceStyleEl(keyframeStyleEl, [...keyframeRules.values()].join("\n"));
  positionStyleEl = replaceStyleEl(positionStyleEl, [...positionRules.values()].join("\n"));
}

function onItemCreated(item) {
  item.dataset.itemId = String(nextItemId++);
}

function setItemOriginKeyframes(item, range, flipPercent, scrollAxis) {
  const revealName = `item-origin-reveal-${item.dataset.itemId}`;
  const flipName = `item-origin-flip-${item.dataset.itemId}`;
  // Away edge while approaching (item hasn't reached current yet) vs. away
  // edge once passed - see file header.
  const approachOrigin = scrollAxis === "x" ? "100% 50%" : "50% 100%";
  const passedOrigin = scrollAxis === "x" ? "0% 50%" : "50% 0%";

  keyframeRules.set(
    revealName,
    `@keyframes ${revealName} {
      0% { scale: var(--noncurrent-scale); opacity: var(--noncurrent-opacity); }
      ${range.peakX * 100}% { scale: 1; opacity: 1; }
      100% { scale: var(--noncurrent-scale); opacity: var(--noncurrent-opacity); }
    }`
  );

  // flipPercent clamped to [0, 100] means this item's own anchor sits
  // outside the reachable scroll range entirely (e.g. the first/last item at
  // alignment: start/end) - currentProgress is then always on one side of it,
  // so the origin never actually needs to flip; a degenerate two-stop rule
  // holding one value covers that case without a special branch below.
  const flipStops =
    flipPercent <= 0
      ? `0% { transform-origin: ${passedOrigin}; } 100% { transform-origin: ${passedOrigin}; }`
      : flipPercent >= 100
      ? `0% { transform-origin: ${approachOrigin}; } 100% { transform-origin: ${approachOrigin}; }`
      : `0% { transform-origin: ${approachOrigin}; animation-timing-function: steps(1, jump-end); }
         ${flipPercent}% { transform-origin: ${passedOrigin}; }
         100% { transform-origin: ${passedOrigin}; }`;
  keyframeRules.set(flipName, `@keyframes ${flipName} {\n      ${flipStops}\n    }`);

  const animationName = `${revealName}, ${flipName}`;
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

// Pure layout math - only needs recomputing when geometry or alignment
// changes, not on scroll. No translate keyframes at all (unlike
// css-effect.js) - see file header.
function setup(ctx) {
  const { wrapper, scrollDistance, scrollSize, offsetLength, offsetFromStart, scrollAxis, getAlignmentFraction, getScrollPadding } =
    ctx;
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

  // Maps a scrollAnchor value onto the --carousel-scroll timeline's 0%-100%
  // (raw scroll offset 0/maxScroll), same relationship css-effect.js's
  // percentFor uses for its own translate breakpoints - see the comment on
  // that timeline in main.css for why scrollAnchor and raw offset differ by
  // wrapperAnchorPoint.
  const wrapperAnchorPoint = wrapperAnchor(wrapper[offsetLength], alignment, scrollPadding);
  const maxScroll = wrapper[scrollSize] - wrapper[offsetLength];
  const percentFor = (scrollAnchor) =>
    maxScroll <= 0 ? 0 : Math.min(Math.max(((scrollAnchor - wrapperAnchorPoint) / maxScroll) * 100, 0), 100);

  items.forEach((item, i) => setItemOriginKeyframes(item, ranges[i], percentFor(anchors[i]), scrollAxis));
  flushStyles();
} // End setup function

// Scale/opacity/transform-origin are all driven entirely by the native
// scroll-driven animation on .carousel-item; this only computes the discrete
// current index for the page dots.
function apply(ctx) {
  const { wrapper, scrollDistance, offsetLength, offsetFromStart, getAlignmentFraction, getScrollPadding, updatePageIndicator } =
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

  updatePageIndicator(wrapper, currentIndex);
} // End apply function

export const originEffect = { name: "origin", onItemCreated, setup, apply };
