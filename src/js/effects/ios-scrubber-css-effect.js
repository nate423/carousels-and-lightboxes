// The iOS Photos scrubber's look, painted by a native scroll-driven
// animation. The same look computed by hand is archived at
// archive/proto-v1/js/effects/ios-scrubber-effect.js (settle-effect.js
// wrapped around looks/ios-box-look.js) - the reference implementation this
// one's derivation below was checked against.
//
// --- Why this needs no keyframes per item -------------------------------
//
// The archived ios-box-look.js lays every item out a second time in visual
// terms - each
// occupying its real expanded footprint - and translates each item by the
// difference between that layout and its own fixed box. Written out, with
// F = footprintGrowth, a = alignment, P = currentProgress and u = i - P
// (how many items away item i is from current, signed), all of it reduces
// to:
//
//   lo(u)   = clamp(0, 1 + u, 1)
//   hi(u)   = clamp(0, u, 1)
//   grow_i  = lo - hi                                (the 0-1 itemProgress)
//   shift_i = F * (a*lo + (1-a)*hi - a - bend)
//   bend    = (1 - 2a) * frac(P) * (1 - frac(P))
//
// Every item runs that identical formula against its own index, so unlike
// css-effect.js - whose per-item peak sits at a different, geometry-
// dependent place for every item, forcing a generated @keyframes rule each
// - the whole strip needs exactly one animation, advancing one number from
// 0 to n-1 across the scroll range. Each item's own index is a static
// custom property, and main.css does the rest.
//
// Item *sizes* drop out of that derivation entirely: the translate is the
// difference between two layouts, and each item's size appears identically
// in both. What the formula does assume is that every item grows by the
// same amount - an item expanding to some width of its own (its source
// media's aspect, say) makes F per-item, and then the two global terms
// stop being reconstructable from an item's own index. That case wants
// generated per-item keyframes, the way css-effect.js already does it. It
// would still be this one wrapper-level timeline, not a timeline each.
//
// The mapping from scroll offset to progress is linear here because this
// look pins every item's layout box to the same fixed size, so the item
// pitch is uniform - which is what lets the driving animation be two stops
// rather than one per item.
import {
  computeCurrentProgress,
  computeCurrentIndex,
  computeScrollAnchorForProgress,
  getItemMetrics,
  wrapperAnchor
} from "../carousel-math.js";
import { replaceStyleEl } from "./style-swap.js";

let nextStripId = 0;

const stateByWrapper = new WeakMap();

function onItemCreated(item) {
  item.classList.add("ios-thumbnail-scrubber-item");
  const thumb = document.createElement("div");
  thumb.classList.add("ios-thumbnail-scrubber-thumb");
  item.appendChild(thumb);
}

