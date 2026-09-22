// Two generic primitives (matching Origami Studio's Progress/Transition
// patches), used throughout instead of bespoke per-value interpolation:
//   progress(value, start, end)   - where does value fall between start/end
//   transition(progress, start, end) - map a progress back onto a range
//
// Three distinct "progress" values come out of these for this carousel:
//   - scrollProgress: progress(rawScrollPosition, 0, maxScrollPosition) -
//     0 at the very start of the carousel, 1 at the very end. Not needed by
//     anything below, but it's the reference point for the naming: every
//     "X progress" here means "0 at the start of X's range, 1 at the end."
//   - currentProgress: continuous position in *item-index* units (0 at item
//     0, n-1 at the last item, fractional in between, e.g. 1.35). This is
//     "which item is current" without the discrete jump at the 50% mark.
//   - itemProgress: per item, how far *that item* has animated from its
//     noncurrent/collapsed state to its current state (0 to 1).
//     A pure function of currentProgress and the item's own index.
//
// Where "current" is measured from is the centre, of the wrapper and of each
// item alike - each gets a single "anchor point" there, and everything below
// asks one question: is the wrapper's anchor point at the same scroll
// position as this item's? That used to be a fraction threaded through every
// formula here (0 for the leading edge, 0.5 for the centre, 1 for the
// trailing edge), which is why several of them still read as the general case
// collapsed rather than as something written for the centre.

function progress(value, start, end) {
  return (value - start) / (end - start);
}

function transition(p, start, end) {
  return start + p * (end - start);
}

// The wrapper's own anchor point: its middle.
//
// This used to carry a scrollPadding inset on each side, so a start- or
// end-aligned item had room to sit in rather than landing flush against the
// wrapper's edge. Centred, the two insets cancel exactly
// (inset + 0.5 * (size - 2 * inset) = size / 2), so that parameter never had
// any effect here and is gone along with the alignment it existed for.
export function wrapperAnchor(wrapperSize) {
  return wrapperSize / 2;
}

// The only two functions here that touch the DOM, and they touch it only to
// read two numbers per item. Everything else below takes numbers and returns
// numbers, which is why the axis never had to reach any further than this.
export function getItemMetrics(wrapper, items) {
  const scrollAnchor = wrapper.scrollLeft + wrapperAnchor(wrapper.offsetWidth);
  const anchors = [];
  const sizes = [];

  items.forEach((item) => {
    const itemOffsetFromWrapperStart = item.offsetLeft - wrapper.offsetLeft;
    sizes.push(item.offsetWidth);
    anchors.push(itemOffsetFromWrapperStart + item.offsetWidth / 2);
  });

  return { anchors, sizes, scrollAnchor };
}

// Scroll offset (relative to the wrapper) that puts this item's anchor point
// at the wrapper's anchor point - i.e. where to scroll to bring it "current"
// i.e. where to scroll to bring it "current". Shared by click-to-scroll and
// page-dot clicks.
export function computeScrollTarget(wrapper, item) {
  return (
    item.offsetLeft - wrapper.offsetLeft - (wrapperAnchor(wrapper.offsetWidth) - item.offsetWidth / 2)
  );
}

// Size of the spacer needed at each edge of the wrapper so that the first and
// last items can still reach its anchor point. Both edges take the same
// amount now: the leading spacer used to be sized by the alignment fraction
// and the trailing one by its complement, which are equal only at the centre.
export function computeSpacerSize(wrapperSize, itemSize, gapSize) {
  return (wrapperSize - itemSize) / 2 - gapSize;
}

// Inverse-interpolates scrollAnchor against the real item anchors: finds
// which pair of adjacent items brackets it and reports a fractional index
// between them. Extrapolates (unclamped) past the first/last item using
// that end segment's spacing, so it stays continuous everywhere.
export function computeCurrentProgress(anchors, scrollAnchor) {
  const n = anchors.length;
  if (n < 2) return 0;

  let i = 0;
  while (i < n - 2 && anchors[i + 1] < scrollAnchor) i++;

  return i + progress(scrollAnchor, anchors[i], anchors[i + 1]);
}

