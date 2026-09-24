// A carousel following another continuously, drawn by animations on the
// leader's own scroll timeline instead of by writing its scroll position on
// every scroll of the leader.
//
// Written from script, a follower is several steps behind the finger: the
// leader scrolls, its scroll event reaches the main thread, the link writes
// the follower's scroll position, and only then can the follower's own
// scroll-driven look catch up. On a timeline there are no steps. The
// follower's look is keyframed directly against the leader's scroll offset,
// so it moves whenever and however the leader's own look does, with no
// script in between and no quantised scroll position to correct for.
//
// This is exact rather than sampled. The follower's progress is the
// leader's, and the leader's progress is linear in its scroll offset
// between neighbouring item anchors. Every look here is linear in progress
// between whole items too, and so is where the follower's track would be
// scrolled to. So a keyframe at each of the leader's anchors
// (computeProgressKnots) is the entire curve.
//
// While this is showing, the follower's real scroll position stays wherever
// it was when following began, and its look is drawn with the difference
// folded in as a translate: the same --scroll-error correction a driven
// carousel already carries for quantisation, only larger. The effect
// supplies the keyframes (followFrames) at each sample's progress and
// error; this module knows nothing about how any look draws.
//
// Starting and stopping never shows. The carousel engine writes the real
// scroll position to the progress being shown before starting, and again
// before stopping, and the look draws that progress itself until the
// timeline's animations are ready - a new animation may leave its first
// frame or so for later ones to draw. So either way the frame that paints
// shows the same thing the previous one did, drawn the other way. When
// to stop - the moment real input lands on the follower, not when anything
// settles - is the engine's to decide; see follow() in carousel-engine.js.
//
// It lasts one of the leader's gestures. A follower goes onto the timeline
// on the leader's first scroll, and comes off when the gesture ends, onto a
// real scroll position on the item the leader came to rest on (see
// link.js). Left on at rest, it would carry into the follower anything that
// moves the leader's scroll without anyone asking - a resnap, or iOS
// nudging a strip as its thumbnails grow back - several times over.
import { computeScrollAnchorForProgress } from "../carousel-math.js";
import { usingScrollTimelinePolyfill } from "../engine/polyfill.js";

// Only where the browser runs scroll timelines itself. The scroll-timeline
// polyfill runs them from scroll events, in script, so drawing a follower on
// one gains nothing over writing its scroll position - and the polyfill's
// first update of a follower's animations holds up the leader's first
// scroll by about 110ms, on the iOS scrubber (#17).
export const timelineFollowSupported = typeof ScrollTimeline === "function" && !usingScrollTimelinePolyfill;

// One per leader, shared by every carousel following it.
const timelines = new WeakMap();

function timelineFor(source) {
  let timeline = timelines.get(source);
  if (!timeline) {
    timeline = new ScrollTimeline({ source, axis: "x" });
    timelines.set(source, timeline);
  }
  return timeline;
}

export function createTimelineFollow({ effect, ctx, enabled = true }) {
  let showing = null;

  // Whether the leader's timeline can show this progress at all. It covers
  // exactly the leader's scroll range, so a leader rubber-banding past
  // either end has left it, and the follower has to be driven directly
  // there instead to wind its end item down.
  function covers(knots, progress) {
    return knots.length > 1 && progress >= knots[0].progress && progress <= knots[knots.length - 1].progress;
  }

  function canShow(leader) {
    if (!enabled || !timelineFollowSupported || !effect.followFrames) return false;
    return covers(leader.getProgressKnots(), leader.getCurrentProgress());
  }

  // `onLeaderGeometryChange` is called if the leader's items move while this
  // is showing, since these keyframes are laid out against where they are.
  // `onDrawing` is called once the timeline has actually started drawing
  // this carousel (see drawing below).
  function show(leader, { onLeaderGeometryChange, onDrawing } = {}) {
    const knots = leader.getProgressKnots();
    const { anchors } = ctx.getGeometry();
    const scrollAnchor = ctx.currentScrollAnchor();
    const samples = knots.map(({ progress }) => ({
      progress,
      scrollError: scrollAnchor - computeScrollAnchorForProgress(anchors, progress)
    }));

    // This carousel's own scroll-driven animations keep running
    // underneath, outranked, rather than being paused while the timeline
    // draws it. A paused one holds the look it had when it was paused, and
    // a resumed one can take a frame to catch up, so on the way off it
    // would show that old look at the scroll position just written.
    const timeline = timelineFor(leader.wrapper);
    const animations = effect.followFrames(ctx, samples).map(({ target, keyframes }) =>
      target.animate(
        keyframes.map((keyframe, i) => ({ ...keyframe, offset: knots[i].offset })),
        { timeline, fill: "both", easing: "linear" }
      )
    );

    const unsubscribe = leader.onGeometryChange?.(() => onLeaderGeometryChange?.());
    const shown = { leader, animations, scrollLeft: ctx.wrapper.scrollLeft, unsubscribe, drawing: false };
    showing = shown;

    // A new animation may not draw until a frame or so after it starts, and
    // nothing underneath it can be trusted to show the right thing in the
    // meantime: Chrome's timeline for this carousel still reads its scroll
    // position from before the write that preceded this, for a frame. So
    // until these are ready, the look keeps drawing this carousel itself.
    Promise.all(animations.map((animation) => animation.ready)).then(
      () => {
        if (showing !== shown) return;
        shown.drawing = true;
        onDrawing?.();
      },
      () => {}
    );
  }

  function stop() {
    if (!showing) return;
    showing.animations.forEach((animation) => animation.cancel());
    showing.unsubscribe?.();
    showing = null;
  }

  return {
    canShow,
    show,
    stop,
    // The leader this carousel is showing, or null while it shows its own
    // scroll position.
    leader: () => showing?.leader ?? null,
    // Whether the timeline is drawing this carousel yet, which it doesn't
    // until its animations are ready.
    drawing: () => Boolean(showing?.drawing),
    // Where this carousel's real scroll position was when the timeline took
    // over, which every keyframe's error is measured from.
    scrollLeftShownFrom: () => showing?.scrollLeft
  };
}