// Where the shared progress comes from depends on who is moving this strip,
// because the two cases have very different resolution.
//
// While the strip is the one being scrolled, its own scroll position *is*
// the ground truth, so the animation reads it directly and this costs no JS
// per frame at all.
//
// While another carousel is driving it, that same position is a lossy
// retelling of the driver's. A scroll position is quantised, and this strip
// is far shorter than the carousel driving it: 30 thumbnails at a 23px
// pitch give it a 667px range against roughly 5300px, so one strip pixel is
// worth eight of the driver's. In translate that is 0.65px per strip pixel
// against 0.08px per driver pixel - the strip can only move in steps eight
// times larger than the motion being asked of it, so it holds still for
// several frames and then jumps. That is what the archived settle-effect.js's
// getDrivenProgress exists to avoid, and reading the position back through
// the timeline walks straight into it.
//
// So on that path the animation is switched off and the exact fractional
// progress is written instead. It is one property write per frame - against
// sixty for a look that paints each item from JS - and it happens only
// while something else is driving. The switch is per handoff, not per
// frame; re-enabling a scroll-driven animation is free, since its progress
// is the scroll position rather than an elapsed time, so it resumes exactly
// where the scroll already is.
//
// `progressDriver` pins that choice for comparison: "css" always reads the
// scroll position, "js" always writes progress. The default picks per
// frame.
export function iosScrubberCssEffect({ progressDriver = "auto" } = {}) {
  function setup(ctx) {
    const { wrapper, scrollDistance, offsetSize, offsetFromStart, getAlignmentFraction, getScrollPadding } = ctx;
    const items = [...wrapper.querySelectorAll(".carousel-item")];
    const style = getComputedStyle(wrapper);
    const itemWidth = parseFloat(style.getPropertyValue("--ios-item-width")) || 20;
    const expandedWidth = parseFloat(style.getPropertyValue("--ios-expanded-width")) || 30;
    const expandedPadding = parseFloat(style.getPropertyValue("--ios-expanded-padding")) || 10;
    const alignment = getAlignmentFraction(wrapper);

    const previous = stateByWrapper.get(wrapper);
    const stripId = previous ? previous.stripId : nextStripId++;

    wrapper.classList.add("ios-scrubber-css");
    // How much wider the thumb itself draws when fully expanded, versus how
    // much room the expanded item takes from its neighbours - which also
    // includes the breathing space either side of it. Both are drawn as
    // overflow around the item's own fixed box, so only the second decides
    // how far the neighbours are pushed away.
    wrapper.style.setProperty("--ios-thumb-growth", expandedWidth - itemWidth + "px");
    wrapper.style.setProperty("--ios-footprint-growth", expandedWidth - itemWidth + 2 * expandedPadding + "px");
    wrapper.style.setProperty("--ios-alignment", alignment);
    items.forEach((item, i) => item.style.setProperty("--ios-index", i));

    const animationName = `ios-progress-${stripId}`;
    const styleEl = replaceStyleEl(
      previous?.styleEl,
      `@keyframes ${animationName} {\n  from { --ios-progress: 0; }\n  to { --ios-progress: ${items.length - 1}; }\n}`
    );

    const { anchors } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetSize,
      scrollDistance,
      alignment,
      getScrollPadding(wrapper)
    );

    stateByWrapper.set(wrapper, {
      stripId,
      styleEl,
      animationName,
      items,
      anchors,
      alignment,
      wrapperAnchorPoint: wrapperAnchor(wrapper[offsetSize], alignment, getScrollPadding(wrapper)),
      // Unset rather than false, so the first apply() always writes which
      // source is in use instead of assuming the wrapper already agrees.
      writingProgress: undefined
    });
  }

  function apply(ctx) {
    const { wrapper, scrollDistance, getScrollSource, getDrivenProgress, onProgress } = ctx;
    const state = stateByWrapper.get(wrapper);
    const { anchors, alignment, wrapperAnchorPoint, items, animationName } = state;

    const isDriven = getScrollSource() === "driven";
    const scrollAnchor = wrapper[scrollDistance] + wrapperAnchorPoint;
    const currentProgress = isDriven ? getDrivenProgress() : computeCurrentProgress(anchors, scrollAnchor);

    const writingProgress = progressDriver === "js" || (progressDriver === "auto" && isDriven);
    if (writingProgress !== state.writingProgress) {
      state.writingProgress = writingProgress;
      // An animation outranks an inline custom property, so the two cannot
      // both be live - handing over means turning the other one off.
      wrapper.style.animationName = writingProgress ? "none" : animationName;
      if (!writingProgress) {
        wrapper.style.removeProperty("--ios-progress");
        wrapper.style.removeProperty("--scroll-error");
      }
    }

    if (writingProgress) {
      wrapper.style.setProperty("--ios-progress", currentProgress);
      // Where the items' boxes actually are, against where the progress
      // being painted says they should be. The formula this look draws with
      // reduces to a function of progress alone precisely by assuming those
      // agree, which is true of a carousel scrolling itself and false of one
      // being driven: the progress is exact and the scroll position written
      // from it is quantised. Without this the thumbnails' expansion is
      // smooth while the strip they sit on still steps a whole quantum at a
      // time, which is most of what the judder actually was. The
      // hand-computed look never had it because it keeps the real scroll
      // position as a term instead of dividing it out.
      wrapper.style.setProperty(
        "--scroll-error",
        (scrollAnchor - computeScrollAnchorForProgress(anchors, currentProgress)).toFixed(3) + "px"
      );
    }

    // The one term of the formula that isn't a function of an item's own
    // index - it needs frac(progress), which has no dependable CSS spelling
    // yet. It is identically zero at center alignment, which is the default,
    // so away from center is the only case that costs a write.
    if (alignment !== 0.5) {
      const t = currentProgress - Math.floor(currentProgress);
      wrapper.style.setProperty("--ios-bend", (1 - 2 * alignment) * t * (1 - t));
    }

    onProgress?.(computeCurrentIndex(currentProgress, items.length), currentProgress);
  }

  // This effect owns every item's rendering, and nothing it writes changes
  // an item's own border box, so the engine's item-level ResizeObserver has
  // nothing real to recover here - it draws with transforms and with
  // properties confined inside the box (see engine/geometry-cache.js).
  return { onItemCreated, setup, apply, skipItemResizeObserver: true };
}
