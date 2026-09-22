// Second implementer of the controller protocol link.js expects (see this
// directory's README, "What a carousel has to provide") - the first is
// carousel-engine.js. This one doesn't own a carousel; it adapts an external
// scrollport we don't control the internals of: ramka's Lightbox `Slides`
// viewport, reached only through its public data-attribute contract
// (`data-ramka-slides` on the scrollport, `data-ramka-slide` per slide - see
// @ramka/react's lightbox-data-attributes.js). Once wrapped, link.js and
// scroll-attribution.js drive it exactly as they would any carousel-engine
// wrapper, with no knowledge that it isn't one - snap suspension is its own
// local variant below, not the shared one; see that function's own comment
// for why.
//
// Deliberately does not reuse carousel-math.js's getItemMetrics/
// createGeometryCache: both measure via offsetLeft, which assumes the item's
// offsetParent chain lines up with the wrapper's - true for a carousel-engine
// wrapper's flex children, not guaranteed for ramka's slides (their own
// internal slides-geometry falls back to getBoundingClientRect for exactly
// this reason). Measuring via getBoundingClientRect here sidesteps the
// assumption entirely, at the cost of a layout read per slide - cheap at
// gallery-sized item counts, so nothing here caches it the way
// geometry-cache.js does for a 30-item placeholder carousel.
import { createScrollAttribution } from "./scroll-attribution.js";
import { computeCurrentProgress, computeScrollAnchorForProgress } from "../carousel-math.js";
import { rafThrottle } from "../engine/raf-throttle.js";

const SLIDE_SELECTOR = "[data-ramka-slide]";
const SNAP_RESTORE_DELAY = 150;

// Not snap-suspension.js: that module's restore() sets scrollSnapType to ""
// (drop the inline override, fall back to the wrapper's own stylesheet rule)
// - correct for a carousel-engine wrapper, whose class in shared/base.css
// carries scroll-snap-type. ramka's Slides has no such fallback: it manages
// scroll-snap-type entirely via inline style, with its own depth-counted
// suspend/restore around its own scrollToIndex (see @ramka/react's
// lightbox-slides.tsx - SLIDES_SCROLL_SNAP_TYPE). "" would permanently
// clobber whatever ramka set, since ramka only re-asserts it inside its own
// suspend/restore cycle, which our direct scrollLeft writes never go
// through. Capturing and restoring ramka's actual current inline value here
// (rather than hardcoding its literal 'x mandatory') avoids assuming that
// implementation detail while still never losing it.
function createSlidesSnapSuspension(slidesEl) {
  let suspendedValue = null;
  let restoreTimer = null;

  function suspend() {
    if (suspendedValue === null) {
      suspendedValue = slidesEl.style.scrollSnapType;
      slidesEl.style.scrollSnapType = "none";
    }
    clearTimeout(restoreTimer);
    restoreTimer = setTimeout(restore, SNAP_RESTORE_DELAY);
  }

  function restore() {
    clearTimeout(restoreTimer);
    if (suspendedValue !== null) {
      slidesEl.style.scrollSnapType = suspendedValue;
      suspendedValue = null;
    }
  }

  return { suspend, restore };
}

function measureSlideAnchors(slidesEl, items) {
  const wrapperRect = slidesEl.getBoundingClientRect();
  const anchors = Array.from(items, (item) => {
    const rect = item.getBoundingClientRect();
    return rect.left - wrapperRect.left + slidesEl.scrollLeft + rect.width / 2;
  });
  return { anchors, wrapperAnchorPoint: wrapperRect.width / 2 };
}

/**
 * Wraps a ramka `Slides` viewport DOM node (find it with
 * `slidesEl.querySelector('[data-ramka-slides]')`, or give the node itself)
 * so it satisfies the same contract as a shared/carousel-engine.js instance:
 * getItems, goToIndex, getCurrentProgress, setProgressDirect, isMovingItself,
 * selfScrollStartedAt, onScroll, onScrollEnd, endFollowing.
 *
 * Untested against ramka's real scroll-snap/zoom/view-transition behavior -
 * see the ramka-scrubber page notes before relying on this beyond a spike.
 */
export function createRamkaSlidesController(slidesEl) {
  function getItems() {
    return slidesEl.querySelectorAll(SLIDE_SELECTOR);
  }

  const snap = createSlidesSnapSuspension(slidesEl);
  const attribution = createScrollAttribution(slidesEl, { onSelfReclaim: snap.restore });

  function goToIndex(index, { behavior = "smooth" } = {}) {
    const items = getItems();
    if (!items[index]) return;
    attribution.noteSelfCommand();
    const { anchors, wrapperAnchorPoint } = measureSlideAnchors(slidesEl, items);
    slidesEl.scrollTo({ left: anchors[index] - wrapperAnchorPoint, behavior });
  }

  function getCurrentProgress() {
    const items = getItems();
    const { anchors, wrapperAnchorPoint } = measureSlideAnchors(slidesEl, items);
    return computeCurrentProgress(anchors, slidesEl.scrollLeft + wrapperAnchorPoint);
  }

  function setProgressDirect(progress) {
    attribution.noteDirectWrite(progress);
    snap.suspend();
    const { anchors, wrapperAnchorPoint } = measureSlideAnchors(slidesEl, getItems());
    slidesEl.scrollLeft = computeScrollAnchorForProgress(anchors, progress) - wrapperAnchorPoint;
  }

  const scrollListeners = new Set();
  const scrollEndListeners = new Set();

  slidesEl.addEventListener("scroll", () => attribution.noteScrollEvent(), { passive: true });

  slidesEl.addEventListener("scrollend", () => {
    const wasLeading = attribution.endLeading();
    if (wasLeading) scrollEndListeners.forEach((listener) => listener());
  });

  slidesEl.addEventListener(
    "scroll",
    rafThrottle(() => {
      const source = attribution.getScrollSource();
      scrollListeners.forEach((listener) => listener({ source }));
    }),
    { passive: true }
  );

  return {
    wrapper: slidesEl,
    getItems,
    goToIndex,
    getCurrentProgress,
    setProgressDirect,
    isMovingItself: attribution.isMovingItself,
    selfScrollStartedAt: attribution.selfScrollStartedAt,
    onScroll(listener) {
      scrollListeners.add(listener);
      return () => scrollListeners.delete(listener);
    },
    onScrollEnd(listener) {
      scrollEndListeners.add(listener);
      return () => scrollEndListeners.delete(listener);
    },
    // No effect to re-render on the other side of this write - ramka draws
    // its own slides - so unlike carousel-engine.js's endFollowing, there is
    // nothing to apply here beyond clearing attribution.
    endFollowing() {
      attribution.endFollowing();
    }
  };
}
