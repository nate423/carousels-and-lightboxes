// The default carousel effect. The centered item is full size and fully
// opaque. Every other item is drawn at one smaller scale and one lower
// opacity (--noncurrent-scale, --noncurrent-opacity). An item changes
// between the two only while moving between the center and the next item
// over. Items also shift to close the gaps that shrinking opens, so the
// spacing between them stays even.
//
// Used by the scale-fade page and by both carousels on the filmstrip page.
//
// The browser draws the effect by itself: each item has an animation tied to
// the carousel's scroll position (a scroll timeline). setup() generates
// those animations. apply() runs on scroll, reports the current item, and
// draws the effect from JS in the few cases the animations can't (see paint).
//
// "Progress" throughout is the carousel's position in items: 3 means item 3
// is centered, 3.5 means halfway between items 3 and 4.
import {
  computeCurrentProgress,
  computeCurrentIndex,
  computeScrollAnchorForProgress,
  computeEdgeAnchors
} from "../carousel-math.js";
import { computeFrameBreakpoints, computeGapCompensatedFrame } from "./helpers/gap-compensation.js";
import { RuleSheet } from "./helpers/style-swap.js";
import { nextItemId } from "./helpers/item-id.js";

// Each carousel keeps its own generated stylesheets. The scroll-timeline
// polyfill (used on iOS 18 and Safari 17) only reads a stylesheet when it is
// inserted, so rebuilding one carousel's rules makes it re-read them. Kept
// separate, a resize of one carousel doesn't disturb another's running
// animations.
const stateByWrapper = new WeakMap();

function getWrapperState(wrapper) {
  let state = stateByWrapper.get(wrapper);
  if (!state) {
    state = {
      keyframeSheet: new RuleSheet(),
      // Each item's animation-name/-timeline/-range as a stylesheet rule. The
      // polyfill only finds these in stylesheets, not in inline styles.
      // Native engines read the inline styles set alongside them.
      positionSheet: new RuleSheet()
    };
    stateByWrapper.set(wrapper, state);
  }
  return state;
}

// Gives an item its own @keyframes, since every item draws something
// different at each point. `stops` are what the item draws at each point
// across the range.
//
// Scale and translate are one transform, and the whole effect runs on one
// timeline. On iOS 27, an item animated with separate scale and translate
// animations disappears as its full-size box nears the screen edge, while
// its shrunken shape is still on screen (#1). Translate comes before scale
// in the transform so it moves the item in screen pixels.
//
// Transform and opacity animate on the compositor, so the effect keeps moving
// when the main thread is busy.
//
// The rule is only queued here; setup() writes each stylesheet once, after
// all items, since every write reparses the whole sheet.
function setItemKeyframes(state, item, stops, animationRange) {
  const name = `item-effect-${item.dataset.itemId}`;
  const keyframes = stops
    .map(
      ({ percent, translate, scale, opacity }) =>
        `${percent}% { transform: translateX(${translate}px) scale(${scale}); opacity: ${opacity}; }`
    )
    .join("\n      ");
  state.keyframeSheet.set(name, `@keyframes ${name} {\n      ${keyframes}\n    }`);

  item.style.animationName = name;
  item.style.animationRange = animationRange;

  state.positionSheet.set(
    item.dataset.itemId,
    `.carousel-item[data-item-id="${item.dataset.itemId}"] {
      animation-name: ${name};
      animation-timeline: --carousel-scroll;
      animation-range: ${animationRange};
    }`
  );
}

function flushKeyframeStyles(state) {
  state.keyframeSheet.flush();
  state.positionSheet.flush();
}

// A page-wide unique id, which the generated rules select items by.
function onItemCreated(item) {
  item.dataset.itemId = nextItemId();
}

// Generates every item's animation from the carousel's layout. Runs when the
// layout changes, not on scroll.
function setup(ctx) {
  const { wrapper, getNoncurrentScale } = ctx;
  const state = getWrapperState(wrapper);
  const { items, anchors, sizes, wrapperAnchorPoint } = ctx.getGeometry();
  state.noncurrentScale = getNoncurrentScale(wrapper);
  state.noncurrentOpacity = parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-opacity"));

  // The breakpoints extend past both ends of the scroll range, to cover
  // overscroll, so the range is in scroll offsets (px) and can start below
  // 0. Breakpoints are measured at the carousel's center, which is
  // wrapperAnchorPoint px past the scroll offset.
  const { breakpoints, start, end } = computeFrameBreakpoints(anchors, sizes, state.noncurrentScale);
  const animationRange = `${start - wrapperAnchorPoint}px ${end - wrapperAnchorPoint}px`;
  const percentFor = (scrollAnchor) => (end > start ? ((scrollAnchor - start) / (end - start)) * 100 : 0);

  items.forEach((item, i) => {
    const stops = breakpoints.map(({ scrollAnchor, frame }) => ({
      percent: percentFor(scrollAnchor),
      translate: frame.translations[i],
      scale: frame.scales[i],
      opacity: opacityFor(state, frame.itemProgress[i])
    }));
    setItemKeyframes(state, item, stops, animationRange);
  });
  flushKeyframeStyles(state);

  const { before, after } = computeEdgeAnchors(anchors, sizes);
  state.extendedAnchors = [before, ...anchors, after];
}

