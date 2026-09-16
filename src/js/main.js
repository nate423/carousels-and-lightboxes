import {
  transition,
  alignmentFraction,
  getItemMetrics,
  computeScrollTarget,
  computeSpacerLength,
  computeCurrentProgress,
  computeCurrentIndex,
  computeItemProgress,
  computeTranslations,
  computeAnimationRanges,
  computeItemFocus
} from "./carousel-math.js";

const DEFAULT_ALIGNMENT = "center";

// `animation-timing-function` (including the linear() control-point syntax)
// applies independently *within* each keyframe-to-keyframe segment, re-based
// to that segment's own local 0-1 - it can't shift *where* a keyframe's
// value actually falls across the overall range. Placing an item's peak at
// an arbitrary, per-item asymmetric position (see computeAnimationRanges'
// peakX) instead requires giving that item its own @keyframes rule with the
// "scale: 1" stop declared at that exact percentage. Every item needs a
// distinct, stable id for this (assigned once, in populateCarousel) and a
// shared stylesheet holding one generated rule per item, rebuilt whenever
// updateAnimationRanges recomputes geometry.
let nextFocusId = 0;
const focusKeyframeRules = new Map();
let focusKeyframeStyleEl = null;

function setItemFocusKeyframes(item, peakX) {
  if (!focusKeyframeStyleEl) {
    focusKeyframeStyleEl = document.createElement("style");
    document.head.appendChild(focusKeyframeStyleEl);
  }
  const name = `item-focus-${item.dataset.focusId}`;
  focusKeyframeRules.set(
    name,
    `@keyframes ${name} {
      0% { scale: var(--unfocused-scale); opacity: var(--unfocused-opacity); }
      ${peakX * 100}% { scale: 1; opacity: 1; }
      100% { scale: var(--unfocused-scale); opacity: var(--unfocused-opacity); }
    }`
  );
  focusKeyframeStyleEl.textContent = [...focusKeyframeRules.values()].join("\n");
  item.style.animationName = name;
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

  function getUnfocusedScale(wrapper) {
    return (
      parseFloat(
        getComputedStyle(wrapper).getPropertyValue("--unfocused-scale")
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

        // console.log(index, targetItem[offsetFromStart]);

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
    n
  ) {
    for (let i = 0; i < n; i++) {
      const snapFixDiv = document.createElement("div");
      snapFixDiv.classList.add("carousel-item-snap-fix");

      const item = document.createElement("div");
      item.classList.add("carousel-item");
      item.dataset.focusId = String(nextFocusId++);
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

  // Sets each item's `animation-range` from its own geometry, sized to the
  // real pixel gap to each neighboring anchor so the falloff reaches
  // exactly 0 exactly when that neighbor becomes current (asymmetric
  // whenever neighboring items differ in size, which they always do here).
  // That asymmetry means the item's own peak generally doesn't sit at the
  // range's arithmetic midpoint, so each item gets its own @keyframes rule
  // (see setItemFocusKeyframes) with the "scale: 1" stop placed at peakX
  // instead of a fixed 50%, keeping the peak exactly at this item's real
  // anchor crossing. Pure layout math - only needs recomputing when
  // geometry or alignment changes, not on scroll.
  //
  // Known limitation (verified, not a bug here): right after an item
  // crosses INTO a fresh animation-range - either this custom sub-range or
  // even the plain default `cover 0%`/`100%` - Chromium holds it clamped at
  // the boundary's keyframe value for several more pixels of real scroll
  // before it starts interpolating, even though the declared range and
  // computeItemFocus's prediction are both already correct at that point.
  // Confirmed at the painted-layout level (getBoundingClientRect, not just
  // getComputedStyle) and reproduces identically with no custom range at
  // all, so it's inherent to the browser's view-timeline boundary-crossing
  // detection, not something derivable from - or fixable via - our own
  // geometry. Not compensated for here: any pixel offset that "fixed" it
  // would just be hard-coding an unrelated, undocumented implementation
  // detail rather than a value that falls out of this math.
  function updateAnimationRanges(
    wrapper,
    scrollDistance,
    offsetLength,
    offsetFromStart
  ) {
    const items = wrapper.querySelectorAll(".carousel-item");
    const { anchors, lengths } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetLength,
      scrollDistance,
      getAlignmentFraction(wrapper),
      getScrollPadding(wrapper)
    );
    const ranges = computeAnimationRanges(
      anchors,
      lengths,
      wrapper[offsetLength],
      getAlignmentFraction(wrapper),
      getScrollPadding(wrapper)
    );

    items.forEach((item, i) => {
      const { start, end, peakX } = ranges[i];
      item.style.animationRange = `cover ${start * 100}% cover ${end * 100}%`;
      setItemFocusKeyframes(item, peakX);
    });
  } // End updateAnimationRanges function

  // Scale/opacity are driven entirely by the CSS scroll-driven animation on
  // .carousel-item now; this only computes the gap-compensating translate
  // (computeTranslations needs global state - every item's scale-loss
  // relative to the current item - which a per-item view-timeline can't
  // see) and the discrete current index for the page dots.
  function adjustStylesBasedOnProgress(
    wrapper,
    scrollDistance,
    offsetLength,
    offsetFromStart,
    scrollAxis
  ) {
    const items = wrapper.querySelectorAll(".carousel-item");
    const { anchors, lengths, scrollAnchor } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetLength,
      scrollDistance,
      getAlignmentFraction(wrapper),
      getScrollPadding(wrapper)
    );

    const currentProgress = computeCurrentProgress(anchors, scrollAnchor);
    const currentIndex = computeCurrentIndex(currentProgress, items.length);

    const focus = computeItemFocus(
      anchors,
      lengths,
      wrapper[offsetLength],
      getAlignmentFraction(wrapper),
      getScrollPadding(wrapper),
      scrollAnchor
    );
    const unfocusedScale = getUnfocusedScale(wrapper);
    const scales = focus.map((f) => transition(f, unfocusedScale, 1));

    const translations = computeTranslations(
      anchors,
      lengths,
      scales,
      currentProgress
    );

    items.forEach((item, i) => {
      item.style.translate =
        scrollAxis === "x"
          ? `${translations[i]}px 0` // X-axis translation
          : `0 ${translations[i]}px`; // Y-axis translation
    });

    updatePageIndicator(wrapper, currentIndex);
  } // End adjustStylesBasedOnProgress function

  // Pre-refactor implementation (scale/opacity/blur/translate all computed
  // and written as inline styles on every scroll event), kept only so the
  // `data-effect="js"` comparison carousel can run side by side with the
  // CSS scroll-driven version above.
  const LEGACY_UNFOCUSED_SCALE = 0.8;
  const LEGACY_UNFOCUSED_OPACITY = 0.5;
  const LEGACY_UNFOCUSED_BLUR = 0;

  function adjustStylesBasedOnProgressLegacyJS(
    wrapper,
    scrollDistance,
    offsetLength,
    offsetFromStart,
    scrollAxis
  ) {
    const items = wrapper.querySelectorAll(".carousel-item");
    const { anchors, lengths, scrollAnchor } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetLength,
      scrollDistance,
      getAlignmentFraction(wrapper),
      getScrollPadding(wrapper)
    );

    const currentProgress = computeCurrentProgress(anchors, scrollAnchor);
    const currentIndex = computeCurrentIndex(currentProgress, items.length);

    const scales = [];
    const opacities = [];
    const blurs = [];

    items.forEach((_, i) => {
      const itemProgress = computeItemProgress(currentProgress, i);
      scales.push(transition(itemProgress, LEGACY_UNFOCUSED_SCALE, 1));
      opacities.push(transition(itemProgress, LEGACY_UNFOCUSED_OPACITY, 1));
      blurs.push(transition(itemProgress, LEGACY_UNFOCUSED_BLUR, 0));
    });

    const translations = computeTranslations(
      anchors,
      lengths,
      scales,
      currentProgress
    );

    items.forEach((item, i) => {
      const translationAttribute =
        scrollAxis === "x"
          ? `translate3d(${translations[i]}px, 0, 0)`
          : `translate3d(0, ${translations[i]}px, 0)`;

      item.style.transform = `${translationAttribute} scale(${scales[i]})`;
      item.style.opacity = opacities[i];
      item.style.filter = `blur(${blurs[i]}px)`;
    });

    updatePageIndicator(wrapper, currentIndex);
  } // End adjustStylesBasedOnProgressLegacyJS function

  function isLegacyJS(wrapper) {
    return wrapper.dataset.effect === "js";
  }

  function applyScrollEffect(
    wrapper,
    scrollDistance,
    offsetLength,
    offsetFromStart,
    scrollAxis
  ) {
    const fn = isLegacyJS(wrapper)
      ? adjustStylesBasedOnProgressLegacyJS
      : adjustStylesBasedOnProgress;
    fn(wrapper, scrollDistance, offsetLength, offsetFromStart, scrollAxis);
  }

  // Re-point a wrapper at a new alignment: keeps whichever item is currently
  // "focused" under the cursor of the new alignment (no smooth scroll, so it
  // doesn't fight the user's next scroll gesture), then resizes the spacers
  // and redraws to match.
  function setAlignment(config, alignment) {
    const { wrapper, spacers, scrollDistance, offsetLength, offsetFromStart, scrollAxis } = config;
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
    if (!isLegacyJS(wrapper)) {
      updateAnimationRanges(wrapper, scrollDistance, offsetLength, offsetFromStart);
    }

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

    applyScrollEffect(wrapper, scrollDistance, offsetLength, offsetFromStart, scrollAxis);
  } // End setAlignment function

  function setupCarousel(wrapper) {
    wrapper.dataset.scrollAlignment ||= DEFAULT_ALIGNMENT;
    const scrollAxis = wrapper.getAttribute("data-scroll-axis");
    const spacers = wrapper.querySelectorAll(".spacer");
    const firstSpacer = spacers[0];
    const lastSpacer = spacers[1];

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

    populateCarousel(
      wrapper,
      spacers[1],
      offsetLength,
      offsetFromStart,
      scrollAxis,
      30
    );

    if (!isLegacyJS(wrapper)) {
      updateAnimationRanges(wrapper, scrollDistance, offsetLength, offsetFromStart);
    }

    applyScrollEffect(wrapper, scrollDistance, offsetLength, offsetFromStart, scrollAxis);

    wrapper.addEventListener("scroll", () =>
      applyScrollEffect(
        wrapper,
        scrollDistance,
        offsetLength,
        offsetFromStart,
        scrollAxis
      )
    );

    window.addEventListener("resize", () => {
      updateSpacers(wrapper, spacers, offsetLength, scrollAxis);
      if (!isLegacyJS(wrapper)) {
        updateAnimationRanges(wrapper, scrollDistance, offsetLength, offsetFromStart);
      }
    });
    //
    return {
      wrapper,
      spacers,
      scrollDistance,
      offsetLength,
      offsetFromStart,
      scrollAxis
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
