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

export function transition(p, start, end) {
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
// (see linked-scrolling/link.js) - a direct write, not a native scrollTo(), since the
// source's progress is itself continuously changing during a live scroll/drag
// and native smooth-scroll only makes sense against a fixed destination.
export function computeScrollAnchorForProgress(anchors, progress) {
  const n = anchors.length;
  if (n === 0) return 0;
  if (n === 1) return anchors[0];

  const i = Math.min(Math.max(Math.floor(progress), 0), n - 2);
  return transition(progress - i, anchors[i], anchors[i + 1]);
}

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
