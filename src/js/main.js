import {
  alignmentFraction,
  getItemMetrics,
  computeScrollTarget,
  computeSpacerLength,
  computeCurrentProgress,
  computeCurrentIndex
} from "./carousel-math.js";
import { cssEffect } from "./effects/css-effect.js";
import { jsEffect } from "./effects/js-effect.js";

const DEFAULT_ALIGNMENT = "center";

// Native `scroll` can fire more than once per animation frame (trackpads in
// particular), and both `resize` and ResizeObserver behave the same way
// during a live window drag - fired on close to every frame, not just once
// it settles. effect.apply() reads item.offsetLeft/offsetWidth
// (getItemMetrics) and then writes a page-dot class at the end
// (updatePageIndicator) - fine within one call, but if a second event lands
// before the browser's next natural layout pass, its read runs right after
// the previous call's write, forcing a synchronous layout recalc instead of
// a cheap cached read (confirmed via DevTools Performance - "Forced reflow"
// insight). Collapsing same-frame events down to one rAF-scheduled call
// guarantees the read always happens after the browser's own layout pass,
// not interleaved with our own write - and, for resize/ResizeObserver,
// keeps geometry updating every frame instead of only once things settle,
// so the carousel tracks a live drag smoothly instead of freezing then
// jumping to its final state.
function rafThrottle(fn) {
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

// Which variant a wrapper uses is just a data attribute - each effect
// module implements the same { onItemCreated, setup, apply } shape, so
// everything below is variant-agnostic and works with either, or both at
// once (as in the side-by-side comparison demo).
const EFFECTS = { css: cssEffect, js: jsEffect };

function getEffect(wrapper) {
  return EFFECTS[wrapper.dataset.effect] || cssEffect;
}

document.addEventListener("DOMContentLoaded", function () {
  function getAlignment(wrapper) {
    return wrapper.dataset.scrollAlignment || DEFAULT_ALIGNMENT;
  }

  function getAlignmentFraction(wrapper) {
    return alignmentFraction(getAlignment(wrapper));
  }

  function getScrollPadding(wrapper) {
    return (
      parseFloat(
        getComputedStyle(wrapper).getPropertyValue("--carousel-scroll-padding")
      ) || 0
    );
  }

  function getNoncurrentScale(wrapper) {
    return (
      parseFloat(
        getComputedStyle(wrapper).getPropertyValue("--noncurrent-scale")
      ) || 1
    );
  }

  function addSpacersToWrapper(wrapper) {
    const firstSpacer = document.createElement("div");
    const lastSpacer = document.createElement("div");
    firstSpacer.classList.add("spacer");
    lastSpacer.classList.add("spacer");
    wrapper.prepend(firstSpacer);
    wrapper.append(lastSpacer);
  }

  function randomDimension(min, max) {
    return Math.floor(Math.random() * (max - min + 1) + min) + "px";
  }

  function setItemTextContent(item, i, itemWidth, itemHeight) {
    let content = `Item ${i} (${itemWidth} × ${itemHeight})`;
    item.innerHTML = content;
  } // End setItemTextContent function

  function updateSpacers(wrapper, spacers, offsetLength, scrollAxis) {
    const firstSpacer = spacers[0];
    const lastSpacer = spacers[1];
    const items = wrapper.querySelectorAll(".carousel-item");
    const [firstItem, lastItem] = [
      items[0],
      items[items.length - 1] || items[0]
    ];
    const gapLength = parseFloat(getComputedStyle(wrapper).gap);
    const alignment = getAlignmentFraction(wrapper);
    const scrollPadding = getScrollPadding(wrapper);

    [firstSpacer, lastSpacer].forEach((spacer, index) => {
      // Each spacer only needs to make up the room on its own side of the
      // alignment point - e.g. with alignment="start" the leading spacer
      // shrinks to just scrollPadding (the first item's leading edge is
      // already reachable) while the trailing spacer grows to let the last
      // item reach it too.
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
      spacer.textContent = `Spacer (${spacer.offsetWidth}px × ${spacer.offsetHeight}px)`;
    });
  } // End updateSpacers function

  function setupPageIndicators(
    wrapper,
    offsetFromStart,
    offsetLength,
    scrollAxis
  ) {
    const controlsContainer = wrapper.closest(".carousel-with-controls");
    if (!controlsContainer) return;
    const pageControls = controlsContainer.querySelector(".page-controls");
    const items = wrapper.querySelectorAll(".carousel-item");

    pageControls.innerHTML = "";

    items.forEach((_, index) => {
      const dot = document.createElement("div");
      dot.classList.add("page-indicator-dot");
      if (index === 0) {
        dot.classList.add("current");
      }

      dot.addEventListener("click", function () {
        const targetItem = items[index];
        const scrollTarget = computeScrollTarget(
          wrapper,
          targetItem,
          offsetFromStart,
          offsetLength,
          getAlignmentFraction(wrapper),
          getScrollPadding(wrapper)
        );

        wrapper.scrollTo({
          [scrollAxis === "x" ? "left" : "top"]: scrollTarget,
          behavior: "smooth"
        });
      });

      pageControls.appendChild(dot);
    });
  } // End setupPageIndicators function

  function populateCarousel(
    wrapper,
    lastSpacer,
    offsetLength,
    offsetFromStart,
    scrollAxis,
    n,
    effect
  ) {
    for (let i = 0; i < n; i++) {
      const snapFixDiv = document.createElement("div");
      snapFixDiv.classList.add("carousel-item-snap-fix");

      const item = document.createElement("div");
      item.classList.add("carousel-item");
      effect.onItemCreated(item);
      // item.setAttribute("contenteditable", "true");

      if (wrapper.classList.contains("placeholder-boxes")) {
        const itemWidth = randomDimension(50, 300); /* min <> max width */
        const itemHeight = randomDimension(50, 300); /* min <> max height */
        setItemTextContent(
          item,
          i,
          itemWidth,
          itemHeight,
          undefined,
          undefined
        );

        item.style.width = itemWidth;
        item.style.height = itemHeight;
      } else if (wrapper.classList.contains("placeholder-images")) {
        const img = document.createElement("img");
        img.src = `https://source.unsplash.com/random?sig=${i}`;
        item.appendChild(img);
        item.style.width = "auto";
        item.style.height = "100%";
      }

      snapFixDiv.appendChild(item);
      wrapper.insertBefore(snapFixDiv, lastSpacer);

      item.addEventListener("click", function () {
        const scrollTarget = computeScrollTarget(
          wrapper,
          item,
          offsetFromStart,
          offsetLength,
          getAlignmentFraction(wrapper),
          getScrollPadding(wrapper)
        );

        wrapper.scrollTo({
          [scrollAxis === "x" ? "left" : "top"]: scrollTarget,
          behavior: "smooth"
        });
      }); // End click listener (scroll when adjacent item clicked)
      //
    } // End for loop

    updateSpacers(
      wrapper,
      wrapper.querySelectorAll(".spacer"),
      offsetLength,
      scrollAxis
    );
    setupPageIndicators(wrapper, offsetFromStart, offsetLength, scrollAxis);
  } // End populateCarousel function

  function updatePageIndicator(wrapper, currentIndex) {
    const controlsContainer = wrapper.closest(".carousel-with-controls");
    if (!controlsContainer) return;
    const dots = controlsContainer.querySelectorAll(".page-indicator-dot");
    dots.forEach((dot, index) => {
      dot.classList.toggle("current", index === currentIndex);
    });
  } // End updatePageIndicator function

  // Re-point a wrapper at a new alignment: keeps whichever item is currently
  // "current" under the cursor of the new alignment (no smooth scroll, so it
  // doesn't fight the user's next scroll gesture), then resizes the spacers
  // and redraws to match.
  function setAlignment(config, alignment) {
    const { wrapper, spacers, scrollDistance, offsetLength, offsetFromStart, scrollAxis, effect, ctx } = config;
    const items = wrapper.querySelectorAll(".carousel-item");
    const { anchors, scrollAnchor } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetLength,
      scrollDistance,
      getAlignmentFraction(wrapper),
      getScrollPadding(wrapper)
    );
    const currentIndex = computeCurrentIndex(
      computeCurrentProgress(anchors, scrollAnchor),
      items.length
    );
    wrapper.dataset.scrollAlignment = alignment;
    updateSpacers(wrapper, spacers, offsetLength, scrollAxis);
    effect.setup(ctx);

    const scrollTarget = computeScrollTarget(
      wrapper,
      items[currentIndex],
      offsetFromStart,
      offsetLength,
      getAlignmentFraction(wrapper),
      getScrollPadding(wrapper)
    );
    wrapper.scrollTo({
      [scrollAxis === "x" ? "left" : "top"]: scrollTarget,
      behavior: "instant"
    });

    effect.apply(ctx);
  } // End setAlignment function

  function setupCarousel(wrapper) {
    wrapper.dataset.scrollAlignment ||= DEFAULT_ALIGNMENT;
    const effect = getEffect(wrapper);
    const scrollAxis = wrapper.getAttribute("data-scroll-axis");
    const spacers = wrapper.querySelectorAll(".spacer");

    const scrollDistance = scrollAxis === "x" ? "scrollLeft" : "scrollTop";
    // e.g. wrapper[scrollDistance] = how far you've scrolled within the wrapper
    // (always positive number)

    const offsetLength = scrollAxis === "x" ? "offsetWidth" : "offsetHeight";
    // e.g. wrapper[offsetLength] = rendered length of the wrapper including padding, etc.
    // e.g. item[offsetLength] = rendered length of an item including padding, etc.
    // (length = width in x scroll, height in y scroll)

    const offsetFromStart = scrollAxis === "x" ? "offsetLeft" : "offsetTop";
    // e.g. item[offsetFromStart] = calculated distance an item is from its offset parent,
    // i.e. `left` in x scroll, `top` in y scroll

    const scrollSize = scrollAxis === "x" ? "scrollWidth" : "scrollHeight";
    // e.g. wrapper[scrollSize] = total scrollable content length, used (with
    // offsetLength) to normalize raw scroll offset into the 0%-100% range a
    // native scroll-timeline reports - see css-effect.js.

    // Bundles everything an effect module needs to read geometry and write
    // styles/page-dots for this one wrapper, so main.js and the effect
    // modules don't have to keep passing the same handful of args around.
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
      updatePageIndicator
    };

    populateCarousel(
      wrapper,
      spacers[1],
      offsetLength,
      offsetFromStart,
      scrollAxis,
      30,
      effect
    );

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
      updateSpacers(wrapper, spacers, offsetLength, scrollAxis);
      effect.setup(ctx);
      effect.apply(ctx);
    });

    window.addEventListener("resize", refreshGeometry);

    // Item geometry can also change with no window resize at all - most
    // commonly an image-based item whose intrinsic size arrives after
    // layout (see populateCarousel's placeholder-images branch) - which
    // would otherwise leave setup()'s cached anchors/breakpoints (see the
    // effect modules) stale until the next window resize or alignment
    // change. Observing every item directly catches that case too.
    const itemResizeObserver = new ResizeObserver(refreshGeometry);
    wrapper.querySelectorAll(".carousel-item").forEach((item) => itemResizeObserver.observe(item));
    //
    return {
      wrapper,
      spacers,
      scrollDistance,
      offsetLength,
      offsetFromStart,
      scrollAxis,
      effect,
      ctx
    };
  } // End setupCarousel function

  const carouselConfigs = [];

  document.querySelectorAll(".carousel-wrapper").forEach((wrapper) => {
    addSpacersToWrapper(wrapper);

    if (
      !wrapper.classList.contains("placeholder-boxes") &&
      !wrapper.classList.contains("placeholder-images")
    ) {
      wrapper.classList.add("placeholder-boxes");
    }

    carouselConfigs.push(setupCarousel(wrapper));
  });

  document.querySelectorAll('input[name="scroll-alignment"]').forEach((radio) => {
    radio.addEventListener("change", function () {
      if (!this.checked) return;
      carouselConfigs.forEach((config) => setAlignment(config, this.value));
    });
  });
  //
});
