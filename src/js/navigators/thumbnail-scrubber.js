// The other of two interchangeable navigator UIs for a carousel (see
// page-controls.js) - an iOS-Photos-style filmstrip instead of dots. Unlike
// page-controls, this isn't a small widget bolted onto the main carousel's
// own wrapper - it's a second, independent carousel-engine instance (own
// wrapper, own effect, own scroll), kept in sync with the main one via
// carousel-link.js. It reuses the exact same scale/opacity "current item
// pops up, neighbors shrink" effect the main carousel already has, just
// tuned smaller (see .thumbnail-scrubber-strip's --noncurrent-scale in
// main.css) - no bespoke visual code needed for the "current thumbnail is
// bigger" look.
//
// Defaults to cssEffect - not origin-effect, since thumbnails keep the main
// carousel's real per-item aspect ratio rather than a uniform size, and
// origin-effect only produces even gaps when every item is the same length
// (see its file header) - but takes the effect as an option rather than
// importing it directly, so a caller can swap in jsEffect wholesale on
// browsers without native scroll-driven-animation support (see main.js).
import { createCarousel } from "../carousel-engine.js";
import { cssEffect } from "../effects/css-effect.js";
import { linkCarousels } from "../carousel-link.js";

export function attachThumbnailScrubber(mainCarousel, scrubberWrapper, options = {}) {
  const { thumbnailHeight = 32, effect = cssEffect } = options;
  const sourceItems = mainCarousel.getItems();

  function createItem(item, index) {
    const sourceItem = sourceItems[index];
    const aspect = sourceItem.offsetWidth / sourceItem.offsetHeight || 1;
    item.style.height = thumbnailHeight + "px";
    item.style.width = Math.round(thumbnailHeight * aspect) + "px";
  }

  const scrubber = createCarousel(scrubberWrapper, {
    itemCount: sourceItems.length,
    effect,
    createItem
  });

  // Defaults match carousel-link.js: scrolling the main item tracks the
  // strip continuously, scrubbing the strip jumps the main item over the
  // instant its current item changes. `link` is returned alongside the
  // scrubber so a caller can flip either direction's mode live (e.g. from a
  // debug control).
  const link = linkCarousels(mainCarousel, scrubber);

  return { scrubber, link };
}
