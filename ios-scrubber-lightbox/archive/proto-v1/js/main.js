import { createCarousel } from "./carousel-engine.js";
import { attachPageControls } from "./navigators/page-controls.js";
import { attachThumbnailScrubber } from "./navigators/thumbnail-scrubber.js";
import { attachIosThumbnailScrubber } from "./navigators/ios-thumbnail-scrubber.js";
import { iosScrubberCssEffect } from "./effects/ios-scrubber-css-effect.js";
import { iosScrubberEffect } from "./effects/ios-scrubber-effect.js";
import { supportsScrollDrivenAnimations, getEffect, configureScrubberEffect } from "./effect-selection.js";
import { createPlaceholderItem } from "./demo/placeholder-content.js";
import { attachScrollEventProbe } from "./scroll-event-probe.js";
import { watchScrubberJitter } from "./debug-console.js";

// When the page being run was published, shown in the corner so "am I testing
// the build I just pushed?" is answerable at a glance. GitHub Pages serves with
// Cache-Control: max-age=600, so for ten minutes after a deploy a reload can
// still be running the previous build, and there is otherwise nothing on screen
// that says so.
//
// document.lastModified comes from the document's own Last-Modified header, so
// it needs no maintenance - but it describes the document. Modules are cached
// under their own URLs and could in principle be a different age.
function showBuildStamp() {
  const element = document.getElementById("build-stamp");
  if (!element) return;

  const built = new Date(document.lastModified);
  const day = built.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  const time = built.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  element.textContent = `build ${day} ${time}`;
}

// Both scrubber demos carry the same four selects - each carousel's
// response while following, and each carousel's contrast policy - so the
// combinations can be tried against each other rather than reasoned about.
// Scoped to the demo the carousels belong to, since both demos use the same
// attribute names.
function attachDemoControls(wrapperInDemo, link, carousels) {
  const demo = wrapperInDemo.closest(".carousel-comparison");
  if (!demo) return;

  demo.querySelectorAll("[data-link-follower]").forEach((select) => {
    select.addEventListener("change", () => {
      link.setResponse(carousels[select.dataset.linkFollower], select.value);
    });
  });

  demo.querySelectorAll("[data-contrast-for]").forEach((select) => {
    select.addEventListener("change", () => {
      carousels[select.dataset.contrastFor].setContrastRemoval(select.value);
    });
  });
}

document.addEventListener("DOMContentLoaded", function () {
  showBuildStamp();

  const carousels = [];

  // The thumbnail-scrubber demos' wrapper pairs (main + filmstrip, for both
  // styles) are built explicitly below, in order, since each strip needs its
  // source carousel already populated first - excluded here so this generic
  // loop doesn't also set them up as independent top-level carousels. Note
  // .thumbnail-scrubber-main is shared by both styles' main carousel (same
  // role, same look); only the strip markup/class differs per style.
  document
    .querySelectorAll(
      ".carousel-wrapper:not(.thumbnail-scrubber-main):not(.thumbnail-scrubber-strip):not(.ios-thumbnail-scrubber-strip)"
    )
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
      effect: configureScrubberEffect(scrubberMainWrapper),
      createItem: createPlaceholderItem(scrubberMainWrapper)
    });
    carousels.push(mainCarousel);

    const { scrubber, link } = attachThumbnailScrubber(mainCarousel, scrubberStripWrapper, {
      effect: configureScrubberEffect(scrubberStripWrapper)
    });
    carousels.push(scrubber);

    attachDemoControls(scrubberMainWrapper, link, { main: mainCarousel, strip: scrubber });
  }

  // Same pairing as above, but with the iOS-style strip - also a real
  // carousel-engine instance (see navigators/ios-thumbnail-scrubber.js), so
  // both its main carousel and the strip itself go into `carousels` for the
  // alignment radios, same as the classic scrubber pair above.
  const iosScrubberMainWrapper = document.getElementById("h-scroll-ios-scrubber-main");
  const iosScrubberStripWrapper = document.getElementById("h-scroll-ios-scrubber-strip");
  if (iosScrubberMainWrapper && iosScrubberStripWrapper) {
    const mainCarousel = createCarousel(iosScrubberMainWrapper, {
      itemCount: 30,
      effect: configureScrubberEffect(iosScrubberMainWrapper),
      createItem: createPlaceholderItem(iosScrubberMainWrapper)
    });
    carousels.push(mainCarousel);

    // Same choice configureScrubberEffect makes for the other strips, on the
    // same pre-recorded answer: this look now has a natively painted
    // implementation and a hand-computed one, and they are interchangeable.
    // Unlike those, no data-effect/data-scroll-timelines bookkeeping is
    // needed either way - the native one declares its own timeline under its
    // own class (see main.css), and this wrapper opts out of the generic
    // scaffolding regardless.
    const { scrubber, link } = attachIosThumbnailScrubber(mainCarousel, iosScrubberStripWrapper, {
      // ?ios=js forces the hand-computed implementation on a browser that
      // would otherwise take the native one, so the two can be compared
      // directly - they are meant to be indistinguishable.
      effect:
        supportsScrollDrivenAnimations && new URLSearchParams(location.search).get("ios") !== "js"
          ? iosScrubberCssEffect()
          : iosScrubberEffect
    });
    attachDemoControls(iosScrubberMainWrapper, link, { main: mainCarousel, strip: scrubber });
    carousels.push(scrubber);
    attachScrollEventProbe(scrubber, "iOS thumbnail strip (not the main carousel)");
    watchScrubberJitter(mainCarousel, scrubber);
  }

  document.querySelectorAll('input[name="scroll-alignment"]').forEach((radio) => {
    radio.addEventListener("change", function () {
      if (!this.checked) return;
      carousels.forEach((carousel) => carousel.setAlignment(this.value));
    });
  });
});
