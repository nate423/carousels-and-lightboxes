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
    onProgress: undefined
  };

  populateItems();
  effect.setup(ctx);
  effect.apply(ctx);

  wrapper.addEventListener(
    "scroll",
    rafThrottle(() => effect.apply(ctx))
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
    setOnProgress(onProgress) {
      ctx.onProgress = onProgress;
    },
    effect
  };
}
