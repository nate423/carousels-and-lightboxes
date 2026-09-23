// The default carousel look: every item scales and fades toward its
// noncurrent state the further it sits from current, with a translate that
// compensates for the gap scaling opens between neighbours.
//
// All native: `animation-range` plus per-item @keyframes on .carousel-item
// drive scale/opacity off a per-item view-timeline, and translate off a
// wrapper-level scroll-timeline (both declared in the page's stylesheet).
// This module only precomputes that animation geometry in setup(); apply()
// just derives the current index for a navigator, since that's the one
// thing no timeline can hand back to JS.
//
// Shared by the scale-fade page and by the filmstrip page, whose strip is
// this same look tuned smaller.
//
// The same look computed by hand instead of via @keyframes is archived at
// archive/proto-v1/js/effects/looks/scale-fade-look.js - the reference this
// one's output was checked against.
import {
  computeCurrentProgress,
  computeCurrentIndex,
  computeScrollAnchorForProgress,
  computeAnimationRanges,
  computeEdgeAnchors
} from "../carousel-math.js";
import { computeTranslationBreakpoints, computeGapCompensatedFrame } from "./helpers/gap-compensation.js";
import { RuleSheet } from "./helpers/style-swap.js";
import { nextItemId } from "./helpers/item-id.js";

// `animation-timing-function` only reshapes the curve *within* one
// keyframe-to-keyframe segment - it can't move *where* a keyframe's value
// falls across the whole range. Each item's peak sits at its own
// asymmetric position (computeAnimationRanges' peakX), so placing it
// correctly means giving that item its own @keyframes rule with "scale: 1"
// at that exact percentage. That needs a distinct, stable id per item
// (assigned in onItemCreated) and a shared stylesheet holding one
// generated rule per item, rebuilt whenever setup() recomputes geometry.
// The gap-compensating translate gets the same treatment - off a second,
// wrapper-level scroll-timeline instead of the per-item one - see
// computeTranslationBreakpoints in gap-compensation.js for why that's
// exactly representable too.
//
// Ids only need to be unique site-wide (they're used in the
// `[data-item-id="N"]` selector below), which helpers/item-id.js sees to
// across every look on the page.

// The generated rules and the <style> elements holding them are kept
// one-per-wrapper (via this WeakMap), not as module-level singletons. A
// single shared set would mean every carousel using this look (the
// filmstrip page runs two at once) flushes the same 3 <style> elements on
// every setup() call, so one carousel's resize churn forces a full
// teardown-and-reinsert of every other carousel's rules too. The
// scroll-timeline polyfill (below) only (re)parses a <style> element the
// moment it's inserted, so that churn keeps re-discovering rules for items
// whose animations may already be running - and a freshly-dispatched
// animationstart can race the polyfill's own parse of the very rule it
// needs, permanently missing the hijack for whichever item loses that
// race. Scoping rules per wrapper means one carousel's churn never touches
// another's.
const stateByWrapper = new WeakMap();

function getWrapperState(wrapper) {
  let state = stateByWrapper.get(wrapper);
  if (!state) {
    state = {
      currentKeyframeSheet: new RuleSheet(),
      translateKeyframeSheet: new RuleSheet(),
      // Safari's scroll-timeline polyfill can't see animation-timeline etc.
      // set as inline styles - it only discovers them by parsing real
      // stylesheet rules and matching selectors against the DOM (see
      // getAnimationTimelineOptions in vendor/scroll-timeline.js). So every
      // item's animation-name/-timeline/-range also gets a generated
      // selector rule here, alongside the inline styles below (which
      // native engines read directly and which win in the CSSOM anyway -
      // same values, no conflict).
      positionSheet: new RuleSheet()
    };
    stateByWrapper.set(wrapper, state);
  }
  return state;
}

// Builds the rule text and points the item at it, but doesn't touch the
// shared stylesheet's textContent yet - setting that is a full reparse of
// every rule in it, so setup() batches all n items' rules and writes each
// stylesheet once, after the items.forEach loop. Writing per-item instead
// would reparse the whole, growing rule set on every write - O(n^2) -
// which shows up as jank on window resize, since resize has no debounce.
//
// The keyframes write scale, opacity and translate outright, properties
// the compositor understands on its own, so the look keeps animating even
// when the main thread is busy.
//
// A contrast-dimmable version of this look used to exist: every drawn
// value multiplied by how much contrast is showing, which meant the
// keyframes wrote --item-progress/--item-shift and a calc() in the
// stylesheet turned those into the real values. calc() is nothing the
// compositor can evaluate, so the browser had to resolve the animation on
// the main thread every frame instead - measured to freeze solid under
// three seconds of main-thread load, where this simpler version keeps
// animating.
//
// No carousel using this look drops contrast any more; the iOS scrubber,
// which does, pays that cost in its own look instead. Contrast can't just
// be composed on top as a second animation either: transforms do compose
// multiplicatively, but what contrast scales is each value's *distance
// from neutral* (1 + c * (s - 1)), not a plain factor of c.
function setItemCurrentKeyframes(state, item, peakX, range, translateStops, translateRange) {
  const currentName = `item-current-${item.dataset.itemId}`;
  state.currentKeyframeSheet.set(
    currentName,
    `@keyframes ${currentName} {
      0% { scale: var(--noncurrent-scale); opacity: var(--noncurrent-opacity); }
      ${peakX * 100}% { scale: 1; opacity: 1; }
      100% { scale: var(--noncurrent-scale); opacity: var(--noncurrent-opacity); }
    }`
  );

  const translateName = `item-translate-${item.dataset.itemId}`;
  const stops = translateStops
    .map(({ percent, value }) => `${percent}% { translate: ${value}px 0; }`)
    .join("\n      ");
  state.translateKeyframeSheet.set(translateName, `@keyframes ${translateName} {\n      ${stops}\n    }`);

  const animationName = `${currentName}, ${translateName}`;
  const animationTimeline = "--item-reveal, --carousel-scroll";
  const animationRange = `cover ${range.start * 100}% cover ${range.end * 100}%, ${translateRange}`;

  item.style.animationName = animationName;
  item.style.animationTimeline = animationTimeline;
  item.style.animationRange = animationRange;

  state.positionSheet.set(
    item.dataset.itemId,
    `.carousel-item[data-item-id="${item.dataset.itemId}"] {
      animation-name: ${animationName};
      animation-timeline: ${animationTimeline};
      animation-range: ${animationRange};
    }`
  );
}

