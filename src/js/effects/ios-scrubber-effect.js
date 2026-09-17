// Effect for the iOS-style thumbnail scrubber (see
// navigators/ios-thumbnail-scrubber.js) - not a general-purpose effect like
// css/js/origin-effect.js; purpose-built for this navigator's specific DOM
// (the .ios-thumbnail-scrubber-thumb child every item gets, set up in
// onItemCreated) and fixed-size items.
//
// Two genuinely different rendering paths, chosen fresh every apply() call
// - not one "clever" mechanism trying to serve both (an earlier version
// tried a permanently-on CSS transition for everything, which turned out to
// add real, felt lag to the continuous case and produce jerky motion right
// as it settled, since every high-frequency write was restarting the
// transition's easing curve from scratch):
//
//  - Driven by the main carousel's own live scroll (linkCarousels'
//    "continuous" aToB mode, via direct writeToDest calls): every item's
//    padding/width is written *untransitioned*, straight from live
//    progress, every frame - a plain triangle centered on this item's own
//    index (1 exactly at its own progress, 0 a full item-step either side;
//    the same shape css-effect.js's own item-current keyframe already uses
//    for the original scrubber). Zero JS-introduced lag, so it tracks the
//    source's scroll pixel-for-pixel, matching the original scrubber's own
//    continuous feel.
//  - Dragged/flicked on this strip directly: nothing continuous at all -
//    on every apply() call, this path works out what *should* be expanded
//    right now (the nearest item, but only if progress is actually within
//    UNSETTLE_EPSILON of it - otherwise nothing) and, if that differs from
//    what's currently rendered as expanded, animates the handoff via the
//    permanent CSS transition (see main.css). Not "expand on any discrete
//    index change" (an earlier version tracked *changes* to the rounded
//    index specifically, which has a real gap: a flick that overshoots its
//    landing item and gets pulled back by native scroll-snap correction
//    re-enters the *same* rounded index it had already "changed into" on
//    the way past - so nothing there ever counted as a new change, and the
//    item it actually settles on stayed collapsed forever). Recomputing
//    "what should be expanded" from scratch each time, instead of
//    diffing against the last change, means arriving back at the same
//    index after overshooting it is handled the same as arriving at any
//    other index - both are just "the target differs from what's
//    currently shown". A slow drag around inside one item's zone reads as
//    fully collapsed the entire time it's away from that item's own exact
//    position - matching "should not be treating this as settled unless
//    progress is a whole number" - and a fast flick through several items
//    never lets an intermediate one finish animating in, since the next
//    target overwrites its transition before it arrives; interrupting and
//    redirecting an in-flight CSS transition is native browser behavior,
//    nothing this module has to implement.
//
// Which path applies comes straight from the engine's own scroll
// attribution (ctx.getScrollSource - see the scroll-attribution block in
// carousel-engine.js): "driven" means an outside driver is writing this
// wrapper's scroll position directly, which is exactly the case where this
// wrapper's motion isn't a real drag on it at all. Nothing here has to be
// kept in sync by hand, and nothing has to infer it from a side effect of
// the layer doing the driving. (An earlier version read
// `wrapper.style.scrollSnapType === "none"`, the inline style
// carousel-link.js used to write while relaying. That worked, but it tied
// this effect to another module's implementation detail with no import
// between them, and it stayed true for the whole ~150ms snap-restore tail
// after the last relayed write - so grabbing the strip right as the main
// carousel stopped driving it rendered the first moments of a genuine drag
// on the driven path. Attribution flips the instant a real input lands.)
import { getItemMetrics, computeCurrentProgress, computeCurrentIndex } from "../carousel-math.js";

// Same DEBUG/debugLog shape as carousel-link.js, so logs from both read the
// same way side by side while tuning this. Flip off (or delete) once
// things feel settled.
const DEBUG = true;
let lastLogAt = null;
function debugLog(label, data) {
  if (!DEBUG) return;
  const now = performance.now();
  const sinceLast = lastLogAt === null ? null : Math.round(now - lastLogAt);
  lastLogAt = now;
  console.log(`[ios-scrubber-effect] ${label}`, { sinceLastLogMs: sinceLast, ...data });
}

