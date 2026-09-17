// The other of two filmstrip-navigator *styles* (see thumbnail-scrubber.js
// for the original "every item scales continuously toward center" look) -
// this one shows fixed-size thumbnails at a constant gap, where only the
// item nearest the center grows (both its thumbnail and the padding around
// it), matching iOS Photos' scrubber.
//
// Built exactly the same way as the original: its own createCarousel
// instance - real native scroll + scroll-snap, so dragging/flicking it gets
// native momentum and snapping for free, not a custom pointer/transform
// carousel - linked to the main carousel via the same linkCarousels used
// there (default modes: continuous main->strip, instant strip->main). All
// of the "only the centered item is bigger" visual logic lives in
// ios-scrubber-effect.js; this file just wires up fixed-size, non-aspect-
// ratio-preserving items (unlike the original, whose thumbnails mirror each
// source item's real aspect ratio) and the sizes as CSS custom properties
// the effect reads.
import { createCarousel } from "../carousel-engine.js";
import { iosScrubberEffect } from "../effects/ios-scrubber-effect.js";
import { linkCarousels } from "../carousel-link.js";

export function attachIosThumbnailScrubber(mainCarousel, scrubberWrapper, options = {}) {
  const { itemWidth = 20, itemHeight = 30, gap = 3, expandedWidth = 30, expandedPadding = 10 } = options;
  const itemCount = mainCarousel.getItems().length;

  scrubberWrapper.style.setProperty("--wrapper-gap", gap + "px");
  scrubberWrapper.style.setProperty("--ios-item-width", itemWidth + "px");
  scrubberWrapper.style.setProperty("--ios-expanded-width", expandedWidth + "px");
  scrubberWrapper.style.setProperty("--ios-expanded-padding", expandedPadding + "px");

  // Opts this wrapper out of the native scroll-driven item-current
  // scale/opacity animation main.css otherwise applies to every
  // .carousel-item (see the `:not([data-scroll-timelines="off"])` rules
  // there) - this style's "current item" look is entirely padding/width,
  // driven by ios-scrubber-effect.js instead. Note this says nothing about
  // which effect module runs here; that's data-effect, and this wrapper
  // isn't configured through it at all (the navigator passes
  // iosScrubberEffect to createCarousel directly).
  scrubberWrapper.dataset.scrollTimelines = "off";

  function createItem(item, index) {
    item.style.height = itemHeight + "px";

    // The engine sizes this wrapper's edge spacers (updateSpacers, called
    // once populateItems finishes creating every item) from whatever size
    // each item already has *right now* - before ios-scrubber-effect.js
    // ever runs a frame. If every item starts at its plain collapsed size
    // and the effect only expands index 0 (the initial "current" item)
    // afterward, on its first apply() call, the spacer ends up sized for
    // the collapsed width it measured, while item 0 is actually wider -
    // scrollLeft 0 then no longer lines up with progress 0 (off by
    // roughly half the expand amount), which reads as a dead zone right at
    // the start of the strip where scrolling doesn't move progress at all.
    // Pre-expanding index 0 here, before updateSpacers runs, means it
    // measures the *real* initial width and the two stay in sync from the
    // very first frame.
    if (index === 0) {
      item.style.paddingInline = expandedPadding + "px";
      item.firstElementChild.style.width = expandedWidth + "px";
    }
  }

  const scrubber = createCarousel(scrubberWrapper, {
    itemCount,
    effect: iosScrubberEffect,
    createItem
  });

  const link = linkCarousels(mainCarousel, scrubber);

  return { scrubber, link };
}
