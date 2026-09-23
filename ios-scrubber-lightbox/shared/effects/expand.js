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
// Transform and opacity can animate off the main thread. The thumbnail is
// laid out at its grown width and centered inside its fixed-size item. One
// transform on that item combines translation and horizontal scaling (#1);
// whatever the thumbnail holds is scaled back the other way, so an image in it
// is cropped narrower rather than squeezed. Nothing about the look ever
// changes a box's size, so nothing it does can move the layout, the snap
// points, or the scroll position underneath it.
//
// The counter-scale is 1/s, which isn't linear in P, so its keyframes are
// sampled more finely than the others (COUNTER_STEPS per item).
//
// --- Flattening while it leads --------------------------------------------
//
// With flattenWhileLeading, the look falls away while the strip is being
// dragged - every thumbnail collapsed, no room made - and comes back once
// it lets go, as iOS Photos does. That can't be a multiplier on the look,
// which is what it used to be, because nothing on the compositor
// multiplies one animation by another. It doesn't need to be one: it only
// ever changes as the strip starts or stops leading. Starting, the look as
// it stands then eases to flat and holds there, over whatever the scroll
// does; stopping, flat eases back to the look where the strip came to rest,
// and hands back to the scroll-driven animations, which draw exactly that.
import { computeCurrentProgress, computeCurrentIndex, computeScrollAnchorForProgress } from "../carousel-math.js";
import { RuleSheet } from "./helpers/style-swap.js";
import { usingScrollTimelinePolyfill } from "../engine/polyfill.js";
import { nextItemId } from "./helpers/item-id.js";

const COUNTER_STEPS = 6;
const FLATTEN_DURATION = 200;
const FLATTEN_STEPS = 8;

let nextStripId = 0;

const stateByWrapper = new WeakMap();

function clamp01(x) {
  return Math.min(Math.max(x, 0), 1);
}

// CSS's `ease`, which the flattening used when it was a transition: the
// time-based animations below sample it into keyframes, since the
// counter-scale has to be sampled anyway and a timing function would bend
// its samples out of step with the thumbnail's own.
function ease(t) {
  const [x1, y1, x2, y2] = [0.25, 0.1, 0.25, 1];
  const bez = (a, b, s) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;
  let s = t;
  for (let i = 0; i < 8; i++) {
    const dx = (bez(x1, x2, s + 1e-4) - bez(x1, x2, s - 1e-4)) / 2e-4;
    if (!dx) break;
    s = Math.min(Math.max(s - (bez(x1, x2, s) - t) / dx, 0), 1);
  }
  return bez(y1, y2, s);
}

