// One of two interchangeable navigator UIs for a carousel (see
// thumbnail-scrubber.js for the other) - a carousel uses at most one at a
// time. Reads the carousel's progress via the same onProgress hook the
// effect modules already call every scroll frame, and commands it via the
// same goToIndex every other click-to-scroll site uses.
export function attachPageControls(carousel, container) {
  const items = carousel.getItems();
  container.innerHTML = "";

  const dots = [];
  items.forEach((_, index) => {
    const dot = document.createElement("div");
    dot.classList.add("page-indicator-dot");
    if (index === 0) dot.classList.add("current");
    dot.addEventListener("click", () => carousel.goToIndex(index, { behavior: "smooth" }));
    container.appendChild(dot);
    dots.push(dot);
  });

  carousel.setOnProgress((currentIndex) => {
    dots.forEach((dot, index) => dot.classList.toggle("current", index === currentIndex));
  });
}
