// A carousel look for fixed-size items at a constant gap, where only the
// one nearest the center grows - both its own thumbnail and the room its
// neighbours leave around it - drawn entirely with translate and scale,
// never with a bigger layout box. Used by the iOS-Photos-style scrubber
// strip, but nothing here is specific to that page.
//
// The same look computed by hand is archived at
// archive/proto-v1/js/effects/ios-scrubber-effect.js (settle-effect.js
// wrapped around looks/ios-box-look.js) - the reference the derivation
// below was checked against.
//
// --- The look, as a function of progress ---------------------------------
//
// With P = currentProgress and u = i - P (how many items away item i is
// from current, signed):
//
//   lo(u)   = clamp(0, 1 + u, 1)
//   hi(u)   = clamp(0, u, 1)
//   grow_i  = lo - hi                            (0 to 1: how current it is)
//   shift_i = F * ((lo + hi)/2 - 1/2)            (F: footprint growth)
//
// Each item's shift makes room for its grown neighbour; each item's
// thumbnail is (collapsed + grow * growth) wide. Both are linear in P
// between whole items, and every item runs the same curve offset by its
// own index, so one set of keyframes serves the whole strip - each item
// only gets its own animation-range, the two items either side of it.
//
// --- Drawn with what the compositor can animate ---------------------------
//
// Only translate, scale and opacity animate off the main thread, so the
// thumbnail's width can't be what grows. The thumbnail is laid out at its
// grown width, always, clipped, and scaled on x down to the width it should
// show; whatever it holds is scaled back the other way, so an image in it
// is cropped narrower rather than squeezed. Nothing about the look ever
// changes a box's size, so nothing it does can move the layout, the snap
// points, or the scroll position underneath it.
//
// The counter-scale is 1/s, which isn't linear in P, so its keyframes are
// sampled more finely than the others (COUNTER_STEPS per item).
//
import { computeCurrentProgress, computeCurrentIndex, computeScrollAnchorForProgress } from "../carousel-math.js";
import { RuleSheet } from "./helpers/style-swap.js";
import { nextItemId } from "./helpers/item-id.js";

const COUNTER_STEPS = 6;

let nextStripId = 0;

const stateByWrapper = new WeakMap();

function clamp01(x) {
  return Math.min(Math.max(x, 0), 1);
}

