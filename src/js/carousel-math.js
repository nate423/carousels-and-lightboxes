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
//     unfocused/collapsed state to its focused/current state (0 to 1).
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
function wrapperAnchor(wrapperLength, alignment, scrollPadding) {
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