// Discrete "which item is current" - jumps at the halfway point between
// two items, unlike currentProgress.
export function computeCurrentIndex(currentProgress, itemCount) {
  return Math.min(Math.max(Math.round(currentProgress), 0), itemCount - 1);
}

// Inverse of computeCurrentProgress: given a (possibly fractional, possibly
// out-of-[0, n-1]) currentProgress, reconstructs the scrollAnchor that would
// have produced it against this array of anchors. Used to manually drive one
// carousel's scroll position from another carousel's live currentProgress
// (see carousel-link.js) - a direct write, not a native scrollTo(), since the
// source's progress is itself continuously changing during a live scroll/drag
// and native smooth-scroll only makes sense against a fixed destination.
export function computeScrollAnchorForProgress(anchors, progress) {
  const n = anchors.length;
  if (n === 0) return 0;
  if (n === 1) return anchors[0];

  const i = Math.min(Math.max(Math.floor(progress), 0), n - 2);
  return transition(progress - i, anchors[i], anchors[i + 1]);
}

// How current item i is, 0 to 1: 1 exactly when currentProgress lands on
// i, down to 0 by the time currentProgress reaches either adjacent index.
function computeItemProgress(currentProgress, i) {
  return Math.min(Math.max(1 - Math.abs(currentProgress - i), 0), 1);
}

// Per-item `animation-range` (in native CSS `cover <percent>` units) for the
// scroll-driven scale/opacity keyframe. Native `cover 0%`/`100%` correspond
// respectively to "item's leading edge at the wrapper's trailing edge" and
// "item's trailing edge at the wrapper's leading edge", a span of
// (wrapperSize + itemSize) - from that geometry, an item at on-screen
// leading-edge position `x` sits at cover-percent
// `(wrapperSize - x) / (wrapperSize + itemSize)`.
//
// The how-current-is-it window has to be asymmetric, sized independently to
// the real pixel gap to each neighboring anchor (falling back to the item's
// own size at the carousel's edges, where there's only one neighbor) -
// otherwise it doesn't reach exactly 0 at the moment a neighbor actually
// becomes current, leaving either a dead zone (real gap wider than the
// window) or a lag (real gap narrower) on whichever side isn't sized to
// match, visible as the adjacent item's own window starting or finishing
// late relative to this one's.
//
// But an asymmetric range means the item's own peak (where it's genuinely
// "current") generally does NOT sit at the range's arithmetic midpoint -
// exactly the point a plain 0%/50%/100% @keyframes would treat as fully
// current. `peakX` is where in [0, 1] across [start, end] that true peak
// actually falls. `animation-timing-function` can't fix this on its own -
// it applies independently *within* each keyframe-to-keyframe segment
// (re-based to that segment's own local 0-1), not as a single remap across
// the whole animation, so it can't shift where a keyframe's value actually
// lands. Instead scale-fade-effect.js (setItemCurrentKeyframes) gives each
// item its own
// generated `@keyframes` rule with the "scale: 1" stop placed directly at
// `peakX%` - the only way to put a keyframe value at an arbitrary per-item
// position. (The gap-compensating translate math below doesn't need peakX
// at all: computeCurrentProgress + computeItemProgress already produce the
// same how-current-is-it curve this asymmetric range encodes, just derived
// directly from real anchor distances instead of by way of
// cover-percent/peakX.)
export function computeAnimationRanges(anchors, sizes, wrapperSize) {
  const n = anchors.length;

  return anchors.map((anchor, i) => {
    const itemSize = sizes[i];
    const span = wrapperSize + itemSize;

    // Where this item's own anchor crossing falls across its cover range.
    // Centred, that is exactly halfway, for every item and every size:
    //   leadingEdge = wrapperSize/2 - itemSize/2
    //   peak        = (wrapperSize - leadingEdge) / (wrapperSize + itemSize)
    //               = ((wrapperSize + itemSize) / 2) / (wrapperSize + itemSize)
    //
    // This does NOT make peakX below 0.5 as well, so it does not remove the
    // need for a per-item @keyframes rule: peakX measures where the peak sits
    // within the item's own clamped sub-range, which is asymmetric whenever
    // its two neighbours are at different distances - which, at varying item
    // sizes, is essentially always.
    const peak = 0.5;

    const deltaPrev = i > 0 ? anchor - anchors[i - 1] : itemSize;
    const deltaNext = i < n - 1 ? anchors[i + 1] - anchor : itemSize;

    const start = clamp(peak - deltaPrev / span, 0, 1);
    const end = clamp(peak + deltaNext / span, 0, 1);
    const peakX = end === start ? 0.5 : clamp((peak - start) / (end - start), 0, 1);

    return { start, end, peakX };
  });
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

// Each item's scale() shrinks it symmetrically around its own center, which
// pulls both of its edges inward by scaleDiff/2 and would otherwise widen the
// visual gap to every neighbor further out. To keep every adjacent gap equal
// to the layout's natural gap, translate each item toward the current item by
// the accumulated scale-loss of every item between it and the current item.
//
// The split between the two accumulation directions must be the continuous
// currentProgress (not the discrete currentIndex): currentProgress crosses
// an item's own index exactly when that item's itemProgress is 1 (scaleDiff
// is 0 there), so anchoring on it keeps the running sums continuous.
// Anchoring on currentIndex instead would flip at the midpoint between two
// items, where scaleDiff is generally nonzero on both sides, producing a
// visible jump.
function computeTranslations(anchors, sizes, scales, currentProgress) {
  const n = anchors.length;
  const translations = new Array(n).fill(0);
  const scaleDiff = (i) => sizes[i] * (1 - scales[i]);

  let acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (i < currentProgress) {
      acc += scaleDiff(i);
      translations[i] = acc - scaleDiff(i) / 2;
    }
  }

  acc = 0;
  for (let i = 0; i < n; i++) {
    if (i > currentProgress) {
      acc += scaleDiff(i);
      translations[i] = -(acc - scaleDiff(i) / 2);
    }
  }

  return translations;
}

