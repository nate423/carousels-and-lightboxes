// The filmstrip page: a scale-fade carousel navigated by a second carousel
// rather than by dots. The strip runs the same look tuned smaller, and each
// side drives the other through shared/carousel-link.js.
//
// The main carousel has to be populated and laid out before the strip is
// built from it - attachFilmstrip reads each item's real rendered aspect
// ratio so a thumbnail stands for the item it navigates to.
import { createCarousel } from "../shared/carousel-engine.js";
import { scaleFadeEffect } from "../shared/effects/scale-fade-effect.js";
import { attachFilmstrip } from "./strip.js";
import { createPlaceholderItem } from "./placeholder-items.js";
import { showBuildStamp } from "../dev/build-stamp.js";

document.addEventListener("DOMContentLoaded", () => {
  showBuildStamp();

  const mainCarousel = createCarousel(document.getElementById("main-carousel"), {
    itemCount: 30,
    effect: scaleFadeEffect,
    createItem: createPlaceholderItem
  });

  attachFilmstrip(mainCarousel, document.getElementById("strip"));
});
