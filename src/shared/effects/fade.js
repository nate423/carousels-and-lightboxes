// The scale-fade look with the scale taken out: the current item at full
// opacity, its neighbours faded, and nothing moving. Used where a carousel is
// context rather than the subject - the iOS scrubber page, whose main carousel
// is there to show what the strip is scrubbing.
//
// Same falloff as scale-fade, and for the same reason: each item's animation
// range is clamped to its own neighbouring anchors, so an item reaches full
// fade exactly as its neighbour becomes current, whatever the two sizes are.
// That clamping is what puts an item's peak somewhere other than the middle of
// its range, which is why each item still needs a generated @keyframes rule of
// its own (see scale-fade-effect.js's header for the mechanics, which this
// shares).
//
// What it does not need is gap-compensation.js. Nothing here changes an item's
// drawn size, so no gap opens between neighbours and there is nothing to close.
import { computeCurrentProgress, computeCurrentIndex, computeAnimationRanges } from "../carousel-math.js";
import { RuleSheet } from "./style-swap.js";

let nextItemId = 0;
const stateByWrapper = new WeakMap();

// One set of generated rules per wrapper, not per page - see
// scale-fade-effect.js for what goes wrong when carousels share them.
function getWrapperState(wrapper) {
  let state = stateByWrapper.get(wrapper);
  if (!state) {
    state = { keyframeSheet: new RuleSheet(), positionSheet: new RuleSheet() };
    stateByWrapper.set(wrapper, state);
  }
  return state;
}

function onItemCreated(item) {
  item.dataset.itemId = String(nextItemId++);
}

function setup(ctx) {
  const { wrapper } = ctx;
  const state = getWrapperState(wrapper);
  const { items, anchors, sizes } = ctx.getGeometry();
  const ranges = computeAnimationRanges(anchors, sizes, wrapper.offsetWidth);

  items.forEach((item, i) => {
    const { start, end, peakX } = ranges[i];
    const name = `item-fade-${item.dataset.itemId}`;
    state.keyframeSheet.set(
      name,
      `@keyframes ${name} {
      0% { opacity: var(--noncurrent-opacity); }
      ${peakX * 100}% { opacity: 1; }
      100% { opacity: var(--noncurrent-opacity); }
    }`
    );

    const range = `cover ${start * 100}% cover ${end * 100}%`;
    item.style.animationName = name;
    item.style.animationTimeline = "--item-reveal";
    item.style.animationRange = range;

    // Also as a real selector rule: the scroll-timeline polyfill cannot see
    // these as inline styles.
    state.positionSheet.set(
      item.dataset.itemId,
      `.carousel-item[data-item-id="${item.dataset.itemId}"] {
      animation-name: ${name};
      animation-timeline: --item-reveal;
      animation-range: ${range};
    }`
    );
  });

  state.keyframeSheet.flush();
  state.positionSheet.flush();
}

// The timelines draw everything; this only reports which item is current,
// which no timeline can hand back to JS.
function apply(ctx) {
  const { getGeometry, currentScrollAnchor, onProgress } = ctx;
  if (!onProgress) return;
  const { items, anchors } = getGeometry();
  const currentProgress = computeCurrentProgress(anchors, currentScrollAnchor());
  onProgress(computeCurrentIndex(currentProgress, items.length), currentProgress);
}

export const fadeEffect = { onItemCreated, setup, apply };
