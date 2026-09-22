// Every scroll a carousel wrapper emits is attributed to one of two sources,
// and anything watching it - a link relaying it to another carousel, an
// effect that renders differently depending on who is moving it (see
// the iOS scrubber's look.js) - reads that attribution instead of trying to
// reconstruct it from raw DOM events of its own.
//
//   "self"   - this carousel is moving for its own reasons: a real gesture
//              on it, or a goToIndex command aimed at it.
//              Authoritative motion, and the only kind worth relaying.
//   "driven" - an outside driver is writing this carousel's scroll position
//              directly through setProgressDirect. The scroll events that
//              follow are echoes of that write, not new information.
//
// "driven" is a hard, sticky state rather than a timing window, because a
// programmatic write's consequences have no bounded duration: the write
// fires its own native 'scroll' event (the echo), and so does the browser's
// scroll-snap "resnap" correction, which runs *asynchronously* after snap is
// handed back and can itself animate for an unpredictable stretch (observed
// up to ~1.8s) whenever the anchor we computed isn't pixel-identical to the
// browser's own snap-point geometry. Neither can happen without
// noteDirectWrite having run first, so "has anything moved this carousel for
// its own reasons since the last direct write" is a complete, exact answer -
// no elapsed-time guess, and so no window that might cut off a legitimate
// but slow-to-arrive correction.
//
// Event ordering makes the flip back to "self" safe even when real input
// lands in the same batched frame as a pending echo: an input handler runs
// synchronously as part of input dispatch, before the 'scroll' it causes is
// ever queued, so the attribution is already correct by the time that
// scroll event's own handler runs.
//
// This module also tracks motion - a separate question from attribution.
// Three states:
//
//   "leading"   - moving for its own reasons, right now.
//   "following" - being moved by a driver, right now.
//   "idle"      - at rest, whoever moved it last.
//
// Attribution is deliberately sticky: it stays "driven" through the whole
// unbounded tail of echoes and resnap corrections a direct write can
// provoke, which is what makes it safe to suppress those. Motion is bounded
// instead - by a real scroll event or a direct write on the way in, and by
// the caller telling this module when a gesture ends on the way out (see
// endLeading/endFollowing). Reading attribution as if it were motion is the
// trap: "self" is also what a carousel at rest reports, so anything that
// treats it as "leading" fires at page load, before a gesture has happened
// at all.
export function createScrollAttribution(wrapper, { onSelfReclaim } = {}) {
  let scrollSource = "self";

  // Whether this carousel is currently scrolling for its own reasons, and
  // when that stretch of movement began. Both are derived from real scroll
  // events rather than from input events, which is the only way to get this
  // right: the browser latches a wheel gesture to whichever scroller it
  // started on, but keeps dispatching the wheel events themselves to
  // whatever is under the cursor. Move the cursor to another carousel
  // mid-flick and its wheel handlers fire while the original scroller is the
  // one actually moving, so anything that reads input to decide who is in
  // charge names the wrong one.
  let movingItself = false;
  let selfScrollStartedAt = 0;

  // The same question asked about the other source: whether a drive is
  // currently moving this carousel. Unlike movingItself it cannot be read
  // off scroll events alone, because a drive does not reliably produce one -
  // a scroll position is quantised, so when a short scroller is driven by a
  // much longer one most frames resolve to the pixel it is already on and
  // emit nothing (see the note in noteDirectWrite). noteDirectWrite
  // therefore sets this itself. That is sound where inferring a gesture from
  // input events would not be: a direct write is this module's own doing,
  // not a guess about which scroller the browser latched.
  let movingDriven = false;

  // The exact progress the last direct write was asked for. Worth keeping
  // because it cannot be recovered afterwards: writing it moves scrollLeft,
  // and a scroll position is quantised - WebKit reports whole pixels - so
  // reading it back returns a coarser value than went in. An effect
  // rendering a driven carousel should use this rather than measure the
  // scroll position it was just handed.
  let lastDrivenProgress = 0;

  function getMotionState() {
    if (movingItself) return "leading";
    if (movingDriven) return "following";
    return "idle";
  }

  function markSelfDriven() {
    scrollSource = "self";
    // Whatever a driver was doing to this carousel, it is not what is moving
    // it any more.
    movingDriven = false;
    // This carousel is the user's again, so any snap suspension left over
    // from a drive needs ending too - the caller owns that, not this module.
    onSelfReclaim?.();
  }

  // touchmove/pointerdown cover fingers and scrollbar drags; keydown covers
  // arrow/page/home/end scrolling on browsers that make scrollers focusable.
  ["wheel", "touchmove", "pointerdown", "keydown"].forEach((type) =>
    wrapper.addEventListener(type, markSelfDriven, { passive: true })
  );

  return {
    getScrollSource: () => scrollSource,
    getMotionState,
    isMovingItself: () => movingItself,
    selfScrollStartedAt: () => selfScrollStartedAt,
    getDrivenProgress: () => lastDrivenProgress,

    // Called by goToIndex: an explicit command to this
    // carousel, not an echo of something driving it, so the scrolling it is
    // about to do counts as moving for its own reasons and propagates
    // through a link. Unlike markSelfDriven this isn't a reclaim from a
    // drive - a command can equally happen while already "self" - so it
    // doesn't touch movingDriven or trigger onSelfReclaim.
    noteSelfCommand() {
      scrollSource = "self";
    },

    // Called by setProgressDirect: an outside driver is about to write this
    // wrapper's scroll position directly.
    noteDirectWrite(progress) {
      scrollSource = "driven";
      movingDriven = true;
      lastDrivenProgress = progress;
    },

    // Called from the wrapper's own 'scroll' listener to update movingItself
    // and selfScrollStartedAt from the current attribution.
    noteScrollEvent() {
      const nowMovingItself = scrollSource === "self";
      if (nowMovingItself && !movingItself) selfScrollStartedAt = performance.now();
      movingItself = nowMovingItself;
    },

    // Called from the wrapper's own 'scrollend'. Returns whether this was
    // actually a leading gesture ending, so a spurious/early scrollend with
    // no leading motion behind it (or one that fires while merely being
    // driven) can be told apart from the real thing.
    endLeading() {
      const wasLeading = movingItself;
      movingItself = false;
      return wasLeading;
    },

    // Ends "following" - called once the carousel actually driving this one
    // reports that *its* gesture is over (see link.js), not off
    // this wrapper's own 'scrollend': a driven carousel's scroll position is
    // quantised (noteDirectWrite's note above), so most frames of a slow
    // drive leave it sitting on the same pixel for a stretch well past what
    // the browser treats as "no longer scrolling", firing this wrapper's own
    // scrollend while the carousel actually driving it is still moving. The
    // leader's scrollend has no such problem - it's real, continuous scroll
    // input - so it's the only reliable end-of-motion signal for the side
    // being driven. Returns whether anything actually changed.
    endFollowing() {
      if (!movingDriven) return false;
      movingDriven = false;
      return true;
    }
  };
}
