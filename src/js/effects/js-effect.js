// JS-driven variant: paints the scale+fade look (see
// looks/scale-fade-look.js) by computing progress and contrast on every
// scroll frame and handing them to the look, rather than delegating to a
// native CSS scroll-driven animation the way css-effect.js does.
import {
  computeCurrentProgress,
  computeCurrentIndex,
  computeScrollAnchorForProgress
} from "../carousel-math.js";
import { scaleFadeLook } from "./looks/scale-fade-look.js";

// No per-item id needed - there's no CSS @keyframes rule to target.
function onItemCreated() {}

function setup(ctx) {
  scaleFadeLook.setup(ctx);
}

function apply(ctx) {
  const { wrapper, getGeometry, currentScrollAnchor, getScrollSource, getDrivenProgress, onProgress } = ctx;
  const { items, anchors } = getGeometry();
  const scrollAnchor = currentScrollAnchor();

  // While another carousel is driving this one, its progress is the exact
  // one and the scroll position written from it is quantised, so measuring
  // that position back gives a coarser answer than went in - by enough,
  // when the driver is much the longer scroller, to make this carousel step
  // rather than glide. The scroll position is still what to measure on a
  // real gesture, where it is what the finger moved.
  const isDriven = getScrollSource() === "driven";
  const currentProgress = isDriven ? getDrivenProgress() : computeCurrentProgress(anchors, scrollAnchor);
  const currentIndex = computeCurrentIndex(currentProgress, items.length);

  // Having taken progress from the driver, the items' boxes are left where
  // the quantised scroll position put them, a fraction of a pixel from
  // where that progress belongs. This is that difference, which the look
  // adds back into every item's translate so each one lands where it was
  // actually asked for. Zero while this carousel scrolls itself, since
  // progress is then derived from the very position being corrected against.
  const scrollError = isDriven ? scrollAnchor - computeScrollAnchorForProgress(anchors, currentProgress) : 0;

  // How much of the look to draw at all, from the carousel's contrast
  // policy - see the contrast block in carousel-engine.js. Read straight off
  // the attribute, so this steps between the two states rather than easing
  // across them the way the CSS variant does: its easing is a transition on
  // --contrast-amount, and nothing here re-renders while one would be
  // running, since a transition at rest produces no scroll frames.
  const contrast = wrapper.dataset.contrast === "off" ? 0 : 1;

  scaleFadeLook.render(ctx, { currentProgress, contrast, scrollError });

  onProgress?.(currentIndex, currentProgress);
}

export const jsEffect = { name: "js", onItemCreated, setup, apply };
