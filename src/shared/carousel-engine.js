// The carousel engine every page here builds on. Knows nothing about page
// dots, thumbnail scrubbers, or what an item contains - callers supply item
// content via `createItem`, and attach whatever navigation UI they want (or
// none) by reading the returned controller's progress and calling its seek
// methods.
//
// The stateful pieces below - scroll attribution, snap suspension, contrast
// policy, geometry caching, spacers, item population - each live in their
// own module under engine/, self-contained apart from the accessors
// (getItems, getNoncurrentScale, ...) and callbacks this file wires
// between them. This file is the orchestrator: it owns nothing but the glue
// - the event listeners, the ctx bundle effects read, and the public API -
// and the seams between the pieces are exactly the places where two of them
// have to agree, which is also where the comments explaining *why* now live.
// The pure math they all build on was already factored out to
// carousel-math.js.
import { computeScrollTarget, computeScrollAnchorForProgress } from "./carousel-math.js";
import { rafThrottle } from "./engine/raf-throttle.js";
import { createScrollAttribution } from "./engine/scroll-attribution.js";
import { createSnapSuspension } from "./engine/snap-suspension.js";
import { createContrastPolicy } from "./engine/contrast-policy.js";
import { createGeometryCache } from "./engine/geometry-cache.js";
import { createSpacers } from "./engine/spacers.js";
import { populateItems as populateItemsInto } from "./engine/populate-items.js";

export { rafThrottle };

