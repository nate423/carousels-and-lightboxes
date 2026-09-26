// The scale-fade effect with the scale removed: the current item at full
// opacity, its neighbours faded, nothing moving. Used where a carousel is
// context rather than the subject - e.g. the iOS scrubber page's main
// carousel, which just shows what the strip is scrubbing.
//
// Same falloff as scale-fade, for the same reason: each item's animation
// range is clamped to its neighbouring anchors, so it reaches full fade
// exactly as that neighbour becomes current, whatever their sizes. That's
// also why each item needs its own generated @keyframes rule instead of a
// shared one - see scale-fade.js's header for the mechanics, which this
// effect shares.
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

    // Also as a real selector rule: the scroll-timeline polyfill can't see
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
  state.noncurrentOpacity = parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-opacity"));
}

// Opacity at `progress` for item i - the same falloff the timelines draw.
function opacityAt(state, i, progress) {
  return transition(Math.max(1 - Math.abs(progress - i), 0), state.noncurrentOpacity, 1);
}

// The timelines draw everything, except while another carousel drives this
// one and no timeline laid across that carousel is drawing it yet: a scroll
// position written from script only reaches this carousel's own timelines
// on the next frame, so for that frame they would draw where it was. Then
// the opacity is set from script, at the progress it was driven to, until
// something moves it for its own reasons. Otherwise this only reports which
// item is current, since that's the one thing no timeline can hand back to
// JS.
function apply(ctx) {
  const { getGeometry, currentScrollAnchor, onProgress } = ctx;
  const state = getWrapperState(ctx.wrapper);
  const { items, anchors } = getGeometry();

  if (ctx.getScrollSource() === "driven" && !ctx.isOnTimeline()) {
    const progress = ctx.getDrivenProgress();
    items.forEach((item, i) => item.style.setProperty("opacity", String(opacityAt(state, i, progress)), "important"));
    state.painting = true;
  } else if (state.painting) {
    items.forEach((item) => item.style.removeProperty("opacity"));
    state.painting = false;
  }

  if (!onProgress) return;
  const currentProgress = computeCurrentProgress(anchors, currentScrollAnchor());
  onProgress(computeCurrentIndex(currentProgress, items.length), currentProgress);
}

// Following on another carousel's timeline (see
// linked-scrolling/timeline-follow.js): each item's opacity at each sample,
// and the distance between this carousel's scroll and where it is being
// shown, as a translate - transform held at none so the stylesheet's own
// correction stays out of it.
function followFrames(ctx, samples) {
  const { items } = ctx.getGeometry();
  const state = getWrapperState(ctx.wrapper);
  return Array.from(items, (item, i) => ({
    target: item,
    keyframes: samples.map(({ progress, scrollError }) => ({
      opacity: String(opacityAt(state, i, progress)),
      translate: `${scrollError}px 0`,
      transform: "none"
    }))
  }));
}

export const fadeEffect = { onItemCreated, setup, apply, followFrames };