function flushKeyframeStyles(state) {
  state.currentKeyframeSheet.flush();
  state.translateKeyframeSheet.flush();
  state.positionSheet.flush();
}

function onItemCreated(item) {
  item.dataset.itemId = nextItemId();
}

// Sets each item's `animation-range` from its own geometry - sized to the
// real pixel gap to each neighbouring anchor, so the falloff reaches
// exactly 0 exactly when that neighbour becomes current (asymmetric
// whenever neighbours differ in size, which they always do here). That
// asymmetry means an item's real peak generally isn't at the range's
// midpoint, so each item gets its own @keyframes rule
// (setItemCurrentKeyframes) with "scale: 1" placed at peakX instead of a
// fixed 50%. Pure layout math - only needs recomputing when geometry or
// alignment changes, not on scroll.
//
// Known limitation, not a bug: right after an item enters a fresh
// animation-range, Chromium holds it clamped at the boundary's keyframe
// value for a few more pixels of scroll before it starts interpolating,
// even though the declared range is already correct at that point.
// Confirmed at the painted-layout level and reproduces even with the
// default range, so it's a browser quirk in view-timeline boundary
// detection, not something our geometry can fix - and not worth
// hard-coding an undocumented pixel offset for.
function setup(ctx) {
  const { wrapper, getNoncurrentScale } = ctx;
  const state = getWrapperState(wrapper);
  const { items, anchors, sizes, wrapperAnchorPoint } = ctx.getGeometry();
  const ranges = computeAnimationRanges(anchors, sizes, wrapper.offsetWidth);

  // The breakpoints run past both ends of the scroll range, out to where
  // an overscroll can carry the end item (see computeTranslationBreakpoints),
  // so the translate's range is set in raw scroll offsets that go past 0
  // and maxScroll too, rather than as the timeline's own 0%-100%.
  // scrollAnchor = scrollOffset + wrapperAnchorPoint (see getItemMetrics).
  const { breakpoints, start, end } = computeTranslationBreakpoints(anchors, sizes, getNoncurrentScale(wrapper));
  const translateRange = `${start - wrapperAnchorPoint}px ${end - wrapperAnchorPoint}px`;
  const percentFor = (scrollAnchor) => (end > start ? ((scrollAnchor - start) / (end - start)) * 100 : 0);

  items.forEach((item, i) => {
    const translateStops = breakpoints.map((bp) => ({
      percent: percentFor(bp.scrollAnchor),
      value: bp.translations[i]
    }));
    setItemCurrentKeyframes(state, item, ranges[i].peakX, ranges[i], translateStops, translateRange);
  });
  flushKeyframeStyles(state);

  const { before, after } = computeEdgeAnchors(anchors, sizes);
  state.extendedAnchors = [before, ...anchors, after];
  state.noncurrentScale = getNoncurrentScale(wrapper);
  state.noncurrentOpacity = parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-opacity"));
}

// Past either end while driven, the progress asked for is somewhere this
// carousel's own scroll can't go - it stops at 0 or maxScroll - so the
// timelines, which only ever see that scroll, hold the end item at full.
// The look is painted from JS instead, for just those frames: !important,
// because that is what outranks a running animation, and taken off again
// the moment the progress is back in range, where the timelines already
// agree with it.
//
// The scroll error rides along in the same translate, rather than on
// transform as usual: transform applies inside scale, so each item would
// carry the error scaled by its own size - a fraction of a pixel's
// difference in range, but out here, where the error is the whole
// overscroll, it visibly opens the gaps back up.
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
    scale: String(scale),
    opacity: String(state.noncurrentOpacity + itemProgress[i] * (1 - state.noncurrentOpacity)),
    translate: `${translations[i] + scrollError}px 0`
  }));
}

// One animation per item, keyframed at each sample the engine asks for - see
// linked-scrolling/timeline-follow.js. The error is the whole distance
// between where this carousel's scroll sits and where it is being shown, so
// it rides in the translate for the same reason it does past the ends, and
// transform is held at none to keep the stylesheet's own correction out of
// it. All four are properties the compositor can animate by itself.
function followFrames(ctx, samples) {
  const { items, anchors, sizes } = ctx.getGeometry();
  const state = getWrapperState(ctx.wrapper);
  const frames = samples.map(({ progress, scrollError }) => frameStyles(state, anchors, sizes, progress, scrollError));
  return Array.from(items, (item, i) => ({
    target: item,
    keyframes: frames.map((styles) => ({ ...styles[i], transform: "none" }))
  }));
}

function clearOverscroll(state, items) {
  if (!state.paintingOverscroll) return;
  items.forEach((item) => {
    item.style.removeProperty("scale");
    item.style.removeProperty("opacity");
    item.style.removeProperty("translate");
  });
  state.paintingOverscroll = false;
}

// Scale/opacity/translate are driven by the CSS scroll-driven animations on
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
