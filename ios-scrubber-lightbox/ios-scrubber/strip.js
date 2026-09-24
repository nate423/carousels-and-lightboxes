// This page's navigator. The filmstrip page has the other style of the
// same idea - every item scaling continuously toward center - where this
// one shows fixed-size thumbnails at a constant gap, and only the item
// nearest the center grows (both its thumbnail and the padding around
// it), matching iOS Photos' scrubber.
//
// Built the same way as the original: its own createCarousel instance -
// real native scroll + scroll-snap, so dragging/flicking gets native
// momentum and snapping for free, not a custom pointer/transform carousel
// - linked to the main carousel via the same linkCarousels used
// elsewhere (defaults: this strip follows continuously, the main
// carousel follows instantly). All of the "only the centered item is
// bigger" visual logic lives in shared/effects/expand.js; this file just
// wires up fixed-size, non-aspect-ratio-preserving items (unlike the
// original, whose thumbnails mirror each source item's real aspect
// ratio).
//
// The strip's dimensions (--expand-item-width/-height/-width-grown,
// --expand-grown-padding, --wrapper-gap) are declared in ios-scrubber.css,
// not here - .expand-effect-item/.expand-effect-thumb size themselves
// directly off those, so there's no itemSizing to pass and no inline
// width/height for this file to compute or keep in sync.
import { createCarousel } from "../shared/carousel-engine.js";
import { expandEffect } from "../shared/effects/expand.js";
import { linkCarousels } from "../shared/linked-scrolling/link.js";

export function attachIosScrubber(mainCarousel, scrubberWrapper, { followOnTimeline } = {}) {
  const itemCount = mainCarousel.getItems().length;

  const scrubber = createCarousel(scrubberWrapper, {
    itemCount,
    effect: expandEffect(),
    // The thumb the look paints is added in onItemCreated; there is no
    // per-item content beyond it, and the engine's default would fill each
    // item with its own index as text.
    createItem: () => {},
    followOnTimeline
  });

  // Each comes along continuously while following the other.
  linkCarousels(mainCarousel, scrubber, {
    aWhileFollowing: "continuous",
    bWhileFollowing: "continuous"
  });

  return scrubber;
}