// Precomputes the exact breakpoints needed to reconstruct computeTranslations'
// output as a native CSS @keyframes curve (one per item, driven by a
// scroll-timeline spanning the wrapper's whole scrollable range - see
// effects/scale-fade-effect.js). As a function of raw scroll offset, every item's
// translation is piecewise-linear: computeItemProgress's how-current-is-it
// curve (derived from the real anchor-to-anchor pixel distances via
// computeCurrentProgress, same as it is for the JS effect) reaches exactly 0
// right as scrollAnchor crosses a neighboring anchor, so each item's
// scaleDiff only bends at its own neighbors' anchors - meaning the anchors
// themselves are the only interior points where any item's translation can
// change slope. The two ends of the *reachable* scroll range
// (minScrollAnchor/maxScrollAnchor - the scrollAnchor at raw scroll offset 0
// and at maxScroll, i.e. exactly where the leading/trailing spacer
// bottoms/tops out) close off the curve; note these are generally NOT the
// same as the first/last item's own off-screen cover-range fallback used by
// computeAnimationRanges, which covers space the carousel can never actually
// be scrolled to - reusing that fallback here would place a spurious
// breakpoint the scroll-timeline can never reach, past
// minScrollAnchor/maxScrollAnchor, colliding with the real boundary once
// both clamp to the same 0%/100% keyframe stop. That's `n + 2` breakpoints
// total, shared by every item - exact, not a sampled approximation.
export function computeTranslationBreakpoints(
  anchors,
  sizes,
  noncurrentScale,
  minScrollAnchor,
  maxScrollAnchor
) {
  const n = anchors.length;
  if (n === 0) return [];

  const breakpointAnchors = [minScrollAnchor, ...anchors, maxScrollAnchor].sort((a, b) => a - b);

  return breakpointAnchors.map((scrollAnchor) => {
    const currentProgress = computeCurrentProgress(anchors, scrollAnchor);
    const scales = anchors.map((_, i) => transition(computeItemProgress(currentProgress, i), noncurrentScale, 1));
    const translations = computeTranslations(anchors, sizes, scales, currentProgress);

    return { scrollAnchor, translations };
  });
}
