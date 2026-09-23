// The scale-fade look with the scale removed: the current item at full
// opacity, its neighbours faded, nothing moving. Used where a carousel is
// context rather than the subject - e.g. the iOS scrubber page's main
// carousel, which just shows what the strip is scrubbing.
//
// Same falloff as scale-fade, for the same reason: each item's animation
// range is clamped to its neighbouring anchors, so it reaches full fade
// exactly as that neighbour becomes current, whatever their sizes. That's
// also why each item needs its own generated @keyframes rule instead of a
// shared one. The old view-timeline ranges are converted to scroll pixels
// so the visual falloff is unchanged, without an item-local timeline.
//
// No gap-compensation needed: nothing here changes an item's size, so no
// gap ever opens between neighbours.
import { computeCurrentProgress, computeCurrentIndex, computeAnimationRanges, transition } from "../carousel-math.js";
import { RuleSheet } from "./helpers/style-swap.js";
import { nextItemId } from "./helpers/item-id.js";

const stateByWrapper = new WeakMap();

// One set of generated rules per wrapper, not per page - see scale-fade.js
// for what goes wrong when carousels share them.
function getWrapperState(wrapper) {
  let state = stateByWrapper.get(wrapper);
  if (!state) {
    state = { keyframeSheet: new RuleSheet(), positionSheet: new RuleSheet() };
    stateByWrapper.set(wrapper, state);
  }
  return state;
}

function onItemCreated(item) {
  item.dataset.itemId = nextItemId();
}

function setup(ctx) {
  const { wrapper } = ctx;
  const state = getWrapperState(wrapper);
  const { items, anchors, sizes, wrapperAnchorPoint } = ctx.getGeometry();
  const ranges = computeAnimationRanges(anchors, sizes, wrapper.offsetWidth);

  items.forEach((item, i) => {
    const { start, end, peakX } = ranges[i];
    const name = `item-fade-${item.dataset.itemId}`;
    state.keyframeSheet.set(
      name,
      `@keyframes ${name} {
      0% { transform: translateX(0px); opacity: var(--noncurrent-opacity); }
      ${peakX * 100}% { transform: translateX(0px); opacity: 1; }
      100% { transform: translateX(0px); opacity: var(--noncurrent-opacity); }
    }`
    );

    const span = wrapper.offsetWidth + sizes[i];
    const origin = anchors[i] - wrapperAnchorPoint;
    const range = `${origin + (start - 0.5) * span}px ${origin + (end - 0.5) * span}px`;
    item.style.animationName = name;
    item.style.animationTimeline = "--carousel-scroll";
    item.style.animationRange = range;

    // Also as a real selector rule: the scroll-timeline polyfill can't see
    // these as inline styles.
    state.positionSheet.set(
      item.dataset.itemId,
      `.carousel-item[data-item-id="${item.dataset.itemId}"] {
      animation-name: ${name};
      animation-timeline: --carousel-scroll;
      animation-range: ${range};
    }`
    );
  });

  state.keyframeSheet.flush();
  state.positionSheet.flush();
  state.noncurrentOpacity = parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-opacity"));
}

// The timelines draw everything; this only reports which item is current,
// since that's the one thing no timeline can hand back to JS.
function apply(ctx) {
  const { getGeometry, currentScrollAnchor, onProgress } = ctx;
  if (!onProgress) return;
  const { items, anchors } = getGeometry();
  const currentProgress = computeCurrentProgress(anchors, currentScrollAnchor());
  onProgress(computeCurrentIndex(currentProgress, items.length), currentProgress);
}

// Following on another carousel's timeline (see
// linked-scrolling/timeline-follow.js): each item's opacity at each sample,
// and the distance between this carousel's scroll and where it is being
// shown, as a transform. The static translate correction is neutralised.
function followFrames(ctx, samples) {
  const { items } = ctx.getGeometry();
  const { noncurrentOpacity } = getWrapperState(ctx.wrapper);
  return Array.from(items, (item, i) => ({
    target: item,
    keyframes: samples.map(({ progress, scrollError }) => ({
      opacity: String(transition(Math.max(1 - Math.abs(progress - i), 0), noncurrentOpacity, 1)),
      translate: "none",
      transform: `translateX(${scrollError}px)`
    }))
  }));
}

export const fadeEffect = { onItemCreated, setup, apply, followFrames };
