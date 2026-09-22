// The iOS scrubber page: a carousel navigated by a strip of fixed-size
// thumbnails where only the one nearest the centre expands, matching iOS
// Photos. The strip is a real carousel of its own - native scroll, native
// snap - linked to the main one through shared/linked-scrolling/.
//
// The main carousel has to exist before the strip is built from it, which is
// where the strip gets its item count.
import { createCarousel } from "../shared/carousel-engine.js";
import { scaleFadeEffect } from "../shared/effects/scale-fade-effect.js";
import { attachIosScrubber } from "./strip.js";
import { createPlaceholderItem } from "./placeholder-items.js";
import { showBuildStamp } from "../dev/build-stamp.js";
import { attachScrollEventProbe } from "../dev/scroll-event-probe.js";
import { watchScrubberJitter } from "../dev/debug-console.js";

document.addEventListener("DOMContentLoaded", () => {
  showBuildStamp();

  const mainCarousel = createCarousel(document.getElementById("main-carousel"), {
    itemCount: 30,
    effect: scaleFadeEffect,
    createItem: createPlaceholderItem
  });

  const scrubber = attachIosScrubber(mainCarousel, document.getElementById("strip"));

  // Both off by default; see their own files.
  attachScrollEventProbe(scrubber, "iOS thumbnail strip (not the main carousel)");
  watchScrubberJitter(mainCarousel, scrubber);
});
