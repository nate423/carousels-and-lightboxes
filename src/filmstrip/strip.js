// This page's navigator: a filmstrip instead of dots. Unlike the scale-fade
// page's page-dots.js, this isn't a small widget bolted onto the main
// carousel's own wrapper - it's a second, independent carousel-engine
// instance (own wrapper, own effect, own scroll), kept in sync with the main
// one via shared/linked-scrolling/. It reuses the exact same scale/opacity "current item
// pops up, neighbors shrink" effect the main carousel already has, just
// tuned smaller (see .thumbnail-scrubber-strip's --noncurrent-scale in
// this page's stylesheet) - no bespoke visual code needed for the "current thumbnail is
// bigger" look.
import { createCarousel } from "../shared/carousel-engine.js";
import { scaleFadeEffect } from "../shared/effects/scale-fade-effect.js";
import { linkCarousels } from "../shared/linked-scrolling/link.js";

export function attachFilmstrip(mainCarousel, scrubberWrapper, options = {}) {
  const { thumbnailCrossSize = 32 } = options;
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
    createItem: () => {}
  });

  // The strip, while following, comes along continuously; the main carousel,
  // while following, jumps the instant the strip's current item changes.
  // Spelled out rather than left to linked-scrolling/link.js's defaults, because it
  // is a decision this page made rather than one it inherited.
  linkCarousels(mainCarousel, scrubber, {
    aWhileFollowing: "instant",
    bWhileFollowing: "continuous"
  });

  return scrubber;
}
