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
// logic lives in shared/effects/expand-effect.js, which paints it with a
// native scroll-driven animation, and this file just wires up fixed-size, non-aspect-ratio-preserving items (unlike the
// original, whose thumbnails mirror each source item's real aspect ratio),
// the sizes as CSS custom properties the effect reads, and the contrast
// policy that makes the thumbnails flatten while the strip itself is being
// dragged.
import { createCarousel } from "../shared/carousel-engine.js";
import { expandEffect } from "../shared/effects/expand-effect.js";
import { linkCarousels } from "../shared/linked-scrolling/link.js";

export function attachIosScrubber(mainCarousel, scrubberWrapper, options = {}) {
  const { itemWidth = 24, itemHeight = 36, gap = 3, expandedWidth = 36, expandedPadding = 12 } = options;
  const itemCount = mainCarousel.getItems().length;

  scrubberWrapper.style.setProperty("--wrapper-gap", gap + "px");
  scrubberWrapper.style.setProperty("--expand-item-width", itemWidth + "px");
  scrubberWrapper.style.setProperty("--expand-grown-width", expandedWidth + "px");
  scrubberWrapper.style.setProperty("--expand-grown-padding", expandedPadding + "px");

  const scrubber = createCarousel(scrubberWrapper, {
    itemCount,
    effect: expandEffect(),
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

  // This style's defining behavior: the thumbnails flatten out while you are
  // dragging the strip itself, and whichever one you come to rest on grows.
  // While it is merely following the main carousel it keeps its contrast and
  // tracks along expanded, so "leading" and not any other motion state.
  //
  // The look reads data-contrast from CSS (see --contrast-amount in this
  // page's stylesheet, and the transition on it that turns this step change
  // into motion), so nothing here has to re-render anything.
  scrubber.onMotionChange((state) => {
    scrubberWrapper.dataset.contrast = state === "leading" ? "off" : "on";
  });

  linkCarousels(mainCarousel, scrubber, {
    aWhileFollowing: "instant",
    bWhileFollowing: "continuous"
  });

  return scrubber;
}
