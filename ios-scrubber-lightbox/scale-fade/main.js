// The scale-fade carousel: one horizontally scrolling carousel whose current
// item is drawn at full size and opacity while its neighbours fall away, with
// a row of dots below it as the navigator.
//
// Self-contained apart from shared/: no effect registry, no link machinery,
// and nothing here reads an option the page does not set.
import { createCarousel } from "../shared/carousel-engine.js";
import { scaleFadeEffect } from "../shared/effects/scale-fade.js";
import { attachPageDots } from "./page-dots.js";
import { createPlaceholderItem } from "./placeholder-items.js";
import { showBuildStamp } from "../dev/build-stamp.js";
import { applyEdgeExperiment } from "../dev/edge-experiment.js";

document.addEventListener("DOMContentLoaded", () => {
  showBuildStamp();
  applyEdgeExperiment();

  const carousel = createCarousel(document.getElementById("carousel"), {
    itemCount: 30,
    effect: scaleFadeEffect,
    createItem: createPlaceholderItem
  });

  attachPageDots(carousel, document.querySelector(".page-controls"));
});
