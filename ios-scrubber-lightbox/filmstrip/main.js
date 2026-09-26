// The filmstrip page: a scale-fade carousel navigated by a second carousel
// rather than by dots. The strip runs the same effect tuned smaller, and each
// side drives the other through shared/linked-scrolling/.
//
// The main carousel has to be populated and laid out before the strip is
// built from it - attachFilmstrip reads each item's real rendered aspect
// ratio so a thumbnail stands for the item it navigates to.
import { createCarousel } from "../shared/carousel-engine.js";
import { scaleFadeEffect } from "../shared/effects/scale-fade.js";
import { attachFilmstrip } from "./strip.js";
import { createPlaceholderItem } from "./placeholder-items.js";
import { showBuildStamp } from "../dev/build-stamp.js";

// ?follow=direct follows by writing scroll positions rather than on the
// leader's timeline - the "before" side of compare/.
const followOnTimeline = new URLSearchParams(location.search).get("follow") !== "direct";

document.addEventListener("DOMContentLoaded", () => {
  showBuildStamp();

  const mainCarousel = createCarousel(document.getElementById("main-carousel"), {
    itemCount: 30,
    effect: scaleFadeEffect,
    createItem: createPlaceholderItem,
    followOnTimeline
  });

  attachFilmstrip(mainCarousel, document.getElementById("strip"), { followOnTimeline });
});
