// Generalized carousel engine, extracted out of what used to be main.js's
// setupCarousel/populateCarousel/updateSpacers/setAlignment. Knows nothing
// about page dots, thumbnail scrubbers, or demo-page concerns like
// placeholder boxes vs. images - callers supply item content via
// `createItem`, and attach whatever navigation UI they want (or none) by
// reading the returned controller's progress and calling its seek methods.
import {
  alignmentFraction,
  getItemMetrics,
  computeScrollTarget,
  computeSpacerLength,
  computeCurrentProgress,
  computeCurrentIndex,
  computeScrollAnchorForProgress,
  wrapperAnchor
} from "./carousel-math.js";

const DEFAULT_ALIGNMENT = "center";
// ms of no further direct writes before scroll-snap is handed back - see
// suspendScrollSnap below.
const SNAP_RESTORE_DELAY = 150;

// Native `scroll` can fire more than once per animation frame (trackpads in
// particular), and both `resize` and ResizeObserver behave the same way
// during a live window drag - fired on close to every frame, not just once
// it settles. effect.apply() reads item.offsetLeft/offsetWidth
// (getItemMetrics) and then writes styles at the end - fine within one call,
// but if a second event lands before the browser's next natural layout
// pass, its read runs right after the previous call's write, forcing a
// synchronous layout recalc instead of a cheap cached read. Collapsing
// same-frame events down to one rAF-scheduled call guarantees the read
// always happens after the browser's own layout pass.
export function rafThrottle(fn) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...args);
    });
  };
}

function defaultCreateItem(item, index) {
  item.textContent = `Item ${index}`;
}

