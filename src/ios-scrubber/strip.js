// This page's navigator. The filmstrip page has the other style of the same
// idea - every item scaling continuously toward center - where this one shows fixed-size thumbnails at a constant gap, where only the
// item nearest the center grows (both its thumbnail and the padding around
// it), matching iOS Photos' scrubber.
//
// Built exactly the same way as the original: its own createCarousel
// instance - real native scroll + scroll-snap, so dragging/flicking it gets
// native momentum and snapping for free, not a custom pointer/transform
// carousel - linked to the main carousel via the same linkCarousels used
// there (defaults: this strip follows continuously, the main carousel
// follows instantly). All of the "only the centered item is bigger" visual
// logic lives in look.js, which paints it with a native
// scroll-driven animation, and this file just wires up fixed-size, non-aspect-ratio-preserving items (unlike the
// original, whose thumbnails mirror each source item's real aspect ratio),
// the sizes as CSS custom properties the effect reads, and the contrast
// policy that makes the thumbnails flatten while the strip itself is being
// dragged.
import { createCarousel } from "../shared/carousel-engine.js";
import { iosScrubberCssEffect } from "./look.js";
import { linkCarousels } from "../shared/carousel-link.js";

export function attachIosScrubber(mainCarousel, scrubberWrapper, options = {}) {
  const { itemWidth = 20, itemHeight = 30, gap = 3, expandedWidth = 30, expandedPadding = 10 } = options;
  const itemCount = mainCarousel.getItems().length;

  scrubberWrapper.style.setProperty("--wrapper-gap", gap + "px");
  scrubberWrapper.style.setProperty("--ios-item-width", itemWidth + "px");
  scrubberWrapper.style.setProperty("--ios-expanded-width", expandedWidth + "px");
  scrubberWrapper.style.setProperty("--ios-expanded-padding", expandedPadding + "px");

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
