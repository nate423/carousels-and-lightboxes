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
// None of the above cares *where* "current" is measured from within the
// wrapper/item - that's a separate, orthogonal concept: alignment. Alignment
// is a fraction (0 = start/leading edge, 0.5 = center, 1 = end/trailing
// edge) applied identically to the wrapper and to every item to produce a
// single "anchor point" for each. Everything below just asks "is the
// wrapper's anchor point at the same scroll position as this item's anchor
// point?" - the fraction itself never needs to leak past getItemMetrics and
// the scroll-target helpers.

export const ALIGNMENT_FRACTIONS = { start: 0, center: 0.5, end: 1 };

export function alignmentFraction(alignment) {
  return ALIGNMENT_FRACTIONS[alignment] ?? ALIGNMENT_FRACTIONS.center;
}

export function progress(value, start, end) {
  return (value - start) / (end - start);
}

export function transition(p, start, end) {
  return start + p * (end - start);
}

// The wrapper's anchor point, inset from its true start/end by
// scrollPadding on each side - same idea as the CSS `scroll-padding`
// property, reimplemented here because that property doesn't survive the
// spacer-based trailing-edge workaround these carousels already rely on.
// At alignment 0.5 the two insets cancel out (inset - 2*inset*0.5 = 0), so
// scrollPadding is a no-op for center alignment and doesn't need to be
// special-cased anywhere that calls this.
export function wrapperAnchor(wrapperLength, alignment, scrollPadding) {
  return (
    scrollPadding + alignment * (wrapperLength - 2 * scrollPadding)
  );
}

export function getItemMetrics(
  wrapper,
  items,
  offsetFromStart,
  offsetLength,
  scrollDistance,
  alignment,
  scrollPadding = 0
) {
  const scrollAnchor =
    wrapper[scrollDistance] +
    wrapperAnchor(wrapper[offsetLength], alignment, scrollPadding);
  const anchors = [];
  const lengths = [];

  items.forEach((item) => {
    const itemOffsetFromWrapperStart =
      item[offsetFromStart] - wrapper[offsetFromStart];
    lengths.push(item[offsetLength]);
    anchors.push(itemOffsetFromWrapperStart + item[offsetLength] * alignment);
  });

  return { anchors, lengths, scrollAnchor };
}

// Scroll offset (relative to the wrapper) that puts this item's anchor point
// at the wrapper's anchor point - i.e. where to scroll to bring it "current"
// under the given alignment. Shared by click-to-scroll and page-dot clicks.
export function computeScrollTarget(
  wrapper,
  item,
  offsetFromStart,
  offsetLength,
  alignment,
  scrollPadding = 0
) {
  return (
    item[offsetFromStart] -
    wrapper[offsetFromStart] -
    (wrapperAnchor(wrapper[offsetLength], alignment, scrollPadding) -
      item[offsetLength] * alignment)
  );
}

// Length of the spacer needed on one edge of the wrapper so that the item
// touching that edge (edgeFraction 0 for the leading spacer, 1 for the
// trailing one) can still reach the wrapper's anchor point. Generalizes the
// plain "(wrapperLength - itemLength) * edgeFraction" case (scrollPadding 0)
// with the same inset term as wrapperAnchor.
export function computeSpacerLength(
  wrapperLength,
  itemLength,
  edgeFraction,
  gapLength,
  scrollPadding = 0
) {
  return (
    wrapperAnchor(wrapperLength, edgeFraction, scrollPadding) -
    itemLength * edgeFraction -
    gapLength
  );
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

// Triangular falloff: 1 exactly at this item's own index, down to 0 by the
// time currentProgress reaches either neighboring index.
export function computeItemProgress(currentProgress, i) {
  return Math.min(Math.max(1 - Math.abs(currentProgress - i), 0), 1);
}

// Per-item `animation-range` (in native CSS `cover <percent>` units) for the
// scroll-driven scale/opacity keyframe. Native `cover 0%`/`100%` correspond
// respectively to "item's leading edge at the wrapper's trailing edge" and
// "item's trailing edge at the wrapper's leading edge", a span of
// (wrapperLength + itemLength) - from that geometry, an item at on-screen
// leading-edge position `x` sits at cover-percent
// `(wrapperLength - x) / (wrapperLength + itemLength)`.
//
// The falloff window has to be asymmetric, sized independently to the real
// pixel gap to each neighboring anchor (falling back to the item's own
// length at the carousel's edges, where there's only one neighbor) -
// otherwise the falloff doesn't reach exactly 0 at the moment a neighbor
// actually becomes current, leaving either a dead zone (real gap wider than
// the window) or a lag (real gap narrower) on whichever side isn't sized to
// match, visible as the adjacent item's own falloff starting or finishing
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
// lands. Instead main.js (setItemCurrentKeyframes) gives each item its own
// generated `@keyframes` rule with the "scale: 1" stop placed directly at
// `peakX%` - the only way to put a keyframe value at an arbitrary per-item
// position. (The gap-compensating translate math below doesn't need peakX
// at all: computeCurrentProgress + computeItemProgress already reduce to
// the same anchor-based tent shape this asymmetric range encodes, just
// derived directly from real anchor distances instead of by way of
// cover-percent/peakX.)
export function computeAnimationRanges(anchors, lengths, wrapperLength, alignment, scrollPadding) {
  const n = anchors.length;
  const wrapperAnchorPoint = wrapperAnchor(wrapperLength, alignment, scrollPadding);

  return anchors.map((anchor, i) => {
    const itemLength = lengths[i];
    const span = wrapperLength + itemLength;
    const currentLeadingEdge = wrapperAnchorPoint - itemLength * alignment;
    const peak = (wrapperLength - currentLeadingEdge) / span;

    const deltaPrev = i > 0 ? anchor - anchors[i - 1] : itemLength;
    const deltaNext = i < n - 1 ? anchors[i + 1] - anchor : itemLength;

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
export function computeTranslations(anchors, lengths, scales, currentProgress) {
  const n = anchors.length;
  const translations = new Array(n).fill(0);
  const scaleDiff = (i) => lengths[i] * (1 - scales[i]);

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
// css-effect.js). As a function of raw scroll offset, every item's
// translation is piecewise-linear: computeItemProgress's triangular falloff
// (derived from the real anchor-to-anchor pixel distances via
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
  lengths,
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
    const translations = computeTranslations(anchors, lengths, scales, currentProgress);

    return { scrollAnchor, translations };
  });
}

// The JS-effect analog of what a native scroll-timeline does with the same
// breakpoints (see computeTranslationBreakpoints): finds which pair of
// adjacent breakpoints brackets scrollAnchor and linearly interpolates each
// item's translation between them, instead of recomputing computeTranslations
// from scratch every scroll frame. Same bracket-search shape as
// computeCurrentProgress above, just walking breakpoints instead of anchors.
export function interpolateTranslations(breakpoints, scrollAnchor) {
  const n = breakpoints.length;
  if (n === 0) return [];
  if (n === 1) return breakpoints[0].translations;

  let i = 0;
  while (i < n - 2 && breakpoints[i + 1].scrollAnchor < scrollAnchor) i++;

  const p = progress(scrollAnchor, breakpoints[i].scrollAnchor, breakpoints[i + 1].scrollAnchor);
  return breakpoints[i].translations.map((start, itemIndex) =>
    transition(p, start, breakpoints[i + 1].translations[itemIndex])
  );
}