export function expandEffect() {
  function onItemCreated(item) {
    item.classList.add("expand-effect-item");
    item.dataset.itemId = nextItemId();
    const thumb = document.createElement("div");
    thumb.classList.add("expand-effect-thumb");
    item.appendChild(thumb);
  }

  // What each item draws at one progress, with `scrollError` - how far the
  // scroll position sits from where the progress belongs - carried in the
  // translate.
  function frameAt(state, progress, scrollError = 0) {
    const { dims } = state;
    return state.items.map((item, i) => {
      const u = i - progress;
      const lo = clamp01(1 + u);
      const hi = clamp01(u);
      const shift = dims.footprintGrowth * ((lo + hi) / 2 - 0.5);
      const scale = (dims.width + (lo - hi) * (dims.grownWidth - dims.width)) / dims.grownWidth;
      return {
        item: { translate: `${shift + scrollError}px 0` },
        thumb: { scale: `${scale} 1` },
        content: { scale: `${1 / scale} 1` }
      };
    });
  }

  // Each element the look draws on, per item: the item, its thumbnail, and
  // whatever the thumbnail holds.
  function targetsOf(item) {
    const thumb = item.querySelector(".expand-effect-thumb");
    return { item, thumb, content: thumb ? [...thumb.children] : [] };
  }

  // Before the items are built: their sizes, and the look's default
  // dimensions, hang off .expand-effect (see expand.css), and the engine
  // measures the items as soon as they exist.
  function prepare(wrapper) {
    wrapper.classList.add("expand-effect");
  }

  function setup(ctx) {
    const { wrapper, getGeometry } = ctx;
    const { items, anchors, wrapperAnchorPoint } = getGeometry();

    const style = getComputedStyle(wrapper);
    const width = parseFloat(style.getPropertyValue("--expand-item-width"));
    const grownWidth = parseFloat(style.getPropertyValue("--expand-item-width-grown"));
    const grownPadding = parseFloat(style.getPropertyValue("--expand-grown-padding"));
    const dims = { width, grownWidth, footprintGrowth: grownWidth - width + 2 * grownPadding };
    // The thumbnail's scale at rest, for the stylesheet to fall back on
    // before any animation resolves.
    wrapper.style.setProperty("--expand-collapsed-scale", String(width / grownWidth));

    const previous = stateByWrapper.get(wrapper);
    const stripId = previous ? previous.stripId : nextStripId++;
    const sheet = previous?.sheet ?? new RuleSheet();
    const state = {
      ...previous,
      stripId,
      sheet,
      dims,
      items: [...items],
      targets: [...items].map(targetsOf),
      anchors,
      painting: previous?.painting ?? false
    };
    stateByWrapper.set(wrapper, state);

    // One curve for every item, across the two items either side of it:
    // 0% is the previous item current, 50% this one, 100% the next.
    const names = { item: `expand-item-${stripId}`, thumb: `expand-thumb-${stripId}`, content: `expand-content-${stripId}` };
    // Sampled as item 0 at progress 2t - 1, which is any item i at i - 1 + 2t.
    const steps = COUNTER_STEPS * 2;
    const curve = Array.from({ length: steps + 1 }, (_, k) => {
      const t = k / steps;
      const [frame] = frameAt({ dims, items: [null] }, 2 * t - 1);
      return { percent: t * 100, frame };
    });
    const keyframes = (name, pick, stops) =>
      `@keyframes ${name} {\n${stops.map((stop) => `  ${stop.percent}% { ${pick(stop.frame)} }`).join("\n")}\n}`;
    const linearStops = [0, steps / 2, steps].map((k) => curve[k]);
    sheet.set("keyframes-item", keyframes(names.item, (f) => `translate: ${f.item.translate};`, linearStops));
    sheet.set("keyframes-thumb", keyframes(names.thumb, (f) => `scale: ${f.thumb.scale};`, linearStops));
    sheet.set("keyframes-content", keyframes(names.content, (f) => `scale: ${f.content.scale};`, curve));

    // Each item's range: from the scroll offset where the item before it is
    // current to where the item after it is. The pitch is uniform, so the
    // items either side of the ends are one pitch further out.
    const pitch = anchors.length > 1 ? anchors[1] - anchors[0] : 0;
    items.forEach((item, i) => {
      const start = anchors[i] - pitch - wrapperAnchorPoint;
      const range = `${start}px ${start + 2 * pitch}px`;
      const { thumb } = state.targets[i];
      const id = item.dataset.itemId;
      const rules = [
        [item, `.expand-effect-item[data-item-id="${id}"]`, names.item],
        [thumb, `.expand-effect-item[data-item-id="${id}"] > .expand-effect-thumb`, names.thumb],
        [null, `.expand-effect-item[data-item-id="${id}"] > .expand-effect-thumb > *`, names.content]
      ];
      rules.forEach(([el, selector, name]) => {
        // Inline for native engines, and as a real rule for the polyfill,
        // which only finds animations by parsing stylesheets (see
        // scale-fade.js's positionSheet); the content has no single
        // element to set inline on, so it only has the rule.
        if (el) {
          el.style.animationName = name;
          el.style.animationRange = range;
        }
        // The polyfill reads a rule's animation-timeline alongside its
        // animation-name, so it's restated here rather than left to
        // expand.css's shared rule.
        sheet.set(
          `${selector}`,
          `${selector} { animation-name: ${name}; animation-timeline: --carousel-scroll; animation-range: ${range}; }`
        );
      });
    });
    sheet.flush();
  }

  // Painting from script, where the scroll-driven animations can't show
  // what this carousel should: past either end, where they hold the end
  // item at full, and while another carousel writes its scroll position
  // directly, where they would draw the quantised position rather than the
  // exact progress the driver asked for - which on a strip this short moves
  // the thumbnails in visible steps. !important, since that is what
  // outranks a running animation.
  function paint(state, progress, scrollError) {
    const frame = frameAt(state, progress, scrollError);
    state.targets.forEach(({ item, thumb, content }, i) => {
      item.style.setProperty("translate", frame[i].item.translate, "important");
      thumb?.style.setProperty("scale", frame[i].thumb.scale, "important");
      content.forEach((el) => el.style.setProperty("scale", frame[i].content.scale, "important"));
    });
    state.painting = true;
  }

  function clearPaint(state) {
    if (!state.painting) return;
    state.targets.forEach(({ item, thumb, content }) => {
      item.style.removeProperty("translate");
      thumb?.style.removeProperty("scale");
      content.forEach((el) => el.style.removeProperty("scale"));
    });
    state.painting = false;
  }

  function currentProgressOf(ctx, state) {
    return ctx.getScrollSource() === "driven"
      ? ctx.getDrivenProgress()
      : computeCurrentProgress(state.anchors, ctx.currentScrollAnchor());
  }

  function apply(ctx) {
    const { getScrollSource, onProgress, currentScrollAnchor } = ctx;
    const state = stateByWrapper.get(ctx.wrapper);
    const isDriven = getScrollSource() === "driven";
    const currentProgress = currentProgressOf(ctx, state);
    const overscrolled = currentProgress < 0 || currentProgress > state.items.length - 1;

    if (isDriven || overscrolled) {
      const scrollError = currentScrollAnchor() - computeScrollAnchorForProgress(state.anchors, currentProgress);
      paint(state, currentProgress, isDriven ? scrollError : 0);
    } else {
      clearPaint(state);
    }

    onProgress?.(computeCurrentIndex(currentProgress, state.items.length), currentProgress);
  }

  // This effect owns every item's rendering, and nothing it draws changes
  // an item's own border box - so the engine's item-level ResizeObserver
  // has nothing real to recover here.
  return {
    prepare,
    onItemCreated,
    setup,
    apply,
    skipItemResizeObserver: true
  };
}
