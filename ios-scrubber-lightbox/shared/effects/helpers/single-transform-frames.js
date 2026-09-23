// Exact motion curves for one transform animation on one scroll timeline.
import { computeAnimationRanges } from "../../carousel-math.js";
import { computeTranslationBreakpoints } from "./gap-compensation.js";

// Include both the translate knots and the original view-timeline scale
// boundaries. The latter can be clamped by cover, so using item anchors
// alone would subtly change the existing appearance for unequal widths.
export function singleTransformFrames(anchors, sizes, width, noncurrentScale, noncurrentOpacity) {
  const ranges = computeAnimationRanges(anchors, sizes, width);
  const { breakpoints, start, end } = computeTranslationBreakpoints(anchors, sizes, noncurrentScale);
  if (!anchors.length) return { start, end, frames: [] };
  const frames = anchors.map((anchor, i) => {
    const low = anchor + (ranges[i].start - 0.5) * (width + sizes[i]);
    const high = anchor + (ranges[i].end - 0.5) * (width + sizes[i]);
    const knots = [...new Set([start, end, low, anchor, high, ...breakpoints.map((bp) => bp.scrollAnchor)])]
      .filter((value) => value >= start && value <= end).sort((a, b) => a - b);
    return knots.map((position) => {
      let segment = 0;
      while (segment < breakpoints.length - 2 && breakpoints[segment + 1].scrollAnchor < position) segment++;
      const a = breakpoints[segment];
      const b = breakpoints[segment + 1];
      const t = (position - a.scrollAnchor) / (b.scrollAnchor - a.scrollAnchor);
      const translate = a.translations[i] + t * (b.translations[i] - a.translations[i]);
      const progress = Math.max(0, Math.min(1, position <= anchor
        ? (position - low) / (anchor - low)
        : (high - position) / (high - anchor)));
      return {
        percent: 100 * (position - start) / (end - start),
        translate,
        scale: noncurrentScale + progress * (1 - noncurrentScale),
        opacity: noncurrentOpacity + progress * (1 - noncurrentOpacity)
      };
    });
  });
  return { start, end, frames };
}

