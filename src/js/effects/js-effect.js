// JS-driven variant: scale/opacity/blur/translate are all computed and
// written as inline styles on every scroll event, rather than delegating
// to a native CSS scroll-driven animation. Item geometry only changes shape
// on setup() (init/resize/alignment change) - not on scroll - so it's cached
// here (as the prefix sums computeTranslationsAt needs, see carousel-math.js)
// and each scroll frame just re-reads the wrapper's own scroll offset and
// evaluates the translation curve directly at that point, instead of
// re-reading every item's layout and recomputing translations from scratch.
import {
  getItemMetrics,
  computeCurrentProgress,
  computeCurrentIndex,
  computeItemProgress,
  computeTranslationPrefixSums,
  computeTranslationsAt,
  wrapperAnchor,
  transition
} from "../carousel-math.js";

const NONCURRENT_SCALE = 0.8;
const NONCURRENT_OPACITY = 0.5;
const NONCURRENT_BLUR = 0;

const stateByWrapper = new WeakMap();

// No per-item id needed - there's no CSS @keyframes rule to target.
function onItemCreated() {}

// Reads item geometry once and precomputes the prefix sums
// computeTranslationsAt needs, so apply() can evaluate the translation curve
// directly at the current scroll position instead of recomputing it from
// scratch.
function setup(ctx) {
  const { wrapper, scrollDistance, offsetLength, offsetFromStart, getAlignmentFraction, getScrollPadding } = ctx;
  const items = wrapper.querySelectorAll(".carousel-item");
  const alignment = getAlignmentFraction(wrapper);
  const scrollPadding = getScrollPadding(wrapper);
  const { anchors, lengths } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetLength,
    scrollDistance,
    alignment,
    scrollPadding
  );

  const wrapperAnchorPoint = wrapperAnchor(wrapper[offsetLength], alignment, scrollPadding);
  const { baseDiff, prefix } = computeTranslationPrefixSums(lengths, NONCURRENT_SCALE);

  stateByWrapper.set(wrapper, { items, anchors, wrapperAnchorPoint, baseDiff, prefix });
}

function apply(ctx) {
  const { wrapper, scrollDistance, scrollAxis, onProgress } = ctx;
  const { items, anchors, wrapperAnchorPoint, baseDiff, prefix } = stateByWrapper.get(wrapper);
  const scrollAnchor = wrapper[scrollDistance] + wrapperAnchorPoint;

  const currentProgress = computeCurrentProgress(anchors, scrollAnchor);
  const currentIndex = computeCurrentIndex(currentProgress, items.length);

  const scales = [];
  const opacities = [];
  const blurs = [];

  items.forEach((_, i) => {
    const itemProgress = computeItemProgress(currentProgress, i);
    scales.push(transition(itemProgress, NONCURRENT_SCALE, 1));
    opacities.push(transition(itemProgress, NONCURRENT_OPACITY, 1));
    blurs.push(transition(itemProgress, NONCURRENT_BLUR, 0));
  });

  const translations = computeTranslationsAt(prefix, baseDiff, currentProgress);

  items.forEach((item, i) => {
    const translationAttribute =
      scrollAxis === "x"
        ? `translate3d(${translations[i]}px, 0, 0)`
        : `translate3d(0, ${translations[i]}px, 0)`;

    item.style.transform = `${translationAttribute} scale(${scales[i]})`;
    item.style.opacity = opacities[i];
    item.style.filter = `blur(${blurs[i]}px)`;
  });

  onProgress?.(currentIndex, currentProgress);
} // End apply function

export const jsEffect = { name: "js", onItemCreated, setup, apply };
