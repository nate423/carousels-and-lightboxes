document.addEventListener("DOMContentLoaded", function () {
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

  function interpolateOpacity(progress) {
    return 0.5 + progress * 0.5;
  }

  function interpolateBlur(progress) {
    return (1 - progress) * 0 + "px";
  }

  function interpolateScale(progress) {
    return 0.8 + progress * 0.2;
    // return 1;
  }

  function updateSpacers(wrapper, spacers, offsetLength, scrollAxis) {
    const firstSpacer = spacers[0];
    const lastSpacer = spacers[1];
    const items = wrapper.querySelectorAll(".carousel-item");
    const [firstItem, lastItem] = [
      items[0],
      items[items.length - 1] || items[0]
    ];
    const gapLength = parseFloat(getComputedStyle(wrapper).gap);
    const calcSpacerLength = (item) =>
      (wrapper[offsetLength] - item[offsetLength]) / 2 - gapLength;

    [firstSpacer, lastSpacer].forEach((spacer, index) => {
      const length = calcSpacerLength(index === 0 ? firstItem : lastItem);
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
        const scrollTarget =
          targetItem[offsetFromStart] -
          wrapper[offsetFromStart] -
          (wrapper[offsetLength] - targetItem[offsetLength]) / 2;

        // console.log(index, targetItem[offsetFromStart]);

        wrapper.scrollTo({
          [scrollAxis === "x" ? "left" : "top"]: scrollTarget,
          behavior: "smooth"
        });
      });

      pageControls.appendChild(dot);
    });
  } // End setupPageIndicators function

  function calculateProgress(
    wrapper,
    scrollCenter,
    offsetFromStart,
    offsetLength,
    items,
    item,
    i
  ) {
    const itemOffsetFromWrapperStart =
      item[offsetFromStart] - wrapper[offsetFromStart];
    const itemCenter = itemOffsetFromWrapperStart + item[offsetLength] / 2;
    const distanceFromCenter = Math.abs(scrollCenter - itemCenter);

    let nextItemCenterDistance = 0;
    if (i < items.length - 1) {
      const nextItem = items[i + 1];
      const nextItemOffsetFromWrapperStart =
        nextItem[offsetFromStart] - wrapper[offsetFromStart];
      const nextItemCenter =
        nextItemOffsetFromWrapperStart + nextItem[offsetLength] / 2;
      nextItemCenterDistance = Math.abs(itemCenter - nextItemCenter);
    }

    let prevItemCenterDistance = 0;
    if (i > 0) {
      const prevItem = items[i - 1];
      const prevItemOffsetFromWrapperStart =
        prevItem[offsetFromStart] - wrapper[offsetFromStart];
      const prevItemCenter =
        prevItemOffsetFromWrapperStart + prevItem[offsetLength] / 2;
      prevItemCenterDistance = Math.abs(itemCenter - prevItemCenter);
    }

    let transitionDistance;
    if (i === 0) {
      transitionDistance = nextItemCenterDistance;
      // First item overshoot mirrors next item distance
    } else if (i === items.length - 1) {
      transitionDistance = prevItemCenterDistance;
      // Last item overshoot mirrors prev item distance
    } else {
      transitionDistance =
        scrollCenter > itemCenter
          ? nextItemCenterDistance
          : prevItemCenterDistance;
      // Other items use the direction-specific distance
    }

    return 1 - Math.min(distanceFromCenter / transitionDistance, 1);
    //
  } // End calculateProgress function

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
        const scrollTarget =
          item[offsetFromStart] -
          wrapper[offsetFromStart] -
          (wrapper[offsetLength] - item[offsetLength]) / 2;

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
    const scrollCenter = wrapper[scrollDistance] + wrapper[offsetLength] / 2;
    const items = wrapper.querySelectorAll(".carousel-item");

    let centeredItemIndex = null;
    let smallestDistanceFromCenter = Infinity;

    // forEach - Set smallestDistanceFromCenter and centeredItemIndex
    items.forEach((item, i) => {
      const itemOffsetFromWrapperStart =
        item[offsetFromStart] - wrapper[offsetFromStart];
      const itemCenter = itemOffsetFromWrapperStart + item[offsetLength] / 2;
      const distanceFromCenter = Math.abs(scrollCenter - itemCenter);
      if (distanceFromCenter < smallestDistanceFromCenter) {
        smallestDistanceFromCenter = distanceFromCenter;
        centeredItemIndex = i;
      }
    });

    let accumulatedScaleDiffBefore = new Array(items.length).fill(0);
    let accumulatedScaleDiffAfter = 0;

    // forEach - Accumulate scale differences to maintain consistent gap
    items.forEach((item, i) => {
      const progress = calculateProgress(
        wrapper,
        scrollCenter,
        offsetFromStart,
        offsetLength,
        items,
        item,
        i
      );

      const itemOffsetFromWrapperStart =
        item[offsetFromStart] - wrapper[offsetFromStart];
      const itemCenter = itemOffsetFromWrapperStart + item[offsetLength] / 2;

      const scale = interpolateScale(progress);
      const itemScaledLength = item[offsetLength] * scale;
      const scaleDiff = item[offsetLength] - itemScaledLength;

      item.scaleDiff = scaleDiff;

      if (itemCenter < scrollCenter) {
        for (let j = 0; j <= i; j++) {
          accumulatedScaleDiffBefore[j] += scaleDiff;
        }
      }
    });

    // forEach - Interpolate styles based on progress
    items.forEach((item, i) => {
      const progress = calculateProgress(
        wrapper,
        scrollCenter,
        offsetFromStart,
        offsetLength,
        items,
        item,
        i
      );
      const itemOffsetFromWrapperStart =
        item[offsetFromStart] - wrapper[offsetFromStart];
      const itemCenter = itemOffsetFromWrapperStart + item[offsetLength] / 2;
      const distanceFromCenter = Math.abs(scrollCenter - itemCenter);

      const opacity = interpolateOpacity(progress);
      const blur = interpolateBlur(progress);
      const scale = interpolateScale(progress);

      const itemScaledLength = item[offsetLength] * scale;
      const scaleDiff = item[offsetLength] - itemScaledLength;
      const itemToSelfEdge = scaleDiff / 2;

      let translation = 0;

      if (itemCenter < scrollCenter) {
        translation = accumulatedScaleDiffBefore[i] - itemToSelfEdge;
      } else if (itemCenter > scrollCenter) {
        accumulatedScaleDiffAfter += scaleDiff;
        translation = -accumulatedScaleDiffAfter + scaleDiff - itemToSelfEdge;
      }

      const translationAttribute =
        scrollAxis === "x"
          ? `translate3d(${translation}px, 0, 0)` // X-axis translation
          : `translate3d(0, ${translation}px, 0)`; // Y-axis translation

      item.style.transform = `${translationAttribute} scale(${scale})`;
      item.style.opacity = opacity;
      item.style.filter = `blur(${blur})`;
      //
    }); // End forEach

    updatePageIndicator(centeredItemIndex);
    //
  } // End adjustStylesBasedOnProgress function

  function setupCarousel(wrapper) {
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
  } // End setupCarousel function

  document.querySelectorAll(".carousel-wrapper").forEach((wrapper) => {
    addSpacersToWrapper(wrapper);

    if (
      !wrapper.classList.contains("placeholder-boxes") &&
      !wrapper.classList.contains("placeholder-images")
    ) {
      wrapper.classList.add("placeholder-boxes");
    }

    setupCarousel(wrapper);
  });
  //
});