export function createCarousel(wrapper, options = {}) {
  const {
    itemCount = 30,
    effect,
    createItem,
    itemSizing,
    removeContrastWhileScrolling = "never"
  } = options;

  function getNoncurrentScale() {
    return (
      parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-scale")) || 1
    );
  }

  function getItems() {
    return wrapper.querySelectorAll(".carousel-item");
  }

  // snap-suspension has no dependents, so it can be built first; attribution
  // reclaims it (onSelfReclaim) the instant real input takes the carousel
  // back from a drive - see scroll-attribution.js and snap-suspension.js for
  // why that instant, rather than the suspension's own timer, is what has to
  // hand snap back.
  const snap = createSnapSuspension(wrapper);
  const attribution = createScrollAttribution(wrapper, { onSelfReclaim: snap.restore });
  const contrast = createContrastPolicy(wrapper, removeContrastWhileScrolling);
  const geometry = createGeometryCache({ wrapper, getItems });
  const spacers = createSpacers(wrapper, { getItems });

  // Reads motion off attribution and writes it through to the contrast
  // policy - the one-line seam between the two modules. Return value (did
  // the attribute actually change) is only used by setContrastRemoval below;
  // every other call site treats this as fire-and-forget.
  function updateContrast() {
    return contrast.update(attribution.getMotionState());
  }

  // effect.apply reads state that effect.setup builds, so nothing may call
  // it before the first setup below has run.
  let ready = false;

  // A look painted in CSS redraws itself when the contrast attribute
  // changes; one painted in JS only draws from apply(). Both places below
  // are ones where a JS look would otherwise be left holding a stale frame,
  // since neither is a scroll.
  function applyIfReady() {
    if (ready) effect.apply(ctx);
  }

  // Every path that can move an item - init, resize, an item resizing
  // itself, an alignment change - goes through here, so invalidating the
  // geometry cache on its way through covers all of them at once and cannot
  // be forgotten at a new call site.
  function updateSpacers() {
    spacers.update();
    geometry.invalidate();
  }

  // Scroll offset that puts the given item's anchor point at the wrapper's
  // anchor point. Shared by click-to-scroll and any external seek (e.g. a
  // page-dot click).
  function goToIndex(index, { behavior = "smooth" } = {}) {
    const items = getItems();
    const item = items[index];
    if (!item) return;

    // An explicit command to this carousel, not an echo of something driving
    // it, so the scrolling it is about to do counts as this carousel moving
    // for its own reasons and propagates through a link.
    attribution.noteSelfCommand();

    const scrollTarget = computeScrollTarget(wrapper, item);

    wrapper.scrollTo({ left: scrollTarget, behavior });
  }

  // Manually takes over the scroll position to match an externally-driven
  // currentProgress (e.g. another carousel's live scroll) - a direct write,
  // not wrapper.scrollTo(), since the source progress is itself
  // continuously changing during a live scroll/drag and native smooth-scroll
  // only makes sense against a fixed destination. See carousel-link.js.
  function setProgressDirect(progress) {
    attribution.noteDirectWrite(progress);
    updateContrast();
    snap.suspend();

    const { anchors, wrapperAnchorPoint } = geometry.get();
    wrapper.scrollLeft = computeScrollAnchorForProgress(anchors, progress) - wrapperAnchorPoint;

    // Render here rather than waiting for the scroll event this write usually
    // causes, because it does not always cause one: a scroll position is
    // quantised to whole pixels, so when a short scroller is driven by a much
    // longer one most frames resolve to the pixel it is already on, emit
    // nothing, and would otherwise hold the previous frame's render. That is
    // what makes a slow drag on the driver look like it steps rather than
    // glides. Effects are free to re-run - they compute from current state
    // rather than accumulating - so the echo, when it does arrive, is harmless.
    effect.apply(ctx);
  }

  function populateItems() {
    populateItemsInto(wrapper, spacers.lastSpacer, {
      itemCount,
      effect,
      createItem,
      itemSizing,
      onItemClick: (index) => goToIndex(index, { behavior: "smooth" })
    });
    updateSpacers();
  }

  // ctx bundles everything an effect module needs to read geometry and
  // report progress for this one wrapper. onProgress starts unset - a
  // navigator (page-controls, etc) attaches itself via setOnProgress after
  // createCarousel returns.
  const ctx = {
    wrapper,
    getNoncurrentScale,
    getScrollSource: attribution.getScrollSource,
    getMotionState: attribution.getMotionState,
    getDrivenProgress: attribution.getDrivenProgress,
    // Shared rather than measured per effect - see geometry-cache.js.
    // Effects that keep their own copy predate this and are not wrong to;
    // what they must not do is read it fresh every frame.
    getGeometry: geometry.get,
    currentScrollAnchor: geometry.currentScrollAnchor,
    usesContrast: contrast.usesContrast,
    onProgress: undefined
  };

  populateItems();
  updateContrast();
  effect.setup(ctx);
  effect.apply(ctx);
  ready = true;

  const scrollListeners = new Set();
  const scrollEndListeners = new Set();

  // A single rAF-throttled pass per scroll frame, shared by the effect and
  // every onScroll subscriber, so a link and an effect watching the same
  // wrapper can never disagree about which frame they're in, and so the
  // effect has always re-rendered for this position before anything
  // downstream reads it. `source` is sampled once rather than per listener:
  // it can only change on a real input event, which can't interleave with
  // this synchronous loop.
  // 'scrollend' fires once a scroll operation - gesture, momentum and any snap
  // correction together - is over, which is what bounds a stretch of movement.
  // Contrast is updated from the unthrottled listener, not the rAF-throttled
  // one below, so it flips on the first scroll event of a gesture rather
  // than a frame into it.
  wrapper.addEventListener("scroll", () => {
    attribution.noteScrollEvent();
    updateContrast();
  });
  // Unconditionally, not just when contrast changed: this is where a
  // gesture's final position becomes final, and the apply below is
  // rAF-throttled, so the last scroll event's render is still pending when
  // this fires. Rendering once more here is what guarantees the look ends
  // up drawing the position the carousel actually came to rest at.
  //
  // Only ends *this* carousel's own leading motion, not driven motion - see
  // endFollowing below for why the driven side can't trust its own
  // 'scrollend'. scrollEndListeners only fire on a real leading gesture
  // ending (wasLeading), so a spurious/early scrollend while merely being
  // driven, or one with no motion behind it at all, never gets relayed as if
  // it were the authoritative "the gesture is over" signal.
  wrapper.addEventListener("scrollend", () => {
    const wasLeading = attribution.endLeading();
    updateContrast();
    applyIfReady();
    if (wasLeading) {
      scrollEndListeners.forEach((listener) => listener());
    }
  });

  wrapper.addEventListener(
    "scroll",
    rafThrottle(() => {
      effect.apply(ctx);
      const source = attribution.getScrollSource();
      scrollListeners.forEach((listener) => listener({ source }));
    })
  );

  // Shared by both triggers below so a resize that also changes an item's
  // own size (e.g. dragging the window while an image is still loading)
  // coalesces into one refresh per frame instead of two.
  const refreshGeometry = rafThrottle(() => {
    updateSpacers();
    effect.setup(ctx);
    effect.apply(ctx);
  });

  window.addEventListener("resize", refreshGeometry);

  // Recovers from an item's size changing for reasons outside this module's
  // own control (e.g. a placeholder image finishing its load mid-scroll).
  // Effects that resize items themselves as their normal scroll-driven
  // behavior (see the iOS scrubber's look.js) opt out via
  // effect.skipItemResizeObserver - without that, every write the effect
  // makes would itself be observed here as "an item's size changed
  // unexpectedly", re-triggering refreshGeometry (and so effect.apply
  // again) on the very next frame regardless of whether the wrapper's own
  // scroll actually moved - a self-sustaining cascade of redundant,
  // slightly-stale re-renders that reads as items flickering their
  // position.
  if (!effect.skipItemResizeObserver) {
    const itemResizeObserver = new ResizeObserver(refreshGeometry);
    getItems().forEach((item) => itemResizeObserver.observe(item));
  }

  // Ends "following", called by the link once the carousel actually driving
  // this one reports that *its* gesture is over - see onScrollEnd below and
  // carousel-link.js.
  function endFollowing() {
    if (!attribution.endFollowing()) return;
    updateContrast();
    applyIfReady();
  }

  return {
    wrapper,
    getItems,
    goToIndex,
    getCurrentProgress: geometry.getCurrentProgress,
    setProgressDirect,
    getScrollSource: attribution.getScrollSource,
    getMotionState: attribution.getMotionState,
    // Which motion states drop contrast, changeable live (e.g. from a demo
    // control) - the policy is read fresh on every update, not captured.
    setContrastRemoval(mode) {
      const { usesContrastChanged } = contrast.setMode(mode);
      // Crossing between "never" and anything else can change how a look
      // draws itself, not just what it draws, so the effect is rebuilt
      // rather than merely re-rendered.
      if (ready && usesContrastChanged) {
        effect.setup(ctx);
        effect.apply(ctx);
      }
      if (updateContrast()) applyIfReady();
    },
    isMovingItself: attribution.isMovingItself,
    selfScrollStartedAt: attribution.selfScrollStartedAt,
    // Notified once per scroll frame, after effect.apply, with the
    // attribution of that scroll - see scroll-attribution.js.
    // Returns an unsubscribe function.
    onScroll(listener) {
      scrollListeners.add(listener);
      return () => scrollListeners.delete(listener);
    },
    // Notified when this carousel's own gesture - the kind that sets
    // isMovingItself, not one driven onto it - actually ends. The reliable
    // end-of-motion signal a link forwards to whatever this carousel is
    // driving; see endFollowing. Returns an unsubscribe function.
    onScrollEnd(listener) {
      scrollEndListeners.add(listener);
      return () => scrollEndListeners.delete(listener);
    },
    endFollowing,
    setOnProgress(onProgress) {
      ctx.onProgress = onProgress;
    },
    effect
  };
}
