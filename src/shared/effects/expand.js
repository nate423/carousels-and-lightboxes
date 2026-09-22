// A carousel look for fixed-size items at a constant gap, where only the
// one nearest the center grows - both its own box and the room its
// neighbours leave around it - drawn as overflow and a transform rather
// than a bigger layout box. Used by the iOS-Photos-style scrubber strip,
// but nothing here is specific to that page.
//
// The same look computed by hand is archived at
// archive/proto-v1/js/effects/ios-scrubber-effect.js (settle-effect.js
// wrapped around looks/ios-box-look.js) - the reference this one's
// derivation below was checked against.
//
// --- Why this needs no keyframes per item -------------------------------
//
// The archived ios-box-look.js lays every item out a second time in visual
// terms - each at its real grown footprint - and translates it by the
// difference between that layout and its own fixed box. With F =
// footprintGrowth, P = currentProgress and u = i - P (how many items away
// item i is from current, signed), that reduces to:
//
//   lo(u)   = clamp(0, 1 + u, 1)
//   hi(u)   = clamp(0, u, 1)
//   grow_i  = lo - hi                                (the 0-1 itemProgress)
//   shift_i = F * ((lo + hi)/2 - 1/2)
//
// The general form, for an anchor fraction a anywhere across the item, was
//
//   shift_i = F * (a*lo + (1-a)*hi - a - bend)
//   bend    = (1 - 2a) * frac(P) * (1 - frac(P))
//
// bend is worth keeping in view because it's where the cost was: the one
// term that isn't a function of an item's own index, so it had to be
// written from JS every frame. At a = 1/2 it's identically zero, and
// what's left is static enough to live entirely in the stylesheet.
//
// Every item runs that same formula against its own index, so unlike
// scale-fade.js - whose per-item peak sits at a different, geometry-
// dependent place for every item, forcing a generated @keyframes rule
// each - the whole strip needs exactly one animation, advancing one
// number from 0 to n-1 across the scroll range. Each item's own index is
// a static custom property, and expand.css does the rest.
//
// Item *sizes* drop out of this entirely: the translate is the difference
// between two layouts, and each item's size appears identically in both.
// What the formula does assume is that every item grows by the same
// amount - an item growing to some width of its own (its source media's
// aspect, say) makes F per-item, and the two global terms stop being
// reconstructable from an item's own index. That case would want
// generated per-item keyframes, like scale-fade.js, but could still keep
// this one wrapper-level timeline rather than one per item.
//
// The mapping from scroll offset to progress is linear here because this
// look pins every item's layout box to the same fixed size, so the item
// pitch is uniform - which is what lets the driving animation be two
// stops instead of one per item.
import {
  computeCurrentProgress,
  computeCurrentIndex,
  computeScrollAnchorForProgress
} from "../carousel-math.js";
import { replaceStyleEl } from "./helpers/style-swap.js";

let nextStripId = 0;

const stateByWrapper = new WeakMap();

function onItemCreated(item) {
  item.classList.add("expand-effect-item");
  const thumb = document.createElement("div");
  thumb.classList.add("expand-effect-thumb");
  item.appendChild(thumb);
}

