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

export function progress(value, start, end) {
  return (value - start) / (end - start);
}

export function transition(p, start, end) {
  return start + p * (end - start);
}

export function getItemMetrics(
  wrapper,
  items,
  offsetFromStart,
  offsetLength,
  scrollDistance
) {
  const scrollCenter = wrapper[scrollDistance] + wrapper[offsetLength] / 2;
  const centers = [];
  const lengths = [];

  items.forEach((item) => {
    const itemOffsetFromWrapperStart =
      item[offsetFromStart] - wrapper[offsetFromStart];
    lengths.push(item[offsetLength]);
    centers.push(itemOffsetFromWrapperStart + item[offsetLength] / 2);
  });

  return { centers, lengths, scrollCenter };
}

// Inverse-interpolates scrollCenter against the real item centers: finds
// which pair of adjacent items brackets it and reports a fractional index
// between them. Extrapolates (unclamped) past the first/last item using
// that end segment's spacing, so it stays continuous everywhere.
export function computeCurrentProgress(centers, scrollCenter) {
  const n = centers.length;
  if (n < 2) return 0;

  let i = 0;
  while (i < n - 2 && centers[i + 1] < scrollCenter) i++;

  return i + progress(scrollCenter, centers[i], centers[i + 1]);
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
export function computeTranslations(centers, lengths, scales, currentProgress) {
  const n = centers.length;
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
