import { createCarousel } from "./carousel-engine.js";
import { attachPageControls } from "./navigators/page-controls.js";
import { attachThumbnailScrubber } from "./navigators/thumbnail-scrubber.js";
import { cssEffect } from "./effects/css-effect.js";
import { jsEffect } from "./effects/js-effect.js";
import { originEffect } from "./effects/origin-effect.js";

// Which variant a wrapper uses is just a data attribute - each effect
// module implements the same { onItemCreated, setup, apply } shape, so
// carousel-engine.js is variant-agnostic and works with any of them.
const EFFECTS = { css: cssEffect, js: jsEffect, origin: originEffect };

function getEffect(wrapper) {
  return EFFECTS[wrapper.dataset.effect] || cssEffect;
}

// The thumbnail scrubber (unlike the side-by-side comparison demos above,
// which are supposed to show each variant as-is, polyfilled or not) is meant
// to just work, so it skips the polyfill entirely: css-effect.js needs real
// native support for animation-timeline/view-timeline/scroll-timeline, and
// there's no reliably polyfilling that (see git history), so browsers
// without it get the JS variant instead - it computes the same
// scale/opacity/translate itself on scroll rather than delegating to a
// native scroll-driven animation. Tagging the wrapper with
// data-effect="js" (not just returning jsEffect) also keeps it correctly
// excluded from the animation-timeline/scroll-timeline rules in main.css,
// which key off that same attribute.
//
// Reads index.html's pre-recorded answer rather than calling
// CSS.supports("animation-timeline: --works") again here - the polyfill,
// once loaded, patches CSS.supports to always report that as supported (see
// index.html), so a fresh call made from here, after it's had a chance to
// load, would always say "yes" whether or not it actually is.
const supportsScrollDrivenAnimations = window.__supportsScrollDrivenAnimations ?? CSS.supports("animation-timeline: --works");

function getScrubberEffect(wrapper) {
  if (!supportsScrollDrivenAnimations) {
    wrapper.dataset.effect = "js";
    return jsEffect;
  }
  return cssEffect;
}

function randomDimension(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min) + "px";
}

// Demo-page-specific item content (random/uniform placeholder boxes, or a
// placeholder image) - this is exactly the kind of thing carousel-engine.js
// used to know about and no longer does; it just takes a createItem
// callback.
function createPlaceholderItem(wrapper) {
  return function (item, i) {
    if (wrapper.classList.contains("placeholder-images")) {
      const img = document.createElement("img");
      img.src = `https://source.unsplash.com/random?sig=${i}`;
      item.appendChild(img);
      item.style.width = "auto";
      item.style.height = "100%";
      return;
    }

    const uniform = wrapper.classList.contains("uniform-size");
    const itemWidth = uniform ? "100px" : randomDimension(50, 300); /* min <> max width */
    const itemHeight = uniform ? "100px" : randomDimension(50, 300); /* min <> max height */
    item.textContent = `Item ${i} (${itemWidth} × ${itemHeight})`;
    item.style.width = itemWidth;
    item.style.height = itemHeight;
  };
}

document.addEventListener("DOMContentLoaded", function () {
  const carousels = [];

  // The thumbnail-scrubber demo's pair of wrappers (main + filmstrip) are
  // built explicitly below, in order, since the strip needs its source
  // carousel already populated first - excluded here so this generic loop
  // doesn't also set them up as independent top-level carousels.
  document
    .querySelectorAll(".carousel-wrapper:not(.thumbnail-scrubber-main):not(.thumbnail-scrubber-strip)")
    .forEach((wrapper) => {
      if (
        !wrapper.classList.contains("placeholder-boxes") &&
        !wrapper.classList.contains("placeholder-images")
      ) {
        wrapper.classList.add("placeholder-boxes");
      }

      const carousel = createCarousel(wrapper, {
        itemCount: 30,
        effect: getEffect(wrapper),
        createItem: createPlaceholderItem(wrapper)
      });
      carousels.push(carousel);

      const controlsContainer = wrapper.closest(".carousel-with-controls")?.querySelector(".page-controls");
      if (controlsContainer) {
        attachPageControls(carousel, controlsContainer);
      }
    });

  // Thumbnail-scrubber demo: a plain main carousel, paired with a second
  // carousel-wrapper acting as the filmstrip navigator instead of dots. The
  // main carousel must already be populated/laid out (attachThumbnailScrubber
  // reads its items' real rendered aspect ratio) before the scrubber is
  // built from it.
  const scrubberMainWrapper = document.getElementById("h-scroll-scrubber-main");
  const scrubberStripWrapper = document.getElementById("h-scroll-scrubber-strip");
  if (scrubberMainWrapper && scrubberStripWrapper) {
    const mainCarousel = createCarousel(scrubberMainWrapper, {
      itemCount: 30,
      effect: getScrubberEffect(scrubberMainWrapper),
      createItem: createPlaceholderItem(scrubberMainWrapper)
    });
    carousels.push(mainCarousel);

    const { scrubber, link } = attachThumbnailScrubber(mainCarousel, scrubberStripWrapper, {
      effect: getScrubberEffect(scrubberStripWrapper)
    });
    carousels.push(scrubber);

    document.querySelectorAll("[data-link-direction]").forEach((select) => {
      select.addEventListener("change", () => {
        link.setMode(select.dataset.linkDirection, select.value);
      });
    });
  }

  document.querySelectorAll('input[name="scroll-alignment"]').forEach((radio) => {
    radio.addEventListener("change", function () {
      if (!this.checked) return;
      carousels.forEach((carousel) => carousel.setAlignment(this.value));
    });
  });
});
