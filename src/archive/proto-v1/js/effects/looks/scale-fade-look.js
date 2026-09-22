// The default carousel look's per-item paint: every item scales and fades
// toward its noncurrent state the further it sits from currentProgress, with
// a translate that compensates for the gap the scaling opens up between
// neighbors (see computeTranslations in carousel-math.js). settle-effect.js
// drives this - it resolves itemProgresses (already blended by the
// carousel's contrast policy - see its own header) and currentProgress every
// scroll frame and hands them to render().
//
// css-effect.js paints the same look but does not go through this module -
// it needs a per-item @keyframes rule to place each item's peak at its own
// geometry-dependent position, which is a setup()-time animation to
// generate, not a per-frame value to write (see its own header). This
// module exists for the hand-computed path only, the way looks/ios-box-look.js
// does for its own look.
//
// restProgress: 1 - contrast blends toward every item drawn as current
// (plain, undecorated), which is this look's own undecorated state: what it
// draws is every *other* item pulled back from the item as laid out, so
// "nothing distinguished" means every item drawn as current. ios-box-look.js's
// undecorated state is the opposite end (restProgress 0) - see its own
// header for why. Which end is undecorated is a look's own business; the
// blend itself belongs to settle-effect.js.
import { computeTranslations, computeScrollAnchorForProgress, transition } from "../../carousel-math.js";

const stateByWrapper = new WeakMap();

function onItemCreated() {}

function setup(ctx) {
  const { wrapper, getGeometry, getNoncurrentScale } = ctx;
  const { items, anchors, sizes } = getGeometry();
  const noncurrentScale = getNoncurrentScale(wrapper);
  const noncurrentOpacity = parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-opacity")) || 1;

  stateByWrapper.set(wrapper, { items, anchors, sizes, noncurrentScale, noncurrentOpacity });
}

function render(ctx, { itemProgresses, currentProgress, scrollAnchor }) {
  const { wrapper, scrollAxis } = ctx;
  const { items, anchors, sizes, noncurrentScale, noncurrentOpacity } = stateByWrapper.get(wrapper);

  // Each item's real scale, already reflecting how much contrast is
  // currently showing (itemProgresses came in pre-blended) - so the
  // compensation computed from these needs no separate contrast factor of
  // its own, unlike when this multiplied a fixed noncurrent-scale baseline
  // by contrast directly.
  const scales = itemProgresses.map((p) => transition(p, noncurrentScale, 1));
  const translations = computeTranslations(anchors, sizes, scales, currentProgress);

  // Where the items' boxes actually are, against where currentProgress says
  // they should be - added, not scaled: it's not part of the look, it's what
  // makes the look land where it was asked to, and a flattened carousel
  // still has to sit in the right place. Zero whenever this carousel is
  // scrolling itself, since progress is then derived from the very position
  // being corrected against.
  const scrollError = scrollAnchor - computeScrollAnchorForProgress(anchors, currentProgress);

  items.forEach((item, i) => {
    const translation = translations[i] + scrollError;
    const translateAttribute =
      scrollAxis === "x" ? `translate3d(${translation}px, 0, 0)` : `translate3d(0, ${translation}px, 0)`;

    item.style.transform = `${translateAttribute} scale(${scales[i]})`;
    item.style.opacity = transition(itemProgresses[i], noncurrentOpacity, 1);
  });
}

// Nothing this writes (transform, opacity) changes an item's own border box,
// same reasoning as looks/ios-box-look.js.
export const scaleFadeLook = { onItemCreated, setup, render, skipItemResizeObserver: true, restProgress: 1 };
