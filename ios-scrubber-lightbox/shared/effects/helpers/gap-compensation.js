// The scale-fade look's math. Items other than the centered one are drawn
// smaller, which opens gaps between them; each item is shifted toward the
// center to close those gaps, so the spacing stays even.
import { transition, computeCurrentProgress, computeEdgeAnchors } from "../../carousel-math.js";

// How centered item i is: 1 when it is exactly centered, falling linearly
// to 0 as either neighbor reaches the center.
function computeItemProgress(currentProgress, i) {
  return Math.min(Math.max(1 - Math.abs(currentProgress - i), 0), 1);
}

// How far to shift each item toward the center. Scaling an item down pulls
// each of its edges in by half the width it loses. Each item moves by the
// width lost by every item between it and the center, plus half its own.
//
// Items are split into left and right of the center at the exact progress,
// not the nearest whole item. At a whole item that item is full size and
// loses nothing, so moving it from one side to the other changes nothing.
// Splitting at the nearest item would switch sides halfway between items,
// where both are shrunk, and the carousel would jump.
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

// Every item's centeredness, scale and shift at one progress.
export function computeGapCompensatedFrame(anchors, sizes, noncurrentScale, currentProgress) {
  const itemProgress = anchors.map((_, i) => computeItemProgress(currentProgress, i));
  const scales = itemProgress.map((p) => transition(p, noncurrentScale, 1));
  const translations = computeTranslations(anchors, sizes, scales, currentProgress);
  return { itemProgress, scales, translations };
}

// The scroll positions where the look can change direction, and what every
// item draws at each. Keyframes at these points, with linear interpolation
// between them, reproduce the look exactly.
//
// These are the positions where each item is centered. Between two of them,
// progress moves linearly with scroll, so each item's centeredness, scale,
// opacity and shift do too.
//
// They include an imaginary item beyond each end (see computeEdgeAnchors),
// so the end item keeps shrinking while overscrolled.
//
// `start` and `end` are the first and last positions, measured at the
// carousel's center.
export function computeFrameBreakpoints(anchors, sizes, noncurrentScale) {
  const n = anchors.length;
  if (n === 0) return { breakpoints: [], start: 0, end: 0 };

  const { before, after } = computeEdgeAnchors(anchors, sizes);
  const extendedAnchors = [before, ...anchors, after];

  const breakpoints = extendedAnchors.map((scrollAnchor) => {
    const currentProgress = computeCurrentProgress(extendedAnchors, scrollAnchor) - 1;
    const frame = computeGapCompensatedFrame(anchors, sizes, noncurrentScale, currentProgress);

    return { scrollAnchor, frame };
  });

  return { breakpoints, start: before, end: after };
}