// Where the shared progress comes from depends on who's moving this
// strip - the two cases have very different resolution.
//
// While the strip is scrolling itself, its own scroll position *is* the
// ground truth, so the animation reads it directly and costs no JS per
// frame at all.
//
// While another carousel drives it, that position is a lossy retelling
// of the driver's: scroll position is quantised, and this strip is far
// shorter than the carousel driving it (30 thumbnails at a 23px pitch
// give it a 667px range against roughly 5300px, so one strip pixel is
// worth eight of the driver's). The strip can only move in steps eight
// times larger than the motion being asked of it, so it holds still for
// several frames and then jumps - what the archived settle-effect.js's
// getDrivenProgress exists to avoid, and reading position back through
// the timeline walks straight into it.
//
// So on that path the animation is switched off and the exact fractional
// progress is written instead: one property write per frame (against
// sixty for a look that paints each item from JS), only while something
// else is driving. The switch is per handoff, not per frame - re-enabling
// the animation is free, since its progress is the scroll position rather
// than an elapsed time, so it resumes exactly where the scroll already is.
//
// `progressDriver` pins this choice for comparison: "css" always reads
// the scroll position, "js" always writes progress. The default picks
// per frame.
export function expandEffect({ progressDriver = "auto" } = {}) {
  function setup(ctx) {
    const { wrapper, getGeometry } = ctx;
    const { items, anchors } = getGeometry();
    const style = getComputedStyle(wrapper);
    const itemWidth = parseFloat(style.getPropertyValue("--expand-item-width")) || 20;
    const grownWidth = parseFloat(style.getPropertyValue("--expand-grown-width")) || 30;
    const grownPadding = parseFloat(style.getPropertyValue("--expand-grown-padding")) || 10;

    const previous = stateByWrapper.get(wrapper);
    const stripId = previous ? previous.stripId : nextStripId++;

    wrapper.classList.add("expand-effect");
    // How much wider the thumb itself draws when fully grown, versus how
    // much room the grown item takes from its neighbours - which also
    // includes the breathing space either side of it. Both are drawn as
    // overflow around the item's own fixed box, so only the second
    // decides how far the neighbours are pushed away.
    wrapper.style.setProperty("--expand-thumb-growth", grownWidth - itemWidth + "px");
    wrapper.style.setProperty("--expand-footprint-growth", grownWidth - itemWidth + 2 * grownPadding + "px");
    items.forEach((item, i) => item.style.setProperty("--expand-index", i));

    const animationName = `expand-progress-${stripId}`;
    const styleEl = replaceStyleEl(
      previous?.styleEl,
      `@keyframes ${animationName} {\n  from { --expand-progress: 0; }\n  to { --expand-progress: ${items.length - 1}; }\n}`
    );

    stateByWrapper.set(wrapper, {
      stripId,
      styleEl,
      animationName,
      items,
      anchors,
      // Unset rather than false, so the first apply() always writes which
      // source is in use instead of assuming the wrapper already agrees.
      writingProgress: undefined
    });
  }

  function apply(ctx) {
    const { wrapper, getScrollSource, getDrivenProgress, onProgress, currentScrollAnchor } = ctx;
    const state = stateByWrapper.get(wrapper);
    const { anchors, items, animationName } = state;

    const isDriven = getScrollSource() === "driven";
    const scrollAnchor = currentScrollAnchor();
    const currentProgress = isDriven ? getDrivenProgress() : computeCurrentProgress(anchors, scrollAnchor);

    const writingProgress = progressDriver === "js" || (progressDriver === "auto" && isDriven);
    if (writingProgress !== state.writingProgress) {
      state.writingProgress = writingProgress;
      // An animation outranks an inline custom property, so the two can't
      // both be live - handing over means turning the other one off.
      wrapper.style.animationName = writingProgress ? "none" : animationName;
      if (!writingProgress) {
        wrapper.style.removeProperty("--expand-progress");
        wrapper.style.removeProperty("--scroll-error");
      }
    }

    if (writingProgress) {
      wrapper.style.setProperty("--expand-progress", currentProgress);
      // Where the items' boxes actually are, versus where the progress
      // being painted says they should be. This look's formula reduces to
      // a function of progress alone only by assuming those agree - true
      // for a carousel scrolling itself, false for one being driven, where
      // progress is exact but the scroll position written from it is
      // quantised. Without this, the thumbnails' growth is smooth while
      // the strip they sit on still steps a whole quantum at a time, which
      // was most of the judder. The hand-computed look never needed it,
      // since it keeps the real scroll position as a term instead of
      // dividing it out.
      wrapper.style.setProperty(
        "--scroll-error",
        (scrollAnchor - computeScrollAnchorForProgress(anchors, currentProgress)).toFixed(3) + "px"
      );
    }

    onProgress?.(computeCurrentIndex(currentProgress, items.length), currentProgress);
  }

  // This effect owns every item's rendering, and nothing it writes
  // changes an item's own border box - it draws with transforms and with
  // properties confined inside the box (see engine/geometry-cache.js) -
  // so the engine's item-level ResizeObserver has nothing real to recover
  // here.
  return { onItemCreated, setup, apply, skipItemResizeObserver: true };
}
