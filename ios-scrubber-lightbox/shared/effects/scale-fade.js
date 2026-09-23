// Scale, gap compensation, and opacity share one scroll timeline. Keeping
// animated geometry in one explicit transform avoids premature edge culling
// observed with separate scale/translate animations on iOS 27 (#1).
import {
  computeCurrentProgress, computeCurrentIndex,
  computeScrollAnchorForProgress, computeEdgeAnchors
} from "../carousel-math.js";
import { computeGapCompensatedFrame } from "./helpers/gap-compensation.js";
import { singleTransformFrames } from "./helpers/single-transform-frames.js";
import { RuleSheet } from "./helpers/style-swap.js";
import { nextItemId } from "./helpers/item-id.js";

const stateByWrapper = new WeakMap();
function getWrapperState(wrapper) {
  let state = stateByWrapper.get(wrapper);
  if (!state) {
    state = { sheet: new RuleSheet() };
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
  state.noncurrentScale = ctx.getNoncurrentScale(wrapper);
  state.noncurrentOpacity = parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-opacity"));
  const { start, end, frames } = singleTransformFrames(
    anchors, sizes, wrapper.offsetWidth, state.noncurrentScale, state.noncurrentOpacity
  );
  const range = `${start - wrapperAnchorPoint}px ${end - wrapperAnchorPoint}px`;
  items.forEach((item, i) => {
    const name = `item-current-${item.dataset.itemId}`;
    // Real rules also let the scroll-timeline polyfill discover the effect.
    state.sheet.set(name, `
      @keyframes ${name} {
        ${frames[i].map((frame) => `${frame.percent}% {
          transform: translateX(${frame.translate}px) scale(${frame.scale});
          opacity: ${frame.opacity};
        }`).join("\n")}
      }
      .scale-fade .carousel-item[data-item-id="${item.dataset.itemId}"] {
        animation-name: ${name};
        animation-timeline: --carousel-scroll;
        animation-range: ${range};
      }
    `);
  });
  state.sheet.flush();
  const { before, after } = computeEdgeAnchors(anchors, sizes);
  state.extendedAnchors = [before, ...anchors, after];
}

// Past either end while driven, the progress asked for is somewhere this
// carousel's own scroll can't go - it stops at 0 or maxScroll - so the
// timelines, which only ever see that scroll, hold the end item at full.
// The look is painted from JS instead, for just those frames: !important,
// because that is what outranks a running animation, and taken off again
// the moment the progress is back in range, where the timelines already
// agree with it.
//
// The error is included in translateX before scale, so it stays in screen
// pixels. The separate static translate correction is neutralised here.
function paintOverscroll(state, items, anchors, sizes, currentProgress, scrollError) {
  const styles = frameStyles(state, anchors, sizes, currentProgress, scrollError);
  items.forEach((item, i) => {
    Object.entries(styles[i]).forEach(([property, value]) => item.style.setProperty(property, value, "important"));
  });
  state.paintingOverscroll = true;
}

// The whole look at one progress, as what each item draws. Painted directly
// past the ends (above), and keyframed across a leader's timeline while
// following one (followFrames, below).
function frameStyles(state, anchors, sizes, currentProgress, scrollError) {
  const { scales, itemProgress, translations } = computeGapCompensatedFrame(
    anchors,
    sizes,
    state.noncurrentScale,
    currentProgress
  );
  return scales.map((scale, i) => ({
    transform: `translateX(${translations[i] + scrollError}px) scale(${scale})`,
    opacity: String(state.noncurrentOpacity + itemProgress[i] * (1 - state.noncurrentOpacity)),
    translate: "none"
  }));
}

// Follower frames use the same transform order as the native effect.
// Their translateX includes the full scroll error; neutralise the static
// correction so it is not applied twice.
function followFrames(ctx, samples) {
  const { items, anchors, sizes } = ctx.getGeometry();
  const state = getWrapperState(ctx.wrapper);
  const frames = samples.map(({ progress, scrollError }) => frameStyles(state, anchors, sizes, progress, scrollError));
  return Array.from(items, (item, i) => ({
    target: item,
    keyframes: frames.map((styles) => styles[i])
  }));
}

function clearOverscroll(state, items) {
  if (!state.paintingOverscroll) return;
  items.forEach((item) => {
    item.style.removeProperty("transform");
    item.style.removeProperty("opacity");
    item.style.removeProperty("translate");
  });
  state.paintingOverscroll = false;
}

// Transform and opacity are driven by the CSS scroll-driven animations on
// .carousel-item, except while driven past either end (see
// paintOverscroll); otherwise this only computes the discrete current index
// for the page dots, since no timeline hands that back to JS.
function apply(ctx) {
  const { wrapper, getScrollSource, getDrivenProgress, getGeometry, currentScrollAnchor, onProgress } = ctx;
  // Shared with the engine and with anything else watching this wrapper,
  // rather than re-measured here: this runs on every scroll frame, and a
  // pass over every item is the one thing it must not do per frame.
  const { items, anchors, sizes } = getGeometry();
  const state = getWrapperState(wrapper);
  const scrollAnchor = currentScrollAnchor();

  // While something else drives this carousel, its progress is exact but
  // the scroll position written from it is quantised, so every item sits
  // a fraction of a pixel off from where it belongs. The timelines draw
  // everything from that scroll position, so they inherit the same error
  // - invisible in scale/opacity (fractions of a percent) but visible in
  // position, where it makes the whole strip step instead of glide.
  // --scroll-error is what the translate adds back to land where the
  // driver actually asked for.
  //
  // Zero and removed whenever this carousel scrolls itself, since progress
  // comes straight from the scroll position then - the two can't disagree.
  const isDriven = getScrollSource() === "driven";
  const currentProgress = isDriven ? getDrivenProgress() : computeCurrentProgress(anchors, scrollAnchor);

  //
  // Measured against the imaginary items past each end (see
  // computeEdgeAnchors), so a progress driven past the end carries this
  // carousel at the same pitch its own overscroll would.
  // Never over a timeline laid across another carousel: that draws this one
  // while it follows on it, and the paint would outrank it.
  const overscrolled =
    !ctx.isOnTimeline() && isDriven && (currentProgress < 0 || currentProgress > items.length - 1);
  if (overscrolled) {
    const scrollError = scrollAnchor - computeScrollAnchorForProgress(state.extendedAnchors, currentProgress + 1);
    wrapper.style.setProperty("--scroll-error", "0px");
    paintOverscroll(state, items, anchors, sizes, currentProgress, scrollError);
  } else {
    clearOverscroll(state, items);
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
