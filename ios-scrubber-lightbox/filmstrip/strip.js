// This page's navigator: a filmstrip instead of dots. Unlike the
// scale-fade page's page-dots.js, this isn't a small widget bolted onto
// the main carousel's own wrapper - it's a second, independent
// carousel-engine instance (own wrapper, own effect, own scroll), kept
// in sync with the main one via shared/linked-scrolling/. It reuses the
// exact same scale/opacity "current item pops up, neighbours shrink"
// effect the main carousel already has, just tuned smaller (see
// .thumbnail-scrubber-strip's --noncurrent-scale in this page's
// stylesheet) - no bespoke visual code needed for the "current thumbnail
// is bigger" look.
import { createCarousel } from "../shared/carousel-engine.js";
import { scaleFadeEffect } from "../shared/effects/scale-fade.js";
import { linkCarousels } from "../shared/linked-scrolling/link.js";

export function attachFilmstrip(mainCarousel, scrubberWrapper, { followOnTimeline } = {}) {
  const thumbnailCrossSize = parseFloat(
    getComputedStyle(scrubberWrapper).getPropertyValue("--filmstrip-item-height")
  );
  const sourceItems = mainCarousel.getItems();

  const scrubber = createCarousel(scrubberWrapper, {
    itemCount: sourceItems.length,
    effect: scaleFadeEffect,
    itemSizing: {
      crossSize: thumbnailCrossSize,
      // Each thumbnail keeps the ratio of the item it stands for, so a strip
      // of them reads as the main carousel in miniature. Measured off the
      // rendered item, which is why the main carousel has to be populated
      // and laid out before this runs.
      size: {
        origin: (index) => sourceItems[index].offsetWidth / sourceItems[index].offsetHeight || 1
      }
    },
    // Thumbnails are empty boxes - the look is all the content there is.
    // Passed explicitly because the engine's default fills an item with its
    // own index as text.
    createItem: () => {},
    followOnTimeline
  });

  // Each comes along continuously while following the other. Spelled out
  // rather than left to linked-scrolling/link.js's defaults, because it is a
  // decision this page made rather than one it inherited.
  linkCarousels(mainCarousel, scrubber, {
    aWhileFollowing: "continuous",
    bWhileFollowing: "continuous"
  });

  return scrubber;
}