const stateByWrapper = new WeakMap();
// Tracked separately from stateByWrapper, which setup() replaces wholesale
// on every call (init, resize, alignment change) - this must survive those
// replacements so the 'scrollend' listener below is only ever attached
// once per wrapper, not once per setup() call.
const scrollendListenerAttached = new WeakSet();

// How far (in index-steps) progress may drift from the settled item before
// that counts as "actively moving away from it" - not 0, since a resting
// scrollLeft can read back a sub-pixel-different progress than whatever it
// last settled on; small enough that any real, deliberate drag still
// collapses it effectively immediately.
const UNSETTLE_EPSILON = 0.02;

function onItemCreated(item) {
  item.classList.add("ios-thumbnail-scrubber-item");
  const thumb = document.createElement("div");
  thumb.classList.add("ios-thumbnail-scrubber-thumb");
  item.appendChild(thumb);
}

function setup(ctx) {
  const { wrapper } = ctx;
  const items = [...wrapper.querySelectorAll(".carousel-item")];
  const style = getComputedStyle(wrapper);
  const previous = stateByWrapper.get(wrapper);
  stateByWrapper.set(wrapper, {
    items,
    itemWidth: parseFloat(style.getPropertyValue("--ios-item-width")) || 20,
    expandedWidth: parseFloat(style.getPropertyValue("--ios-expanded-width")) || 30,
    expandedPadding: parseFloat(style.getPropertyValue("--ios-expanded-padding")) || 10,
    // Which item the own-drag path currently renders as expanded (closeness
    // 1) - null when nothing is (progress isn't within UNSETTLE_EPSILON of
    // any whole index right now). Starts null so the very first apply()
    // call - wherever progress happens to start - still counts as a change
    // and paints an initial current item.
    expandedIndex: previous ? previous.expandedIndex : null,
    // Whether the *previous* apply() call took the driven (untransitioned)
    // path - lets the own-drag path notice the handoff back and clear any
    // inline transition:none it left behind, just once, instead of every
    // call.
    wasDriven: previous ? previous.wasDriven : false
  });

  // A scrolling container's default "scroll anchoring" watches content near
  // the top of the scrollport and nudges scrollLeft to compensate whenever
  // that content resizes - built for e.g. a chat log that shouldn't jump
  // when older messages above the viewport load in. It doesn't know this
  // wrapper's own content is resizing *because of its own current scroll
  // position* (every padding/width write below); left on, each write it
  // "corrects" for triggers a real scroll event, which triggers apply()
  // again, which writes again - a feedback loop. Disabling it for this
  // scroller is the correct fix since every element in it is a
  // self-resizing participant.
  wrapper.style.overflowAnchor = "none";

  // Safety net for the own-drag path, not a settle-detection timer: a real
  // drag/flick's native momentum and any trailing scroll-snap correction
  // can go fully quiet - no further 'scroll' event ever firing - right as
  // it reaches its exact final resting position, if the last event
  // delivered before that happened to land a hair short of it. apply()
  // only ever runs off 'scroll' events, so nothing would otherwise notice
  // the true final progress and expand whatever it landed on - observed as
  // the settled item just staying collapsed until something unrelated (the
  // main carousel driving this strip, say) forces another apply() call.
  // 'scrollend' fires exactly once an actual scroll operation - gesture,
  // momentum, and snap-correction together - is over, so triggering one
  // more apply() here doesn't risk calling anything "settled" early; it's
  // strictly a chance to catch up to a position that was already, truly,
  // final.
  if (!scrollendListenerAttached.has(wrapper) && "onscrollend" in window) {
    scrollendListenerAttached.add(wrapper);
    wrapper.addEventListener("scrollend", () => apply(ctx));
  }
}

function renderItem(item, closeness, itemWidth, expandedWidth, expandedPadding) {
  item.style.paddingInline = (closeness * expandedPadding).toFixed(2) + "px";
  item.firstElementChild.style.width = (itemWidth + closeness * (expandedWidth - itemWidth)).toFixed(2) + "px";
}

