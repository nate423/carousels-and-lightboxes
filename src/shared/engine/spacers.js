import { computeSpacerSize } from "../carousel-math.js";

// The leading/trailing filler elements that let the first and last real item
// still reach the wrapper's alignment point - the scroll-snap analogue of
// `scroll-padding`, reimplemented because that property doesn't survive this
// trailing-edge workaround (see computeSpacerSize in carousel-math.js for the
// geometry). Created once and resized in place, rather than recreated, so
// callers can hold a stable reference to the trailing spacer as the
// insertion point for populated items.
export function createSpacers(wrapper, { getItems }) {
  const firstSpacer = document.createElement("div");
  const lastSpacer = document.createElement("div");
  firstSpacer.classList.add("spacer");
  lastSpacer.classList.add("spacer");
  wrapper.prepend(firstSpacer);
  wrapper.append(lastSpacer);

  function update() {
    const items = getItems();
    const [firstItem, lastItem] = [items[0], items[items.length - 1] || items[0]];
    const gapSize = parseFloat(getComputedStyle(wrapper).gap);

    [firstSpacer, lastSpacer].forEach((spacer, index) => {
      // Each spacer makes up the room on its own side of the anchor point -
      // see computeSpacerSize in carousel-math.js. Both take the same amount
      // at the centre, but each is measured against its own end item, which
      // is generally a different size.
      const item = index === 0 ? firstItem : lastItem;
      const size = Math.max(0, computeSpacerSize(wrapper.offsetWidth, item.offsetWidth, gapSize));
      spacer.style.width = size + "px";
    });
  }

  return { lastSpacer, update };
}
