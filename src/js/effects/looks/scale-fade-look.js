// The default carousel look's per-item paint: every item scales and fades
// toward its noncurrent state the further it sits from currentProgress (see
// computeItemProgress in carousel-math.js), with a translate that
// compensates for the gap the scaling opens up between neighbors (see
// computeTranslationsAt). js-effect.js drives this by computing progress and
// contrast on every scroll frame and handing them to render().
//
// css-effect.js paints the same look but does not go through this module -
// it needs a per-item @keyframes rule to place each item's peak at its own
// geometry-dependent position, which is a setup()-time animation to
// generate, not a per-frame value to write (see its own header). This
// module exists for the hand-computed path only, the way looks/ios-box-look.js
// exists for settle-effect.js.
//
// Neutral (nothing distinguished) is itemProgress 1 here - every item drawn
// as current - the opposite of ios-box-look.js's neutral 0. That's why the
// blend below runs in the direction it does; see settle-effect.js for the
// other end of this split. Which direction to blend is this look's own
// business, so it's done here rather than by whatever calls render() -
// contrast itself is passed in already, since deciding whether contrast
// applies at all belongs to the effect, not the look.
import { computeItemProgress, computeTranslationPrefixSums, computeTranslationsAt, transition } from "../../carousel-math.js";

const stateByWrapper = new WeakMap();

function onItemCreated() {}

function setup(ctx) {
  const { wrapper, getGeometry, getNoncurrentScale } = ctx;
  const { items, sizes } = getGeometry();
  const noncurrentScale = getNoncurrentScale(wrapper);
  const noncurrentOpacity = parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-opacity")) || 1;
  const { baseDiff, prefix } = computeTranslationPrefixSums(sizes, noncurrentScale);

  stateByWrapper.set(wrapper, { items, noncurrentScale, noncurrentOpacity, baseDiff, prefix });
}

function render(ctx, { currentProgress, contrast, scrollError }) {
  const { wrapper, scrollAxis } = ctx;
  const { items, noncurrentScale, noncurrentOpacity, baseDiff, prefix } = stateByWrapper.get(wrapper);
  const translations = computeTranslationsAt(prefix, baseDiff, currentProgress);

  items.forEach((item, i) => {
    const rawProgress = computeItemProgress(currentProgress, i);
    const itemProgress = 1 - (1 - rawProgress) * contrast;

    // Scaled by contrast for the same reason and by the same exact factor as
    // the scale itself: the gap this compensates for is opened by the
    // scaling, and translation is linear in each item's scale delta. The
    // correction is added after, unscaled: it's not part of the look, it's
    // what makes the look land where it was asked to, and a flattened
    // carousel still has to sit in the right place.
    const translation = translations[i] * contrast + scrollError;
    const translateAttribute =
      scrollAxis === "x" ? `translate3d(${translation}px, 0, 0)` : `translate3d(0, ${translation}px, 0)`;

    item.style.transform = `${translateAttribute} scale(${transition(itemProgress, noncurrentScale, 1)})`;
    item.style.opacity = transition(itemProgress, noncurrentOpacity, 1);
  });
}

export const scaleFadeLook = { onItemCreated, setup, render };
