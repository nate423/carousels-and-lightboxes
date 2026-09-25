// A carousel look for fixed-size items at a constant gap, where only the
// one nearest the center grows - both its own thumbnail and the room its
// neighbours leave around it - drawn entirely with translates, never with
// a bigger layout box. Used by the iOS-Photos-style scrubber
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
// grown width, always, and shown through two clipping edges nested inside
// each other, each also laid out at the grown width: the outer one clips
// with the left corners rounded, the inner one with the right. Moving the
// outer one right by d and the inner one left by 2d leaves an opening 2d
// narrower than the thumbnail, centred, with all four corners rounded -
// never scaled, so never stretched (#8). The thumbnail moves right by d
// inside them, back to where it started, so what it holds stays put and is
// cropped narrower rather than squeezed. The outer edge also carries the
// item's shift. Nothing about the look ever changes a box's size, so
// nothing it does can move the layout, the snap points, or the scroll
// position underneath it.
//
// With G the grown width and W the collapsed one, d = (1 - grow) * (G - W) / 2,
// linear in P like the rest, so every animation here is a straight line
// between whole items.
//
// --- Flattening while it leads --------------------------------------------
//
// With flattenWhileLeading, the look falls away while the strip is being
// dragged - every thumbnail collapsed, no room made - and comes back once
// it comes to rest, as iOS Photos does. That can't be a multiplier on the
// look, since nothing on the compositor multiplies one animation by
// another. It doesn't need to be: flat doesn't depend on progress, and
// the look only needs to come back where the strip rests. So starting to
// lead, the look eases from where it stands to flat and holds there; at
// rest, it eases back to the look at that progress. Both are animations
// over the top of the scroll-driven ones, which keep running underneath -
// never paused - so the moment one goes, what's underneath already draws
// the same thing. How far along one is, is worked out from its own timing,
// so anything can start the next from exactly there: a drag that starts
// while the thumbnails are still growing back, say.
import { computeCurrentProgress, computeCurrentIndex, computeScrollAnchorForProgress } from "../carousel-math.js";
import { RuleSheet } from "./helpers/style-swap.js";
import { nextItemId } from "./helpers/item-id.js";

const FLATTEN_DURATION = 200;
const FLATTEN_STEPS = 8;

let nextStripId = 0;

const stateByWrapper = new WeakMap();

function clamp01(x) {
  return Math.min(Math.max(x, 0), 1);
}