function opacityFor(state, itemProgress) {
  return state.noncurrentOpacity + itemProgress * (1 - state.noncurrentOpacity);
}

// Draws the effect from JS, as !important inline styles, which outrank the
// animations. Used for the frames the animations can't show:
//   - when another carousel drives this one past either end: its scroll
//     position stops at the end, so the animations stop there too;
//   - the frame after this carousel stops following another one's timeline
//     (see timelinesBehind in carousel-engine.js), when its own animations
//     are a frame out of date.
// Removed by clearPaint as soon as the animations are right again.
function paint(state, items, anchors, sizes, currentProgress, scrollError) {
  const styles = frameStyles(state, anchors, sizes, currentProgress, scrollError);
  items.forEach((item, i) => {
    Object.entries(styles[i]).forEach(([property, value]) => item.style.setProperty(property, value, "important"));
  });
  state.painting = true;
}

// What each item draws at one progress, as CSS properties. Used by paint and
// followFrames. `scrollError` is how far to shift every item, in screen
// pixels, to show this progress from where the carousel is really scrolled.
// It goes in translate, which applies outside scale. Transform is set to
// none to hide the scroll-driven animation's own transform.
function frameStyles(state, anchors, sizes, currentProgress, scrollError) {
  const { scales, itemProgress, translations } = computeGapCompensatedFrame(
    anchors,
    sizes,
    state.noncurrentScale,
    currentProgress
  );
  return scales.map((scale, i) => ({
    scale: String(scale),
    opacity: String(opacityFor(state, itemProgress[i])),
    translate: `${translations[i] + scrollError}px 0`,
    transform: "none"
  }));
}

// Keyframes for drawing this carousel on another carousel's timeline while
// it follows that one (see linked-scrolling/timeline-follow.js): one set per
// item, at each progress the engine samples.
function followFrames(ctx, samples) {
  const { items, anchors, sizes } = ctx.getGeometry();
  const state = getWrapperState(ctx.wrapper);
  const frames = samples.map(({ progress, scrollError }) => frameStyles(state, anchors, sizes, progress, scrollError));
  return Array.from(items, (item, i) => ({
    target: item,
    keyframes: frames.map((styles) => styles[i])
  }));
}

function clearPaint(state, items) {
  if (!state.painting) return;
  items.forEach((item) => {
    item.style.removeProperty("scale");
    item.style.removeProperty("opacity");
    item.style.removeProperty("translate");
    item.style.removeProperty("transform");
  });
  state.painting = false;
}

// Runs on every scroll frame. Reports the current item, and switches between
// the animations and paint.
function apply(ctx) {
  const { wrapper, getScrollSource, getDrivenProgress, getGeometry, currentScrollAnchor, onProgress } = ctx;
  // Cached layout, shared with the engine. Measuring every item here would
  // be too slow for every frame.
  const { items, anchors, sizes } = getGeometry();
  const state = getWrapperState(wrapper);
  const scrollAnchor = currentScrollAnchor();

  // "Driven" means another carousel is setting this one's position. It asks
  // for an exact progress, but scroll positions are whole pixels, so the
  // animations show a slightly different one. That fraction of a pixel makes
  // the carousel step instead of glide. --scroll-error shifts the items by
  // the difference (see .scale-fade .carousel-item in scale-fade.css). It is
  // removed when the carousel scrolls itself.
  const isDriven = getScrollSource() === "driven";
  const currentProgress = isDriven ? getDrivenProgress() : computeCurrentProgress(anchors, scrollAnchor);

  // Past either end, progress is measured against an imaginary item beyond
  // each end item, spaced like the real ones (computeEdgeAnchors), so the
  // carousel keeps moving at the same rate. Never painted while following another
  // carousel's timeline: that draws this carousel, and paint would hide it.
  const overscrolled = isDriven && (currentProgress < 0 || currentProgress > items.length - 1);
  if (!ctx.isOnTimeline() && (overscrolled || ctx.timelinesBehind())) {
    const scrollError = scrollAnchor - computeScrollAnchorForProgress(state.extendedAnchors, currentProgress + 1);
    wrapper.style.setProperty("--scroll-error", "0px");
    paint(state, items, anchors, sizes, currentProgress, scrollError);
  } else {
    clearPaint(state, items);
    if (isDriven) {
      wrapper.style.setProperty(
        "--scroll-error",
        (scrollAnchor - computeScrollAnchorForProgress(state.extendedAnchors, currentProgress + 1)).toFixed(3) + "px"
      );
    } else if (wrapper.style.getPropertyValue("--scroll-error")) {
      wrapper.style.removeProperty("--scroll-error");
    }
  }

  onProgress?.(computeCurrentIndex(currentProgress, items.length), currentProgress);
}

export const scaleFadeEffect = { onItemCreated, setup, apply, followFrames };