export function createCarousel(wrapper, options = {}) {
  const { itemCount = 30, effect, createItem = defaultCreateItem } = options;

  wrapper.dataset.scrollAlignment ||= DEFAULT_ALIGNMENT;

  const scrollAxis = wrapper.getAttribute("data-scroll-axis") || "x";
  const scrollDistance = scrollAxis === "x" ? "scrollLeft" : "scrollTop";
  const offsetLength = scrollAxis === "x" ? "offsetWidth" : "offsetHeight";
  const offsetFromStart = scrollAxis === "x" ? "offsetLeft" : "offsetTop";
  const scrollSize = scrollAxis === "x" ? "scrollWidth" : "scrollHeight";

  // --- Scroll attribution -------------------------------------------------
  // Every scroll this wrapper emits is attributed to one of two sources, and
  // anything watching it - a link relaying it to another carousel, an effect
  // that renders differently depending on who is moving it (see
  // ios-scrubber-effect.js) - reads that attribution instead of trying to
  // reconstruct it from raw DOM events of its own.
  //
  //   "self"   - this carousel is moving for its own reasons: a real gesture
  //              on it, or a goToIndex/setAlignment command aimed at it.
  //              Authoritative motion, and the only kind worth relaying.
  //   "driven" - an outside driver is writing this carousel's scroll position
  //              directly through setProgressDirect. The scroll events that
  //              follow are echoes of that write, not new information.
  //
  // "driven" is a hard, sticky state rather than a timing window, because a
  // programmatic write's consequences have no bounded duration: the write
  // fires its own native 'scroll' event (the echo), and so does the
  // browser's scroll-snap "resnap" correction, which runs *asynchronously*
  // after snap is handed back and can itself animate for an unpredictable
  // stretch (observed up to ~1.8s) whenever the anchor we computed isn't
  // pixel-identical to the browser's own snap-point geometry. Neither can
  // happen without setProgressDirect having run first, so "has anything
  // moved this carousel for its own reasons since the last direct write" is
  // a complete, exact answer - no elapsed-time guess, and so no window that
  // might cut off a legitimate but slow-to-arrive correction.
  //
  // Event ordering makes the flip back to "self" safe even when real input
  // lands in the same batched frame as a pending echo: an input handler runs
  // synchronously as part of input dispatch, before the 'scroll' it causes is
  // ever queued, so the attribution is already correct by the time that
  // scroll event's own handler runs.
  let scrollSource = "self";

  // Whether this carousel is currently scrolling for its own reasons, and when
  // that stretch of movement began. Both are derived from real scroll events
  // rather than from input events, which is the only way to get this right:
  // the browser latches a wheel gesture to whichever scroller it started on,
  // but keeps dispatching the wheel events themselves to whatever is under the
  // cursor. Move the cursor to another carousel mid-flick and its wheel
  // handlers fire while the original scroller is the one actually moving, so
  // anything that reads input to decide who is in charge names the wrong one.
  let movingItself = false;
  let selfScrollStartedAt = 0;

  // The exact progress the last setProgressDirect was asked for. Worth keeping
  // because it cannot be recovered afterwards: writing it moves scrollLeft,
  // and a scroll position is quantised - WebKit reports whole pixels - so
  // reading it back returns a coarser value than went in. An effect rendering
  // a driven carousel should use this rather than measure the scroll position
  // it was just handed.
  let lastDrivenProgress = 0;

  function markSelfDriven() {
    scrollSource = "self";
    // This carousel is the user's again, so any suspension left over from a
    // drive is finished - see restoreScrollSnap for why it can't be left to
    // expire on its own.
    restoreScrollSnap();
  }

  // touchmove/pointerdown cover fingers and scrollbar drags; keydown covers
  // arrow/page/home/end scrolling on browsers that make scrollers focusable.
  ["wheel", "touchmove", "pointerdown", "keydown"].forEach((type) =>
    wrapper.addEventListener(type, markSelfDriven, { passive: true })
  );

  // scroll-snap-type: mandatory (every carousel-engine wrapper has it) tries
  // to correct exactly what a direct write looks like to it: a scroll position
  // that isn't part of an active native gesture. Suspending it for the
  // duration of a drive keeps the browser's own resnap from fighting
  // setProgressDirect.
  //
  // Handing it back is timer-based only because a drive has no natural end
  // event - but the timer must never be what hands it back mid-gesture. Snap
  // returning while the browser still has the driven position latched makes it
  // resnap to that position rather than to wherever the gesture has since got
  // to, which reads as the carousel scrolling normally and then, up to a
  // second later, jumping back to where it started. restoreScrollSnap is
  // therefore also called the instant real input reclaims this carousel, while
  // the scroll position is still exactly on the anchor the last write put it
  // on, so re-enabling snap there corrects nothing.
  //
  // Both functions only write the style when it would actually change - a style
  // write followed by a geometry read (offsetLeft/offsetWidth, in
  // setProgressDirect right after) on the same element forces a synchronous
  // layout recalculation, and re-writing an unchanged value still re-arms it.
  let snapRestoreTimer = null;

  function suspendScrollSnap() {
    if (wrapper.style.scrollSnapType !== "none") {
      wrapper.style.scrollSnapType = "none";
    }
    clearTimeout(snapRestoreTimer);
    snapRestoreTimer = setTimeout(restoreScrollSnap, SNAP_RESTORE_DELAY);
  }

  function restoreScrollSnap() {
    clearTimeout(snapRestoreTimer);
    if (wrapper.style.scrollSnapType !== "") {
      wrapper.style.scrollSnapType = "";
    }
  }

  const scrollListeners = new Set();

  function getAlignment() {
    return wrapper.dataset.scrollAlignment || DEFAULT_ALIGNMENT;
  }

  function getAlignmentFraction() {
    return alignmentFraction(getAlignment());
  }

  function getScrollPadding() {
    return (
      parseFloat(
        getComputedStyle(wrapper).getPropertyValue("--carousel-scroll-padding")
      ) || 0
    );
  }

  function getNoncurrentScale() {
    return (
      parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-scale")) || 1
    );
  }

  function getItems() {
    return wrapper.querySelectorAll(".carousel-item");
  }

  const firstSpacer = document.createElement("div");
  const lastSpacer = document.createElement("div");
  firstSpacer.classList.add("spacer");
  lastSpacer.classList.add("spacer");
  wrapper.prepend(firstSpacer);
  wrapper.append(lastSpacer);

  function updateSpacers() {
    const items = getItems();
    const [firstItem, lastItem] = [items[0], items[items.length - 1] || items[0]];
    const gapLength = parseFloat(getComputedStyle(wrapper).gap);
    const alignment = getAlignmentFraction();
    const scrollPadding = getScrollPadding();

    [firstSpacer, lastSpacer].forEach((spacer, index) => {
      // Each spacer only needs to make up the room on its own side of the
      // alignment point - see computeSpacerLength in carousel-math.js.
      const edgeFraction = index === 0 ? alignment : 1 - alignment;
      const item = index === 0 ? firstItem : lastItem;
      const length = Math.max(
        0,
        computeSpacerLength(
          wrapper[offsetLength],
          item[offsetLength],
          edgeFraction,
          gapLength,
          scrollPadding
        )
      );
      spacer.style[scrollAxis === "x" ? "width" : "height"] = length + "px";
    });
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
    scrollSource = "self";

    const scrollTarget = computeScrollTarget(
      wrapper,
      item,
      offsetFromStart,
      offsetLength,
      getAlignmentFraction(),
      getScrollPadding()
    );

    wrapper.scrollTo({
      [scrollAxis === "x" ? "left" : "top"]: scrollTarget,
      behavior
    });
  }

  // Continuous (fractional) "which item is current" - see
  // computeCurrentProgress in carousel-math.js.
  function getCurrentProgress() {
    const items = getItems();
    const { anchors, scrollAnchor } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetLength,
      scrollDistance,
      getAlignmentFraction(),
      getScrollPadding()
    );
    return computeCurrentProgress(anchors, scrollAnchor);
  }

  // Manually takes over the scroll position to match an externally-driven
  // currentProgress (e.g. another carousel's live scroll) - a direct write,
  // not wrapper.scrollTo(), since the source progress is itself
  // continuously changing during a live scroll/drag and native smooth-scroll
  // only makes sense against a fixed destination. See carousel-link.js.
  function setProgressDirect(progress) {
    scrollSource = "driven";
    lastDrivenProgress = progress;
    suspendScrollSnap();

    const items = getItems();
    const alignment = getAlignmentFraction();
    const scrollPadding = getScrollPadding();
    const { anchors } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetLength,
      scrollDistance,
      alignment,
      scrollPadding
    );
    const scrollAnchor = computeScrollAnchorForProgress(anchors, progress);
    wrapper[scrollDistance] = scrollAnchor - wrapperAnchor(wrapper[offsetLength], alignment, scrollPadding);

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
    for (let i = 0; i < itemCount; i++) {
      const snapFixDiv = document.createElement("div");
      snapFixDiv.classList.add("carousel-item-snap-fix");

      const item = document.createElement("div");
      item.classList.add("carousel-item");
      effect.onItemCreated(item);
      createItem(item, i);

      snapFixDiv.appendChild(item);
      wrapper.insertBefore(snapFixDiv, lastSpacer);

      item.addEventListener("click", () => goToIndex(i, { behavior: "smooth" }));
    }

    updateSpacers();
  }

  // ctx bundles everything an effect module needs to read geometry and
  // report progress for this one wrapper. onProgress starts unset - a
  // navigator (page-controls, etc) attaches itself via setOnProgress after
  // createCarousel returns.
  const ctx = {
    wrapper,
    scrollDistance,
    offsetLength,
    offsetFromStart,
    scrollSize,
    scrollAxis,
    getAlignmentFraction,
    getScrollPadding,
    getNoncurrentScale,
    getScrollSource: () => scrollSource,
    getDrivenProgress: () => lastDrivenProgress,
    onProgress: undefined
  };

  populateItems();
  effect.setup(ctx);
  effect.apply(ctx);

  // A single rAF-throttled pass per scroll frame, shared by the effect and
  // every onScroll subscriber, so a link and an effect watching the same
  // wrapper can never disagree about which frame they're in, and so the
  // effect has always re-rendered for this position before anything
  // downstream reads it. `source` is sampled once rather than per listener:
  // it can only change on a real input event, which can't interleave with
  // this synchronous loop.
  // 'scrollend' fires once a scroll operation - gesture, momentum and any snap
  // correction together - is over, which is what bounds a stretch of movement.
  wrapper.addEventListener("scroll", () => {
    const nowMovingItself = scrollSource === "self";
    if (nowMovingItself && !movingItself) selfScrollStartedAt = performance.now();
    movingItself = nowMovingItself;
  });
  wrapper.addEventListener("scrollend", () => {
    movingItself = false;
  });

  wrapper.addEventListener(
    "scroll",
    rafThrottle(() => {
      effect.apply(ctx);
      const source = scrollSource;
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
  // behavior (see ios-scrubber-effect.js) opt out via
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

  // Re-points the wrapper at a new alignment: keeps whichever item is
  // currently "current" under the cursor of the new alignment (no smooth
  // scroll, so it doesn't fight the user's next scroll gesture), then
  // resizes the spacers and redraws to match.
  function setAlignment(alignment) {
    const items = getItems();
    const { anchors, scrollAnchor } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetLength,
      scrollDistance,
      getAlignmentFraction(),
      getScrollPadding()
    );
    const currentIndex = computeCurrentIndex(
      computeCurrentProgress(anchors, scrollAnchor),
      items.length
    );
    wrapper.dataset.scrollAlignment = alignment;
    updateSpacers();
    effect.setup(ctx);
    goToIndex(currentIndex, { behavior: "instant" });
    effect.apply(ctx);
  }

  return {
    wrapper,
    scrollAxis,
    getItems,
    goToIndex,
    getCurrentProgress,
    setProgressDirect,
    setAlignment,
    getScrollSource: () => scrollSource,
    isMovingItself: () => movingItself,
    selfScrollStartedAt: () => selfScrollStartedAt,
    // Notified once per scroll frame, after effect.apply, with the
    // attribution of that scroll - see the scroll-attribution block above.
    // Returns an unsubscribe function.
    onScroll(listener) {
      scrollListeners.add(listener);
      return () => scrollListeners.delete(listener);
    },
    setOnProgress(onProgress) {
      ctx.onProgress = onProgress;
    },
    effect
  };
}