// CSS's `ease`. The flattening samples it into keyframes rather than using
// it as the animations' easing, since the look is linear in its strength
// but a timing function would bend each segment between keyframes on its
// own, out of step with the others.
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
    const leftEdge = document.createElement("div");
    leftEdge.classList.add("expand-effect-left-edge");
    const rightEdge = document.createElement("div");
    rightEdge.classList.add("expand-effect-right-edge");
    const thumb = document.createElement("div");
    thumb.classList.add("expand-effect-thumb");
    rightEdge.appendChild(thumb);
    leftEdge.appendChild(rightEdge);
    item.appendChild(leftEdge);
  }

  // What each item draws at one progress, with `scrollError` - how far the
  // scroll position sits from where the progress belongs - carried in the
  // translate, and at one strength of the look: 1 in full, 0 flat.
  function frameAt(state, progress, scrollError = 0, strength = 1) {
    return state.items.map((item, i) => itemFrameAt(state.dims, i, progress, scrollError, strength));
  }

  function itemFrameAt(dims, i, progress, scrollError = 0, strength = 1) {
    const u = i - progress;
    const lo = clamp01(1 + u);
    const hi = clamp01(u);
    const shift = dims.footprintGrowth * ((lo + hi) / 2 - 0.5) * strength;
    const inset = (1 - (lo - hi) * strength) * dims.inset;
    return {
      leftEdge: { translate: `${shift + inset + scrollError}px 0` },
      rightEdge: { translate: `${-2 * inset}px 0` },
      thumb: { translate: `${inset}px 0` }
    };
  }

  // Each element the look draws on, per item: its two clipping edges and
  // the thumbnail inside them.
  const PARTS = ["leftEdge", "rightEdge", "thumb"];

  function targetsOf(item) {
    return {
      leftEdge: item.querySelector(".expand-effect-left-edge"),
      rightEdge: item.querySelector(".expand-effect-right-edge"),
      thumb: item.querySelector(".expand-effect-thumb")
    };
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
    const dims = { inset: (grownWidth - width) / 2, footprintGrowth: grownWidth - width + 2 * grownPadding };
    // How far each clipping edge sits in from the grown width at rest, for
    // the stylesheet to fall back on before any animation resolves.
    wrapper.style.setProperty("--expand-collapsed-inset", `${dims.inset}px`);

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
      flattening: previous?.flattening ?? { animations: [], replaced: [], from: 1, to: 1, start: 0 }
    };
    stateByWrapper.set(wrapper, state);

    // One curve for every item, across the two items either side of it:
    // 0% is the previous item current, 50% this one, 100% the next. Item 0
    // at progress -1, 0 and 1 is any item i at i - 1, i and i + 1.
    const stops = [-1, 0, 1].map((progress, k) => ({ percent: k * 50, frame: itemFrameAt(dims, 0, progress) }));
    const names = Object.fromEntries(PARTS.map((part) => [part, `expand-${part}-${stripId}`]));
    PARTS.forEach((part) =>
      sheet.set(
        `keyframes-${part}`,
        `@keyframes ${names[part]} {\n${stops.map((stop) => `  ${stop.percent}% { translate: ${stop.frame[part].translate}; }`).join("\n")}\n}`
      )
    );

    // Each item's range: from the scroll offset where the item before it is
    // current to where the item after it is. The pitch is uniform, so the
    // items either side of the ends are one pitch further out.
    const pitch = anchors.length > 1 ? anchors[1] - anchors[0] : 0;
    items.forEach((item, i) => {
      const start = anchors[i] - pitch - wrapperAnchorPoint;
      const range = `${start}px ${start + 2 * pitch}px`;
      const id = item.dataset.itemId;
      const selectors = {
        leftEdge: `.expand-effect-item[data-item-id="${id}"] .expand-effect-left-edge`,
        rightEdge: `.expand-effect-item[data-item-id="${id}"] .expand-effect-right-edge`,
        thumb: `.expand-effect-item[data-item-id="${id}"] .expand-effect-thumb`
      };
      PARTS.forEach((part) => {
        const el = state.targets[i][part];
        const selector = selectors[part];
        const name = names[part];
        // Inline for native engines, and as a real rule for the polyfill,
        // which only finds animations by parsing stylesheets (see
        // scale-fade.js's positionSheet).
        el.style.animationName = name;
        el.style.animationRange = range;
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
    state.targets.forEach((targets, i) =>
      PARTS.forEach((part) => targets[part].style.setProperty("translate", frame[i][part].translate, "important"))
    );
    state.painting = true;
  }

  function clearPaint(state) {
    if (!state.painting) return;
    state.targets.forEach((targets) => PARTS.forEach((part) => targets[part].style.removeProperty("translate")));
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
    // follows on it, and while flattened, the flattening does, even past
    // either end; anything painted here would outrank either.
    if (ctx.isOnTimeline() || state.flattening.to === 0) {
      clearPaint(state);
    } else if (isDriven || overscrolled) {
      const scrollError = currentScrollAnchor() - computeScrollAnchorForProgress(state.anchors, currentProgress);
      paint(state, currentProgress, isDriven ? scrollError : 0);
    } else {
      clearPaint(state);
    }

    onProgress?.(computeCurrentIndex(currentProgress, state.items.length), currentProgress);
  }

  // How strong the look is right now, 0 to 1, from where the flattening
  // animations have got to.
  function strengthAt(state, now) {
    const { animations, from, to, start } = state.flattening;
    if (!animations.length) return to;
    return from + (to - from) * ease(clamp01((now - start) / FLATTEN_DURATION));
  }

  // Eases the look from wherever it is to `to` - see "Flattening while it
  // leads" above. Started over the top of any still running, which it
  // replaces - but only once it has started drawing. A new animation may
  // not draw until a frame after it's made, and cancelling the one it
  // replaces first would leave that frame to the scroll-driven animations
  // underneath: the look in full, between flat and the start of growing
  // back.
  function flattenTo(ctx, state, to) {
    const now = document.timeline.currentTime;
    const from = strengthAt(state, now);
    const { animations: previous, replaced } = state.flattening;
    if (from === to && !previous.length) return;

    const progress = currentProgressOf(ctx, state);
    const frames = Array.from({ length: FLATTEN_STEPS + 1 }, (_, k) =>
      frameAt(state, progress, 0, from + (to - from) * ease(k / FLATTEN_STEPS))
    );
    // Filled backwards too: a new animation's start time can land a
    // moment after the frame it first draws in, and before it starts, one
    // filled only forwards draws nothing - leaving that frame, too, to the
    // look in full underneath.
    const timing = { duration: FLATTEN_DURATION, fill: "both", easing: "linear" };
    // Flattening, a second animation holds flat underneath the ease and
    // keeps running until replaced. WebKit runs an animation on the
    // compositor only while it is running, not while it holds its end, and
    // any scroll-driven animation already running there draws over a held
    // one: without this, the items current when the drag started spring
    // back to the full look as soon as the ease ends.
    const holds =
      to === 0
        ? state.targets.flatMap((targets, i) =>
            PARTS.map((part) => targets[part].animate([frames.at(-1)[i][part], frames.at(-1)[i][part]], { duration: FLATTEN_DURATION, iterations: Infinity }))
          )
        : [];
    const animations = [
      ...holds,
      ...state.targets.flatMap((targets, i) => PARTS.map((part) => targets[part].animate(frames.map((f) => f[i][part]), timing)))
    ];
    const flattening = { animations, replaced: [...previous, ...replaced], from, to, start: now };
    state.flattening = flattening;
    Promise.all(animations.map((animation) => animation.ready)).then(
      () => {
        flattening.replaced.forEach((animation) => animation.cancel());
        flattening.replaced = [];
      },
      () => {}
    );

    // Back in full, it draws exactly what the scroll-driven animations
    // underneath do, so once it has got there it can go.
    if (to === 1) {
      Promise.all(animations.map((animation) => animation.finished)).then(
        () => {
          if (state.flattening !== flattening) return;
          animations.forEach((animation) => animation.cancel());
          state.flattening = { animations: [], replaced: [], from: 1, to: 1, start: 0 };
        },
        () => {}
      );
    }
  }

  // Drops the flattening at once, for a strip another carousel has started
  // to drive: what drives it draws the look in full, over the top.
  function unflatten(state) {
    [...state.flattening.animations, ...state.flattening.replaced].forEach((animation) => animation.cancel());
    state.flattening = { animations: [], replaced: [], from: 1, to: 1, start: 0 };
  }

  function onMotionChange(ctx, motion) {
    if (!flattenWhileLeading) return;
    const state = stateByWrapper.get(ctx.wrapper);
    if (motion === "leading") flattenTo(ctx, state, 0);
    else if (motion === "idle") flattenTo(ctx, state, 1);
    else unflatten(state);
  }

  // Following another carousel on its timeline (see
  // linked-scrolling/timeline-follow.js): everything here is linear in
  // progress between whole items, so a keyframe at each of the leader's
  // knots is exact. The outer edge's translate also carries the distance
  // between this carousel's scroll and where it is being shown.
  function followFrames(ctx, samples) {
    const { dims, targets } = stateByWrapper.get(ctx.wrapper);
    return targets.flatMap((parts, i) =>
      PARTS.map((part) => ({
        target: parts[part],
        keyframes: samples.map(({ progress, scrollError }) => itemFrameAt(dims, i, progress, part === "leftEdge" ? scrollError : 0)[part])
      }))
    );
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
    skipItemResizeObserver: true
  };
}
