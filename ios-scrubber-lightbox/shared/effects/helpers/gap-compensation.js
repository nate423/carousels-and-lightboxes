// Scaling an item down opens a gap to its neighbours. This works out how
// far each item needs to move to close that gap, so a scaled carousel
// stays evenly spaced instead of loosening around whatever's current.
//
// Only the scale-fade look needs this - a fade moves nothing - which is
// why it lives beside that look instead of in carousel-math.js with the
// progress/anchor math every carousel uses.
import { transition, computeCurrentProgress, computeEdgeAnchors } from "../../carousel-math.js";

// How current item i is, 0 to 1: 1 exactly when currentProgress lands on
// i, down to 0 by the time currentProgress reaches either adjacent index.
function computeItemProgress(currentProgress, i) {
  return Math.min(Math.max(1 - Math.abs(currentProgress - i), 0), 1);
}

// Per-item `animation-range`, in native CSS `cover <percent>` units, for
// the scroll-driven scale/opacity keyframe. `cover 0%`/`100%` mean "item's
// leading edge at the wrapper's trailing edge" and "item's trailing edge
// at the wrapper's leading edge" - a span of (wrapperSize + itemSize) - so
// an item whose leading edge sits at on-screen position x is at
// cover-percent (wrapperSize - x) / (wrapperSize + itemSize).
//
// The how-current-is-it window has to be asymmetric - sized to the real
// pixel gap to each neighbouring anchor (or the item's own size at the
// carousel's edges, where there's only one neighbour). Otherwise it won't
// reach exactly 0 the moment that neighbour actually becomes current: too
// wide a window leaves a dead zone, too narrow leaves a lag, visible as
// the neighbour's own window starting or finishing late.
//
// But an asymmetric range means an item's real peak - where it's
// genuinely "current" - usually isn't at the range's midpoint, which is
// where a plain 0%/50%/100% @keyframes would put it. `peakX` is where in
// [0, 1] across [start, end] that true peak actually falls.
// `animation-timing-function` can't fix this: it only reshapes the curve
// *within* one keyframe segment, not where a keyframe's value falls
// across the whole range. So scale-fade.js gives each item its own
// generated @keyframes rule with "scale: 1" placed directly at `peakX%` -
// the only way to put a keyframe value at an arbitrary per-item position.
//
// (The translate math below doesn't need peakX at all - computeCurrentProgress
// + computeItemProgress already give the same how-current-is-it curve this
// asymmetric range encodes, just derived directly from real anchor
// distances instead of via cover-percent/peakX.)

// Each item's scale() shrinks it symmetrically around its own center,
// pulling both edges inward by scaleDiff/2 and widening the visual gap to
// every neighbour further out. To keep every gap equal to the layout's
// natural gap, translate each item toward the current item by the
// accumulated scale-loss of every item between it and the current one.
//
// The split between the two accumulation directions must use the
// continuous currentProgress, not the discrete currentIndex:
// currentProgress crosses an item's own index exactly when that item's
// itemProgress is 1 (scaleDiff is 0 there), so anchoring on it keeps the
// running sums continuous. Anchoring on currentIndex would flip at the
// midpoint between two items instead, where scaleDiff is usually nonzero
// on both sides - a visible jump.
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

// Precomputes the exact breakpoints needed to reconstruct
// computeTranslations' output as a native CSS @keyframes curve - one per
// item, driven by a scroll-timeline (see scale-fade.js).
//
// As a function of raw scroll offset, every item's translation is
// piecewise-linear: computeItemProgress's how-current-is-it curve reaches
// exactly 0 right as scrollAnchor crosses a neighbouring anchor, so each
// item's scaleDiff only bends at its neighbours' anchors - meaning the
// anchors are the only interior points where any item's translation can
// change slope.
//
// The curve runs out to the imaginary item past each end (see
// computeEdgeAnchors), not just to the ends of the scroll range, because
// overscrolling carries the scroll past them: the end item keeps winding
// down there, and its neighbours have to keep closing the gap it opens.
// Progress past the ends is measured against those same imaginary anchors,
// so the translate falls off at the same pitch as the scale-fade's own
// per-item range for the end item (computeAnimationRanges).
//
// That's `n + 2` breakpoints total, shared by every item - exact, not a
// sampled approximation. Their span is returned alongside them, as the
// scroll-anchor range the keyframes have to be laid across.
export function computeTranslationBreakpoints(anchors, sizes, noncurrentScale) {
  const n = anchors.length;
  if (n === 0) return { breakpoints: [], start: 0, end: 0 };

  const { before, after } = computeEdgeAnchors(anchors, sizes);
  const extendedAnchors = [before, ...anchors, after];

  const breakpoints = extendedAnchors.map((scrollAnchor) => {
    const currentProgress = computeCurrentProgress(extendedAnchors, scrollAnchor) - 1;
    const scales = anchors.map((_, i) => transition(computeItemProgress(currentProgress, i), noncurrentScale, 1));
    const translations = computeTranslations(anchors, sizes, scales, currentProgress);

    return { scrollAnchor, translations };
  });

  return { breakpoints, start: before, end: after };
}