function apply(ctx) {
  const { wrapper, getScrollSource, onProgress } = ctx;
  const state = stateByWrapper.get(wrapper);
  const { items, itemWidth, expandedWidth, expandedPadding } = state;

  const currentProgress = readProgress(ctx, items);
  const isDriven = getScrollSource() === "driven";

  if (isDriven) {
    items.forEach((item, i) => {
      const closeness = Math.max(0, 1 - Math.abs(currentProgress - i));
      // Overrides the permanent CSS transition per-write - this path is
      // continuous already (a new, only-slightly-different target every
      // frame), so transitioning each of those tiny steps would just be
      // the lag/jerkiness this split was built to remove.
      item.style.transition = "none";
      item.firstElementChild.style.transition = "none";
      renderItem(item, closeness, itemWidth, expandedWidth, expandedPadding);
    });
    state.wasDriven = true;
  } else {
    if (state.wasDriven) {
      // Handoff back from the driven path - clear the transition:none it
      // left on every item so the permanent CSS transition governs again
      // for whatever this path does next. The driven path's tent function
      // never touches state.expandedIndex (it renders every item's
      // closeness directly off live progress, not off "which one is
      // expanded"), so state.expandedIndex is whatever it was *before*
      // driving started - stale, and not necessarily the item the tent
      // function actually left with nonzero closeness on screen. Diffing
      // the target below against that stale value would collapse the wrong
      // item (or none at all) while leaving the real one stuck expanded.
      // Unconditionally collapsing every item here - now, with the
      // transition just restored, so it's animated - and resetting
      // state.expandedIndex to null gives the diff logic below a clean,
      // accurate slate to compute the real target from, and doubles as the
      // "collapse the instant you start dragging the thumb" behavior.
      items.forEach((item) => {
        item.style.transition = "";
        item.firstElementChild.style.transition = "";
        renderItem(item, 0, itemWidth, expandedWidth, expandedPadding);
      });
      state.expandedIndex = null;
      state.wasDriven = false;
    }

    // What *should* be expanded right now, recomputed from scratch every
    // call rather than diffed against the last change - null unless
    // progress is genuinely within UNSETTLE_EPSILON of the nearest item, in
    // which case that item. Arriving back at the same item after
    // overshooting it (a real flick's momentum carrying past it, then
    // native scroll-snap correction pulling it back) computes the exact
    // same target as arriving at it from a standing start - there's no
    // separate "did the rounded index change" state to fall out of sync
    // with the actual position.
    const nearestIndex = computeCurrentIndex(currentProgress, items.length);
    const targetExpandedIndex =
      Math.abs(currentProgress - nearestIndex) <= UNSETTLE_EPSILON ? nearestIndex : null;

    if (targetExpandedIndex !== state.expandedIndex) {
      if (state.expandedIndex !== null) {
        renderItem(items[state.expandedIndex], 0, itemWidth, expandedWidth, expandedPadding);
      }
      if (targetExpandedIndex !== null) {
        renderItem(items[targetExpandedIndex], 1, itemWidth, expandedWidth, expandedPadding);
      }
      state.expandedIndex = targetExpandedIndex;
    }
  }

  debugLog("apply", {
    isDriven,
    progress: currentProgress,
    expandedIndex: state.expandedIndex
  });

  onProgress?.(computeCurrentIndex(currentProgress, items.length), currentProgress);
}

function readProgress(ctx, items) {
  const { wrapper, scrollDistance, offsetLength, offsetFromStart, getAlignmentFraction, getScrollPadding } = ctx;
  const { anchors, scrollAnchor } = getItemMetrics(
    wrapper,
    items,
    offsetFromStart,
    offsetLength,
    scrollDistance,
    getAlignmentFraction(wrapper),
    getScrollPadding(wrapper)
  );
  return computeCurrentProgress(anchors, scrollAnchor);
}

// Every item's padding/width is this effect's own doing, every frame - not
// something that needs recovering from via carousel-engine's item-level
// ResizeObserver (see that observer's own comment). Left unset, it would
// treat each of this effect's writes as an unexpected resize and
// re-trigger a full refresh because of it - a second, independent feedback
// loop on top of the scroll-anchoring one described above.
export const iosScrubberEffect = { onItemCreated, setup, apply, skipItemResizeObserver: true };
