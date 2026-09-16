// JS-driven variant: scale/opacity/blur/translate are all computed and
// written as inline styles on every scroll event, rather than delegating
// to a native CSS scroll-driven animation. Item geometry and the exact
// gap-compensating translation curve (see computeTranslationBreakpoints in
// carousel-math.js) only change shape on setup() (init/resize/alignment
// change) - not on scroll - so both are cached here and each scroll frame
// just re-reads the wrapper's own scroll offset and interpolates against
// that cache, instead of re-reading every item's layout and recomputing
// translations from scratch.
import {
  getItemMetrics,
  computeCurrentProgress,
  computeCurrentIndex,
  computeItemProgress,
  computeTranslationBreakpoints,
  interpolateTranslations,
  wrapperAnchor,
  transition
} from "../carousel-math.js";

const NONCURRENT_SCALE = 0.8;
const NONCURRENT_OPACITY = 0.5;
const NONCURRENT_BLUR = 0;

const stateByWrapper = new WeakMap();

// No per-item id needed - there's no CSS @keyframes rule to target.
function onItemCreated() {}

// Mirrors css-effect.js's setup(): reads item geometry once and precomputes
// the same exact translation breakpoints a native scroll-timeline would be
// driven off of, so apply() can interpolate instead of recomputing.
function setup(ctx) {
  const {
    wrapper,
    scrollDistance,
    scrollSize,
    offsetLength,
    offsetFromStart,
    getAlignmentFraction,
    getScrollPadding
  } = ctx;
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
  const maxScroll = wrapper[scrollSize] - wrapper[offsetLength];

  const breakpoints = computeTranslationBreakpoints(
    anchors,
    lengths,
    NONCURRENT_SCALE,
    wrapperAnchorPoint,
    wrapperAnchorPoint + Math.max(maxScroll, 0)
  );

  stateByWrapper.set(wrapper, { items, anchors, wrapperAnchorPoint, breakpoints });
}

function apply(ctx) {
  const { wrapper, scrollDistance, scrollAxis, updatePageIndicator } = ctx;
  const { items, anchors, wrapperAnchorPoint, breakpoints } = stateByWrapper.get(wrapper);
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

  const translations = interpolateTranslations(breakpoints, scrollAnchor);

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
