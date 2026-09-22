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
// there (defaults: this strip follows continuously, the main carousel
// follows instantly). All of the "only the centered item is bigger" visual
// logic lives in ios-scrubber-css-effect.js, which paints it with a native
// scroll-driven animation, and this file just wires up fixed-size, non-aspect-ratio-preserving items (unlike the
// original, whose thumbnails mirror each source item's real aspect ratio),
// the sizes as CSS custom properties the effect reads, and the contrast
// policy that makes the thumbnails flatten while the strip itself is being
// dragged.
import { createCarousel } from "../carousel-engine.js";
import { iosScrubberCssEffect } from "../effects/ios-scrubber-css-effect.js";
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
  // there) - this style's "current item" look is entirely width and
  // displacement, and owns its own rendering either way.
  //
  // True for both implementations of it, including the natively painted
  // one: that opts out of the generic scaffolding for the same reason, and
  // declares the wrapper-level timeline it does want under its own class
  // rather than taking the one those rules would give it.
  scrubberWrapper.dataset.scrollTimelines = "off";

  const scrubber = createCarousel(scrubberWrapper, {
    itemCount,
    effect: iosScrubberCssEffect(),
    // This style's defining behavior: the thumbnails flatten out while you
    // are dragging the strip itself, and whichever one you come to rest on
    // grows. While it is merely following the main carousel it keeps its
    // contrast and tracks along expanded.
    removeContrastWhileScrolling: "leading",
    itemSizing: {
      crossSize: itemHeight,
      // One ratio for the whole strip, rather than each thumbnail keeping
      // its own - this style's thumbnails are deliberately uniform, and only
      // the centered one departs from that, as overflow rather than as a
      // bigger box.
      size: { aspect: itemWidth / itemHeight }
    },
    // The thumb the look paints is added in onItemCreated; there is no
    // per-item content beyond it, and the engine's default would fill each
    // item with its own index as text.
    createItem: () => {}
  });

  const link = linkCarousels(mainCarousel, scrubber);

  return { scrubber, link };
}
