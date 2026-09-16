import {
  transition,
  alignmentFraction,
  getItemMetrics,
  computeScrollTarget,
  computeCurrentProgress,
  computeCurrentIndex,
  computeItemProgress,
  computeTranslations
} from "./carousel-math.js";

const UNFOCUSED_SCALE = 0.8;
const UNFOCUSED_OPACITY = 0.5;
const UNFOCUSED_BLUR = 0; // currently a no-op; raise above 0 to enable
const DEFAULT_ALIGNMENT = "center";

document.addEventListener("DOMContentLoaded", function () {
  function getAlignment(wrapper) {
    return wrapper.dataset.scrollAlignment || DEFAULT_ALIGNMENT;
  }

  function getAlignmentFraction(wrapper) {
    return alignmentFraction(getAlignment(wrapper));
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
    // Each spacer only needs to make up the room on its own side of the
    // alignment point - e.g. with alignment="start" the leading spacer
    // collapses to ~0 (the first item's leading edge is already reachable)
    // while the trailing spacer grows to let the last item reach it too.
    const calcSpacerLength = (item, edgeFraction) =>
      Math.max(0, (wrapper[offsetLength] - item[offsetLength]) * edgeFraction - gapLength);

    [firstSpacer, lastSpacer].forEach((spacer, index) => {
      const edgeFraction = index === 0 ? alignment : 1 - alignment;
      const length = calcSpacerLength(
        index === 0 ? firstItem : lastItem,
        edgeFraction
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
    const carouselWrapper = document.querySelector(
      ".carousel-with-controls .carousel-wrapper"
    );
    const pageControls = document.querySelector(
      ".carousel-with-controls .page-controls"
    );
    const items = carouselWrapper.querySelectorAll(".carousel-item");

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
          getAlignmentFraction(wrapper)
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
          getAlignmentFraction(wrapper)
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

  function updatePageIndicator(currentIndex) {
    const dots = document.querySelectorAll(
      ".carousel-with-controls .page-controls .page-indicator-dot"
    );
    dots.forEach((dot, index) => {
      dot.classList.toggle("current", index === currentIndex);
    });
  } // End updatePageIndicator function

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
      getAlignmentFraction(wrapper)
    );

    const currentProgress = computeCurrentProgress(anchors, scrollAnchor);
    const currentIndex = computeCurrentIndex(currentProgress, items.length);

    const scales = [];
    const opacities = [];
    const blurs = [];

    items.forEach((_, i) => {
      const itemProgress = computeItemProgress(currentProgress, i);
      scales.push(transition(itemProgress, UNFOCUSED_SCALE, 1));
      opacities.push(transition(itemProgress, UNFOCUSED_OPACITY, 1));
      blurs.push(transition(itemProgress, UNFOCUSED_BLUR, 0));
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
          ? `translate3d(${translations[i]}px, 0, 0)` // X-axis translation
          : `translate3d(0, ${translations[i]}px, 0)`; // Y-axis translation

      item.style.transform = `${translationAttribute} scale(${scales[i]})`;
      item.style.opacity = opacities[i];
      item.style.filter = `blur(${blurs[i]}px)`;
    });

    updatePageIndicator(currentIndex);
  } // End adjustStylesBasedOnProgress function

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
      getAlignmentFraction(wrapper)
    );
    const currentIndex = computeCurrentIndex(
      computeCurrentProgress(anchors, scrollAnchor),
      items.length
    );
    wrapper.dataset.scrollAlignment = alignment;
    updateSpacers(wrapper, spacers, offsetLength, scrollAxis);

    const scrollTarget = computeScrollTarget(
      wrapper,
      items[currentIndex],
      offsetFromStart,
      offsetLength,
      getAlignmentFraction(wrapper)
    );
    wrapper.scrollTo({
      [scrollAxis === "x" ? "left" : "top"]: scrollTarget,
      behavior: "instant"
    });

    adjustStylesBasedOnProgress(
      wrapper,
      scrollDistance,
      offsetLength,
      offsetFromStart,
      scrollAxis
    );
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

    adjustStylesBasedOnProgress(
      wrapper,
      scrollDistance,
      offsetLength,
      offsetFromStart,
      scrollAxis
    );

    wrapper.addEventListener("scroll", () =>
      adjustStylesBasedOnProgress(
        wrapper,
        scrollDistance,
        offsetLength,
        offsetFromStart,
        scrollAxis
      )
    );

    window.addEventListener("resize", () =>
      updateSpacers(wrapper, spacers, offsetLength, scrollAxis)
    );
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
