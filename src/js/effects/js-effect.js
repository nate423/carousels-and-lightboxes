// JS-driven variant: scale/opacity/blur/translate are all computed and
// written as inline styles on every scroll event, rather than delegating
// to a native CSS scroll-driven animation. It honours the same contrast
// policy the CSS variants do, by scaling the same itemProgress everything
// else is derived from - see apply(). Item geometry only changes shape
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
  const { wrapper, scrollDistance, offsetSize, offsetFromStart, getAlignmentFraction, getScrollPadding } = ctx;
  const items = wrapper.querySelectorAll(".carousel-item");
  const alignment = getAlignmentFraction(wrapper);
  const scrollPadding = getScrollPadding(wrapper);
  const { anchors, sizes } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetSize,
    scrollDistance,
    alignment,
    scrollPadding
  );

  const wrapperAnchorPoint = wrapperAnchor(wrapper[offsetSize], alignment, scrollPadding);
  const { baseDiff, prefix } = computeTranslationPrefixSums(sizes, NONCURRENT_SCALE);

  stateByWrapper.set(wrapper, { items, anchors, wrapperAnchorPoint, baseDiff, prefix });
}

function apply(ctx) {
  const { wrapper, scrollDistance, scrollAxis, onProgress } = ctx;
  const { items, anchors, wrapperAnchorPoint, baseDiff, prefix } = stateByWrapper.get(wrapper);
  const scrollAnchor = wrapper[scrollDistance] + wrapperAnchorPoint;

  const currentProgress = computeCurrentProgress(anchors, scrollAnchor);
  const currentIndex = computeCurrentIndex(currentProgress, items.length);

  // How much of the look to draw at all, from the carousel's contrast
  // policy - see the contrast block in carousel-engine.js. Read straight
  // off the attribute, so this steps between the two states rather than
  // easing across them the way the CSS variants do: their easing is a
  // transition on --contrast-amount, and nothing here re-renders while one
  // would be running, since a transition at rest produces no scroll frames.
  const contrast = wrapper.dataset.contrast === "off" ? 0 : 1;

  const scales = [];
  const opacities = [];
  const blurs = [];

  items.forEach((_, i) => {
    // Contrast interpolates from this look's neutral state to its full
    // strength, and for this look neutral is itemProgress 1: what it draws
    // is every *other* item pulled back from the item as laid out, so
    // "nothing distinguished" means every item drawn as current. (The iOS
    // filmstrip's neutral is the opposite end - there the current item is
    // the one that departs from the layout - which is why settle-effect.js
    // scales the same value the other way. Where neutral sits is the
    // look's own business; only that contrast blends toward it is shared.)
    const rawProgress = computeItemProgress(currentProgress, i);
    const itemProgress = 1 - (1 - rawProgress) * contrast;
    scales.push(transition(itemProgress, NONCURRENT_SCALE, 1));
    opacities.push(transition(itemProgress, NONCURRENT_OPACITY, 1));
    blurs.push(transition(itemProgress, NONCURRENT_BLUR, 0));
  });

  // Scaled by contrast for the same reason and by the same exact factor:
  // the gap these compensate for is opened by the scaling, and
  // translations are linear in each item's scale delta, so scaling every
  // delta scales every translation with it.
  const translations = computeTranslationsAt(prefix, baseDiff, currentProgress);

  items.forEach((item, i) => {
    const translation = translations[i] * contrast;
    const translationAttribute =
      scrollAxis === "x" ? `translate3d(${translation}px, 0, 0)` : `translate3d(0, ${translation}px, 0)`;

    item.style.transform = `${translationAttribute} scale(${scales[i]})`;
    item.style.opacity = opacities[i];
    item.style.filter = `blur(${blurs[i]}px)`;
  });

  onProgress?.(currentIndex, currentProgress);
} // End apply function

export const jsEffect = { name: "js", onItemCreated, setup, apply };
