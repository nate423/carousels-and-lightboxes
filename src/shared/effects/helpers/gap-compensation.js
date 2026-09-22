// Scaling an item down opens a gap between it and its neighbours. This works
// out how far each item has to move to close that gap, so a scaled carousel
// stays evenly spaced instead of loosening around whatever is current.
//
// Only the scale-fade look needs any of it - a fade moves nothing - which is
// why it lives beside that look rather than in carousel-math.js with the
// progress and anchor math every carousel here uses.
import { transition, computeCurrentProgress } from "../../carousel-math.js";

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
// lands. Instead scale-fade.js (setItemCurrentKeyframes) gives each item
// its own generated `@keyframes` rule with the "scale: 1" stop placed directly at
// `peakX%` - the only way to put a keyframe value at an arbitrary per-item
// position. (The gap-compensating translate math below doesn't need peakX
// at all: computeCurrentProgress + computeItemProgress already produce the
// same how-current-is-it curve this asymmetric range encodes, just derived
// directly from real anchor distances instead of by way of
// cover-percent/peakX.)

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
// effects/scale-fade.js). As a function of raw scroll offset, every item's
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
