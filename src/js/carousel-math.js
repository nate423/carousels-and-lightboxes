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

export function findCenteredIndex(centers, scrollCenter) {
  let centeredIndex = 0;
  let smallestDistance = Infinity;

  centers.forEach((center, i) => {
    const distance = Math.abs(scrollCenter - center);
    if (distance < smallestDistance) {
      smallestDistance = distance;
      centeredIndex = i;
    }
  });

  return centeredIndex;
}

// Falls off linearly from 1 (at this item's own center) to 0 by the time
// scrollCenter reaches whichever neighbor is ahead of it.
export function computeProgress(centers, i, scrollCenter) {
  const itemCenter = centers[i];
  const distanceFromCenter = Math.abs(scrollCenter - itemCenter);

  const nextItemCenterDistance =
    i < centers.length - 1 ? Math.abs(itemCenter - centers[i + 1]) : 0;
  const prevItemCenterDistance =
    i > 0 ? Math.abs(itemCenter - centers[i - 1]) : 0;

  let transitionDistance;
  if (i === 0) {
    transitionDistance = nextItemCenterDistance;
  } else if (i === centers.length - 1) {
    transitionDistance = prevItemCenterDistance;
  } else {
    transitionDistance =
      scrollCenter > itemCenter
        ? nextItemCenterDistance
        : prevItemCenterDistance;
  }

  return 1 - Math.min(distanceFromCenter / transitionDistance, 1);
}

export function interpolateOpacity(progress) {
  return 0.5 + progress * 0.5;
}

export function interpolateBlur(progress) {
  return (1 - progress) * 0 + "px";
}

export function interpolateScale(progress) {
  return 0.8 + progress * 0.2;
}

// Each item's scale() shrinks it symmetrically around its own center, which
// pulls both of its edges inward by scaleDiff/2 and would otherwise widen the
// visual gap to every neighbor further out. To keep every adjacent gap equal
// to the layout's natural gap, translate each item toward scrollCenter by the
// accumulated scale-loss of every item between it and scrollCenter.
//
// The split between the two accumulation directions must be the continuous
// itemCenter-vs-scrollCenter comparison (not "which item is currently
// closest"): scrollCenter crosses an item's own center exactly when that
// item's scaleDiff is 0 (progress === 1 there), so anchoring on it keeps the
// running sums continuous. Anchoring on the closest-item index instead would
// flip at the midpoint between two items, where scaleDiff is generally
// nonzero on both sides, producing a visible jump.
export function computeTranslations(centers, lengths, scales, scrollCenter) {
  const n = centers.length;
  const translations = new Array(n).fill(0);
  const scaleDiff = (i) => lengths[i] * (1 - scales[i]);

  let acc = 0;
  for (let i = n - 1; i >= 0; i--) {
    if (centers[i] < scrollCenter) {
      acc += scaleDiff(i);
      translations[i] = acc - scaleDiff(i) / 2;
    }
  }

  acc = 0;
  for (let i = 0; i < n; i++) {
    if (centers[i] > scrollCenter) {
      acc += scaleDiff(i);
      translations[i] = -(acc - scaleDiff(i) / 2);
    }
  }

  return translations;
}
