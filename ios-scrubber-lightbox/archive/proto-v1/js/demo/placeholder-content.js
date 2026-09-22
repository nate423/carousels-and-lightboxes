function randomDimension(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min) + "px";
}

// Demo-page-specific item content (random/uniform placeholder boxes, or a
// placeholder image) - this is exactly the kind of thing carousel-engine.js
// used to know about and no longer does; it just takes a createItem
// callback.
export function createPlaceholderItem(wrapper) {
  return function (item, i) {
    if (wrapper.classList.contains("placeholder-images")) {
      const img = document.createElement("img");
      img.src = `https://source.unsplash.com/random?sig=${i}`;
      item.appendChild(img);
      item.style.width = "auto";
      item.style.height = "100%";
      return;
    }

    const uniform = wrapper.classList.contains("uniform-size");
    const itemWidth = uniform ? "100px" : randomDimension(50, 300); /* min <> max width */
    const itemHeight = uniform ? "100px" : randomDimension(50, 300); /* min <> max height */
    item.textContent = `Item ${i} (${itemWidth} × ${itemHeight})`;
    item.style.width = itemWidth;
    item.style.height = itemHeight;
  };
}
