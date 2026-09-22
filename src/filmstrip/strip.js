// This page's navigator: a filmstrip instead of dots. Unlike the scale-fade
// page's page-dots.js, this isn't a small widget bolted onto the main
// carousel's own wrapper - it's a second, independent carousel-engine
// instance (own wrapper, own effect, own scroll), kept in sync with the main
// one via shared/carousel-link.js. It reuses the exact same scale/opacity "current item
// pops up, neighbors shrink" effect the main carousel already has, just
// tuned smaller (see .thumbnail-scrubber-strip's --noncurrent-scale in
// this page's stylesheet) - no bespoke visual code needed for the "current thumbnail is
// bigger" look.
import { createCarousel } from "../shared/carousel-engine.js";
import { scaleFadeEffect } from "../shared/effects/scale-fade-effect.js";
import { linkCarousels } from "../shared/carousel-link.js";

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

  // Defaults match carousel-link.js: the strip, while following, comes along
  // continuously, and the main carousel, while following, jumps the instant
  // the strip's current item changes. `link` is returned alongside the
  // scrubber so a caller can change either carousel's response live (e.g.
  // from a debug control).
  const link = linkCarousels(mainCarousel, scrubber);

  return { scrubber, link };
}
