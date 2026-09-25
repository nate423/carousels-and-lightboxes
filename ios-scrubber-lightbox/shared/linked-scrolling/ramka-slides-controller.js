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
// assumption entirely. It does still cache the result, same as
// geometry-cache.js - see createGeometryCache below for why that turned out
// to matter here after all.
import { createScrollAttribution } from "./scroll-attribution.js";
import { computeCurrentProgress, computeScrollAnchorForProgress, computeProgressKnots } from "../carousel-math.js";
import { onScrollEnd } from "../engine/scroll-end.js";
import { trackPress, onSidewaysWheel } from "../engine/press.js";
import { createYieldLead } from "./yield-lead.js";

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
  return {
    anchors,
    wrapperAnchorPoint: wrapperRect.width / 2,
    maxScroll: slidesEl.scrollWidth - slidesEl.clientWidth
  };
}

// Cached, unlike geometry-cache.js's own comment said this file wouldn't
// need to be: "cheap at gallery-sized item counts" undersold how often
// link.js's "instant" mode actually calls this. Every scroll tick of the
// carousel driving this one calls getCurrentProgress once to check the
// index and, on a change, setProgressDirect again to write it - each a full
// getBoundingClientRect pass over every slide. A fast flick can trigger
// several of those per animation frame; measured against real behavior, it
// was enough forced synchronous layout work to visibly stall the
// destination a beat behind the gesture instead of tracking it, catching up
// only once the flick (and the layout thrashing with it) stopped. Cached
// like geometry-cache.js's own carousel-engine equivalent, invalidated on
// the one thing that actually changes it here: the wrapper resizing.
function createGeometryCache(slidesEl, getItems) {
  let geometry = null;

  function get() {
    if (!geometry) geometry = measureSlideAnchors(slidesEl, getItems());
    return geometry;
  }

  function invalidate() {
    geometry = null;
  }

  return { get, invalidate };
}

/**
 * Wraps a ramka `Slides` viewport DOM node (find it with
 * `slidesEl.querySelector('[data-ramka-slides]')`, or give the node itself)
 * so it satisfies the same contract as a shared/carousel-engine.js instance:
 * getItems, goToIndex, getCurrentProgress, getProgressKnots, setProgressDirect,
 * follow, isMovingItself, selfScrollStartedAt, onScroll, onScrollEnd,
 * endFollowing.
 *
 * Untested against ramka's real scroll-snap/zoom/view-transition behavior -
 * see the ramka-scrubber page notes before relying on this beyond a spike.
 */
export function createRamkaSlidesController(slidesEl) {
  function getItems() {
    return slidesEl.querySelectorAll(SLIDE_SELECTOR);
  }

  const snap = createSlidesSnapSuspension(slidesEl);
  // ramka moves its slides itself - its buttons, its keys - through input
  // this controller never sees, and every such move should carry the strip.
  const attribution = createScrollAttribution(slidesEl, { onSelfReclaim: snap.restore, leadsUnasked: true });
  const geometry = createGeometryCache(slidesEl, getItems);

  // ramka hears its arrow, Home and End keys on its lightbox content, which
  // holds the slides but isn't them, so those keys never reach the slides'
  // own keydown listener. Nor do clicks on its previous/next buttons. Without
  // these, the slides stay "driven" after the strip has led, and their moves
  // are taken for echoes and not passed on to the strip.
  const content = slidesEl.closest("[data-ramka-content]");
  content?.addEventListener("keydown", attribution.noteSelfInput, { passive: true });
  content?.addEventListener(
    "pointerdown",
    (event) => {
      if (event.target.closest("[data-ramka-previous], [data-ramka-next]")) attribution.noteSelfInput();
    },
    { passive: true }
  );

  function goToIndex(index, { behavior = "smooth" } = {}) {
    const items = getItems();
    if (!items[index]) return;
    attribution.noteSelfCommand();
    const { anchors, wrapperAnchorPoint } = geometry.get();
    slidesEl.scrollTo({ left: anchors[index] - wrapperAnchorPoint, behavior });
  }

  function getCurrentProgress() {
    const { anchors, wrapperAnchorPoint } = geometry.get();
    return computeCurrentProgress(anchors, slidesEl.scrollLeft + wrapperAnchorPoint);
  }

  // As a leader: where its scroll offset maps to progress, for a carousel
  // following on its scroll timeline - see carousel-math.js.
  function getProgressKnots() {
    const { anchors, wrapperAnchorPoint, maxScroll } = geometry.get();
    return computeProgressKnots(anchors, wrapperAnchorPoint, maxScroll);
  }

  // As a continuous follower, it can only be written: ramka draws its own
  // slides, so there is no look here to lay across another carousel's
  // timeline. No page links it this way today.
  function follow(leader) {
    setProgressDirect(leader.getCurrentProgress());
  }

  function setProgressDirect(progress) {
    attribution.noteDirectWrite(progress);
    snap.suspend();
    const { anchors, wrapperAnchorPoint } = geometry.get();
    slidesEl.scrollLeft = computeScrollAnchorForProgress(anchors, progress) - wrapperAnchorPoint;
  }

  // The one thing that actually moves these anchors after the fact: the
  // viewport resizing (window resize, orientation change, devtools panel
  // toggling). Slide count is fixed for this gallery's lifetime and slide
  // boxes don't otherwise change size on their own, so this is the only
  // invalidation source that's actually needed.
  // Reported, so a finger on the slides can keep the strip from being
  // dragged at the same time (see link.js). The slides themselves are never
  // locked in return: ramka handles its own touches - pinch to zoom among
  // them - and setting touch-action on its scrollport would take them over.
  const pressListeners = new Set();
  const press = trackPress(slidesEl, { onChange: (pressed) => pressListeners.forEach((listener) => listener(pressed)) });
  // Not stopped for a touch on the strip: see yield-lead.js.
  const yieldLead = createYieldLead(slidesEl, { attribution, isPressed: press.isPressed, stopsOnTouch: false });

  const geometryListeners = new Set();
  const resizeObserver = new ResizeObserver(() => {
    geometry.invalidate();
    // A copy: a follower rebuilding here unsubscribes and subscribes again.
    [...geometryListeners].forEach((listener) => listener());
  });
  resizeObserver.observe(slidesEl);

  const scrollListeners = new Set();
  const scrollEndListeners = new Set();

  onScrollEnd(slidesEl, () => {
    const wasLeading = attribution.endLeading();
    if (wasLeading) scrollEndListeners.forEach((listener) => listener());
  });

  // Subscribers hear a scroll in the event itself, not a frame later, so a
  // link's write to the carousel this one drives lands before the frame
  // samples that carousel's scroll-driven animations - see the same listener
  // in carousel-engine.js.
  slidesEl.addEventListener(
    "scroll",
    () => {
      attribution.noteScrollEvent();
      const source = attribution.getScrollSource();
      scrollListeners.forEach((listener) => listener({ source }));
    },
    { passive: true }
  );

  return {
    wrapper: slidesEl,
    getItems,
    goToIndex,
    getCurrentProgress,
    getProgressKnots,
    setProgressDirect,
    follow,
    onGeometryChange(listener) {
      geometryListeners.add(listener);
      return () => geometryListeners.delete(listener);
    },
    onPressChange(listener) {
      pressListeners.add(listener);
      return () => pressListeners.delete(listener);
    },
    getScrollSource: attribution.getScrollSource,
    getMotionState: attribution.getMotionState,
    yieldLead,
    isPressed: press.isPressed,
    onWheel: (listener) => onSidewaysWheel(slidesEl, listener),
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
