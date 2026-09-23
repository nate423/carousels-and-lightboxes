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
// before stopping, so either way the frame that paints shows the same thing
// the previous one did, drawn the other way - including a new animation's
// first frame, which the browser may leave for the next one to start. When
// to stop - the moment real input lands on the follower, not when anything
// settles - is the engine's to decide; see follow() in carousel-engine.js.
//
// Nor does it wait for the leader to move. A follower goes onto its
// leader's timeline while the two are at rest together (see link.js), and
// stays on it through any number of the leader's gestures, so the cost of
// building the animations is paid while nothing is moving, and the
// leader's first frame of motion is already the follower's too.
import { computeScrollAnchorForProgress } from "../carousel-math.js";

// Evaluated after the polyfill has installed its own where the browser has
// none, since the polyfill loads before any module does.
export const timelineFollowSupported = typeof ScrollTimeline === "function";

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

export function createTimelineFollow({ effect, ctx }) {
  let showing = null;

  // Whether the leader's timeline can show this progress at all. It covers
  // exactly the leader's scroll range, so a leader rubber-banding past
  // either end has left it, and the follower has to be driven directly
  // there instead to wind its end item down.
  function covers(knots, progress) {
    return knots.length > 1 && progress >= knots[0].progress && progress <= knots[knots.length - 1].progress;
  }

  function canShow(leader) {
    if (!timelineFollowSupported || !effect.followFrames) return false;
    return covers(leader.getProgressKnots(), leader.getCurrentProgress());
  }

  function show(leader) {
    const knots = leader.getProgressKnots();
    const { anchors } = ctx.getGeometry();
    const scrollAnchor = ctx.currentScrollAnchor();
    const samples = knots.map(({ progress }) => ({
      progress,
      scrollError: scrollAnchor - computeScrollAnchorForProgress(anchors, progress)
    }));

    const timeline = timelineFor(leader.wrapper);
    const animations = effect.followFrames(ctx, samples).map(({ target, keyframes }) =>
      target.animate(
        keyframes.map((keyframe, i) => ({ ...keyframe, offset: knots[i].offset })),
        { timeline, fill: "both", easing: "linear" }
      )
    );

    showing = { leader, animations, scrollLeft: ctx.wrapper.scrollLeft };
  }

  function stop() {
    if (!showing) return;
    showing.animations.forEach((animation) => animation.cancel());
    showing = null;
  }

  return {
    canShow,
    show,
    stop,
    // The leader this carousel is showing, or null while it shows its own
    // scroll position.
    leader: () => showing?.leader ?? null,
    // Where this carousel's real scroll position was when the timeline took
    // over, which every keyframe's error is measured from.
    scrollLeftShownFrom: () => showing?.scrollLeft
  };
}
