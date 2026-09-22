import { cssEffect } from "./effects/css-effect.js";
import { jsEffect } from "./effects/js-effect.js";
import { originEffect } from "./effects/origin-effect.js";

// Reads index.html's pre-recorded answer rather than calling
// CSS.supports("animation-timeline: --works") again here - the polyfill,
// once loaded, patches CSS.supports to always report that as supported (see
// index.html), so a fresh call made from here, after it's had a chance to
// load, would always say "yes" whether or not it actually is.
export const supportsScrollDrivenAnimations = window.__supportsScrollDrivenAnimations ?? CSS.supports("animation-timeline: --works");

// What a real consumer - no demo markup, no guaranteed polyfill - should get:
// the native scroll-driven animation where it's actually supported, or the
// hand-computed JS fallback otherwise.
export function pickEffect() {
  return supportsScrollDrivenAnimations ? cssEffect : jsEffect;
}

// Which effect a wrapper uses is just a data attribute - each effect module
// implements the same { onItemCreated, setup, apply } shape, so
// carousel-engine.js is variant-agnostic and works with any of them.
//
// Demo-only: lets the comparison page's markup pin a specific variant
// (including the demo-only originEffect) via data-effect, so it can be shown
// side-by-side with the others. Defaults to cssEffect rather than
// pickEffect() - the comparison page always loads the scroll-timeline
// polyfill when it's needed (see index.html), so the CSS variant "works"
// there regardless of native support, and the point of these demos is to
// show each variant as-is, polyfilled or not.
const EFFECTS = { css: cssEffect, js: jsEffect, origin: originEffect };

export function getEffect(wrapper) {
  return EFFECTS[wrapper.dataset.effect] || cssEffect;
}

// Named for the fact that it configures the wrapper as well as choosing -
// the two have to happen together, since the chosen module and the CSS
// scaffolding the wrapper declares must agree. Unlike getEffect, this is the
// one non-demo consumer: it needs pickEffect()'s real, unpolyfilled answer
// (the thumbnail scrubber skips the polyfill entirely - see main.js), not
// the demo page's forced/polyfilled one.
export function configureScrubberEffect(wrapper) {
  const effect = pickEffect();
  if (effect === jsEffect) {
    wrapper.dataset.effect = "js";
    wrapper.dataset.scrollTimelines = "off";
  } else {
    wrapper.dataset.effect = "css";
  }
  return effect;
}