export function expandEffect({ flattenWhileLeading = false } = {}) {
  function onItemCreated(item) {
    item.classList.add("expand-effect-item");
    item.dataset.itemId = nextItemId();
    const thumb = document.createElement("div");
    thumb.classList.add("expand-effect-thumb");
    item.appendChild(thumb);
  }

  // What each item draws at one progress and one strength of the look (1
  // in full, 0 flat), with `scrollError` - how far the scroll position sits
  // from where the progress belongs - carried in the translate.
  function frameAt(state, progress, strength = 1, scrollError = 0) {
    const { dims } = state;
    return state.items.map((item, i) => {
      const u = i - progress;
      const lo = clamp01(1 + u);
      const hi = clamp01(u);
      const shift = dims.footprintGrowth * ((lo + hi) / 2 - 0.5) * strength;
      const scale = (dims.width + (lo - hi) * strength * (dims.grownWidth - dims.width)) / dims.grownWidth;
      return {
        item: { transform: `translateX(${shift + scrollError}px) scaleX(${scale})` },
        content: { transform: `scaleX(${1 / scale})` }
      };
    });
  }

  // Animate the item and counter-scale the content inside its clipped thumb.
  function targetsOf(item) {
    const thumb = item.querySelector(".expand-effect-thumb");
    return { item, content: thumb ? [...thumb.children] : [] };
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
      painting: previous?.painting ?? false,
      strength: previous?.strength ?? 1,
      flattening: previous?.flattening ?? []
    };
    stateByWrapper.set(wrapper, state);

    // One curve for every item, across the two items either side of it:
    // 0% is the previous item current, 50% this one, 100% the next.
    const names = { item: `expand-item-${stripId}`, content: `expand-content-${stripId}` };
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
    sheet.set("keyframes-item", keyframes(names.item, (f) => `transform: ${f.item.transform};`, linearStops));
    sheet.set("keyframes-content", keyframes(names.content, (f) => `transform: ${f.content.transform};`, curve));

    // Each item's range: from the scroll offset where the item before it is
    // current to where the item after it is. The pitch is uniform, so the
    // items either side of the ends are one pitch further out.
    const pitch = anchors.length > 1 ? anchors[1] - anchors[0] : 0;
    items.forEach((item, i) => {
      const start = anchors[i] - pitch - wrapperAnchorPoint;
      const range = `${start}px ${start + 2 * pitch}px`;
      const id = item.dataset.itemId;
      const rules = [
        [item, `.expand-effect-item[data-item-id="${id}"]`, names.item],
        [null, `.expand-effect-item[data-item-id="${id}"] > .expand-effect-thumb > *`, names.content]
      ];
      rules.forEach(([el, selector, name]) => {
        // Inline for native engines, and as a real rule for the polyfill,
        // which only finds animations by parsing stylesheets (see
        // scale-fade.js's generated rules); the content has no single
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
    const frame = frameAt(state, progress, state.strength, scrollError);
    state.targets.forEach(({ item, content }, i) => {
      item.style.setProperty("transform", frame[i].item.transform, "important");
      content.forEach((el) => el.style.setProperty("transform", frame[i].content.transform, "important"));
    });
    state.painting = true;
  }

  function clearPaint(state) {
    if (!state.painting) return;
    state.targets.forEach(({ item, content }) => {
      item.style.removeProperty("transform");
      content.forEach((el) => el.style.removeProperty("transform"));
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

    // A timeline laid across another carousel draws this one while it
    // follows on it; anything painted here would outrank it.
    if (ctx.isOnTimeline()) {
      clearPaint(state);
    } else if (isDriven || overscrolled) {
      const scrollError = currentScrollAnchor() - computeScrollAnchorForProgress(state.anchors, currentProgress);
      paint(state, currentProgress, isDriven ? scrollError : 0);
    } else {
      clearPaint(state);
    }

    onProgress?.(computeCurrentIndex(currentProgress, state.items.length), currentProgress);
  }

  // Eases the look between two strengths, at one progress, on top of the
  // scroll-driven animations - see "Flattening while it leads" above.
  function flattenTo(ctx, state, strength) {
    if (state.strength === strength) return;
    const from = state.strength;
    state.strength = strength;
    const progress = currentProgressOf(ctx, state);
    const frames = Array.from({ length: FLATTEN_STEPS + 1 }, (_, k) =>
      frameAt(state, progress, from + (strength - from) * ease(k / FLATTEN_STEPS))
    );

    // The scroll-driven animations stand aside for the whole of it - paused
    // from the moment it starts, where they only hold the look it starts
    // from, until the moment it has grown back and hands over to them.
    // Running beneath it on the same elements, they would keep the browser
    // from handing any of those elements' animations to the compositor (see
    // timeline-follow.js, which does the same), and the collapsing and
    // growing would run on the main thread. Under the polyfill there is no
    // compositor to hand anything to.
    const own = usingScrollTimelinePolyfill
      ? []
      : state.targets.flatMap(({ item, content }) =>
          [item, ...content].filter(Boolean).flatMap((el) => el.getAnimations().filter((a) => a instanceof CSSAnimation))
        );
    own.forEach((animation) => animation.pause());

    const previous = state.flattening;
    const timing = { duration: FLATTEN_DURATION, fill: "forwards", easing: "linear" };
    const animations = state.targets.flatMap(({ item, content }, i) => {
      return [
        item.animate(frames.map((f) => f[i].item), timing),
        ...content.map((el) => el.animate(frames.map((f) => f[i].content), timing))
      ];
    });
    // Started over the top of any still running the other way, which
    // they now replace.
    previous.forEach((animation) => animation.cancel());
    state.flattening = animations;

    // Back at full strength, the scroll-driven animations draw exactly
    // where this ended, so it can go - in the same task they resume, unless
    // another carousel's timeline has taken over drawing this one, which
    // resumes them itself when it's done.
    if (strength === 1) {
      Promise.all(animations.map((animation) => animation.finished)).then(
        () => {
          if (state.flattening !== animations) return;
          if (!ctx.isOnTimeline()) own.forEach((animation) => animation.play());
          animations.forEach((animation) => animation.cancel());
          state.flattening = [];
        },
        () => {}
      );
    }
  }

  function onMotionChange(ctx, motion) {
    if (!flattenWhileLeading) return;
    flattenTo(ctx, stateByWrapper.get(ctx.wrapper), motion === "leading" ? 0 : 1);
  }

  // Following another carousel on its timeline (see
  // linked-scrolling/timeline-follow.js): the same transforms drawn at
  // each sample, at full strength, with the distance between this
  // carousel's scroll and where it is being shown in the item's translate.
  function followFrames(ctx, samples) {
    const state = stateByWrapper.get(ctx.wrapper);
    const frames = samples.map(({ progress, scrollError }) => frameAt(state, progress, 1, scrollError));
    return state.targets.flatMap(({ item, content }, i) => {
      return [
        { target: item, keyframes: frames.map((f) => f[i].item) },
        ...content.map((el) => ({ target: el, keyframes: frames.map((f) => f[i].content) }))
      ];
    });
  }

  // This effect owns every item's rendering, and nothing it draws changes
  // an item's own border box - so the engine's item-level ResizeObserver
  // has nothing real to recover here.
  return {
    prepare,
    onItemCreated,
    setup,
    apply,
    onMotionChange,
    followFrames,
    // The counter-scale bends between whole items (see above), so a
    // timeline laid across another carousel samples it more finely.
    followSteps: COUNTER_STEPS,
    skipItemResizeObserver: true
  };
}
