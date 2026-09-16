// JS-driven variant: scale/opacity/blur/translate are all computed and
// written as inline styles on every scroll event, rather than delegating
// to a native CSS scroll-driven animation.
import {
  getItemMetrics,
  computeCurrentProgress,
  computeCurrentIndex,
  computeItemProgress,
  computeTranslations,
  transition
} from "../carousel-math.js";

const NONCURRENT_SCALE = 0.8;
const NONCURRENT_OPACITY = 0.5;
const NONCURRENT_BLUR = 0;

// No per-item id needed - there's no CSS @keyframes rule to target.
function onItemCreated() {}

// No animation-range to precompute - every style is derived fresh in
// apply() on each scroll event.
function setup() {}

function apply(ctx) {
  const {
    wrapper,
    scrollDistance,
    offsetLength,
    offsetFromStart,
    scrollAxis,
    getAlignmentFraction,
    getScrollPadding,
    updatePageIndicator
  } = ctx;
  const items = wrapper.querySelectorAll(".carousel-item");
  const { anchors, lengths, scrollAnchor } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetLength,
    scrollDistance,
    getAlignmentFraction(wrapper),
    getScrollPadding(wrapper)
  );

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

  const translations = computeTranslations(anchors, lengths, scales, currentProgress);

  items.forEach((item, i) => {
    const translationAttribute =
      scrollAxis === "x"
        ? `translate3d(${translations[i]}px, 0, 0)`
        : `translate3d(0, ${translations[i]}px, 0)`;

    item.style.transform = `${translationAttribute} scale(${scales[i]})`;
    item.style.opacity = opacities[i];
    item.style.filter = `blur(${blurs[i]}px)`;
  });

  updatePageIndicator(wrapper, currentIndex);
} // End apply function

export const jsEffect = { name: "js", onItemCreated, setup, apply };
