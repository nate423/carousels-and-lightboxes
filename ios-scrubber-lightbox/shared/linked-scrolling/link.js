// Live-gesture mirroring between two carousel-engine instances: whichever one
// is actively being scrolled drives the other in real time, off its own
// currentProgress. Never via wrapper.scrollTo(), since the source's progress
// changes continuously during a live gesture and native smooth-scroll only
// makes sense against a fixed destination.
//
// How a carousel comes along is a property of that carousel while it is the
// one following, not of the direction an update happens to travel. Each side
// of the link carries its own:
//   - "continuous": the following side is a 1:1 read of the leader's live,
//     fractional progress, so it tracks the leader's scroll in lock-step the
//     whole time it moves. How it gets there - on the leader's own scroll
//     timeline where it can, by writing its scroll position where it can't -
//     is the following carousel's own business (its follow()).
//   - "instant": the following side stays put until the leader's discrete
//     current item changes (crossing the 50% threshold to a neighbour), then
//     jumps straight to it with no motion in between.
//
// Kept per carousel per link, rather than once per carousel, so a carousel
// linked to more than one other can follow each of them differently - "b
// follows a continuously but follows c instantly" - which a single property
// on b could not say. Nothing here makes either side primary: whichever
// carousel is moving for its own reasons leads, and the other one's own
// setting decides how it follows. Both are fixed for the life of the link;
// each page decides its pairing once, at the call site.
//
// This module touches no DOM of its own. Whether a given scroll is the user's
// doing or an echo of a write we just made is carousel-engine's to answer -
// see the scroll-attribution block there. Everything below works off the two
// controllers' public surface: onScroll's `source`, getScrollSource,
// isMovingItself, selfScrollStartedAt, getCurrentProgress, setProgressDirect,
// follow, onScrollEnd and endFollowing.
import { computeCurrentIndex } from "../carousel-math.js";

// Where a carousel that has come to rest is: on the item nearest its
// progress, if its progress is close enough to one to be rounding in its
// scroll position - mandatory snap leaves it on an item - and where it is,
// if not.
function restingProgress(carousel) {
  const progress = carousel.getCurrentProgress();
  const nearest = Math.round(progress);
  return Math.abs(progress - nearest) < 0.05 ? nearest : progress;
}

function currentIndexOf(carousel) {
  return computeCurrentIndex(carousel.getCurrentProgress(), carousel.getItems().length);
}

export function linkCarousels(a, b, { aWhileFollowing, bWhileFollowing }) {
  // Keyed by the carousel itself rather than by a position in this call's
  // arguments, so nothing downstream has to know which one was passed first -
  // there is no "a role" and "b role" here, only two carousels.
  const whileFollowing = new Map([
    [a, aWhileFollowing],
    [b, bWhileFollowing]
  ]);

  function wire(source, dest) {
    // Guards shared between the sync below and the scrollend
    // catch-up: never step on a dest that's genuinely mid-gesture itself
    // (see the comment at its one call site in sync()).
    function destMovingMoreRecently() {
      return dest.isMovingItself() && dest.selfScrollStartedAt() > source.selfScrollStartedAt();
    }

    // The sync, shared by onScroll (below) and the scrollend
    // catch-up. Takes source's progress fresh each call rather than once
    // up front, since the catch-up call wants source's truly-final,
    // fully-settled position - not whatever it was on the last onScroll
    // tick, which for "instant" mode is only re-checked on the *next*
    // source scroll event and so has nothing to correct it if source goes
    // idle right after a tick that undershot the real rest position (a
    // driven dest with its own async reconciliation - see
    // ramka-slides-controller.js's page - can do exactly that: a hard
    // flick on the strip left the main carousel stuck a couple of items
    // short, having gotten no further update once the strip stopped
    // emitting scroll events).
    //
    // `atRest` is the catch-up: source's gesture is over and it has come to
    // rest on an item. What's left of its progress past that item is
    // rounding in its scroll position, which a continuous follower several
    // times its size would show several times over, so the follower lands on
    // the item itself, on a real scroll position rather than on source's
    // timeline, and nothing source's scroll does from here reaches it.
    function sync({ atRest = false } = {}) {
      if (destMovingMoreRecently()) return;

      // `dest` is the one being moved, so it is the one following, so its
      // setting is the one that applies. Either way dest handles its own
      // scroll-snap suspension and marks itself as driven, so the echo of
      // any write is already correctly attributed by the time dest's own
      // subscription sees it.
      if (whileFollowing.get(dest) === "continuous") {
        if (atRest) dest.setProgressDirect(restingProgress(source));
        else dest.follow(source);
        return;
      }

      const progress = source.getCurrentProgress();

      // "instant": only react once the source's discrete current item
      // differs from the one dest is already showing - an integer progress
      // value lands dest exactly on that item's own anchor, same as any
      // other item position.
      //
      // Compared against dest's *actual* current item rather than a
      // remembered "last index we saw on source". A remembered value goes
      // stale precisely when the other direction is driving, since this
      // subscription returns early on every one of those frames and so never
      // updates it: drive the strip from item 0 to item 3 and this wire
      // still believes the strip is on 0, so scrubbing it back to 0 reads as
      // "no change" and the main carousel never follows. Asking dest where
      // it actually is can't drift, and self-corrects after any desync.
      const index = computeCurrentIndex(progress, source.getItems().length);
      const destIndex = currentIndexOf(dest);
      if (index === destIndex) return;
      dest.setProgressDirect(index);
    }

    // dest's own "following" motion ends here, off source's real scrollend,
    // rather than off any scrollend dest itself fires - see endFollowing in
    // carousel-engine.js for why dest's own native scrollend can't be
    // trusted for this while it's the one being driven. onScrollEnd only
    // ever fires on a real leading gesture ending (see its own doc comment
    // in carousel-engine.js), so unlike onScroll below, sync() here needs no
    // "was this a driven echo" check - by definition it wasn't.
    //
    // Not while source is still held: a scroll that ends under a finger -
    // one the browser made itself, say - isn't the end of the gesture.
    source.onScrollEnd(() => {
      if (source.isPressed?.()) return;
      dest.yieldLead?.(false);
      sync({ atRest: true });
      dest.endFollowing();
    });

    // One carousel at a time. With a finger on one, a second finger can't
    // start dragging the other: two carousels that each drive the other,
    // both moved by hand at once, can only disagree about where they are.
    // Whichever is touched first is the one being driven by hand, until it
    // is let go.
    //
    // And the last touch leads. Touching source stops whatever dest is still
    // doing of its own accord - coasting from a flick let go of a moment
    // ago - so source drives it from its first frame, rather than the two
    // writing each other until one of them comes to rest.
    source.onPressChange?.((pressed) => {
      dest.lockPanning?.(pressed);
      dest.yieldLead?.(pressed, { otherMoving: source.isMovingItself() });
    });

    // A sideways wheel on source does the same, until source comes to rest
    // (onScrollEnd, above) - a wheel has no moment of being let go. The
    // carousel it leaves behind is usually still snapping onto an item,
    // whose scroll events would otherwise keep driving source and mark its
    // own scrolling as echoes of that.
    source.onWheel?.(() => dest.yieldLead?.(true, { wheel: true }));

    source.onScroll(({ source: scrollSource }) => {
      if (scrollSource === "driven") {
        // This carousel is being written to by us; everything it emits until
        // something moves it for its own reasons is an echo of that write.
        return;
      }
      if (!source.isMovingItself()) {
        // Scrolled, but not because anything asked it to move: the browser
        // re-snapping it after a layout change, or nudging it as its effect
        // changes size - which iOS does to the iOS scrubber's strip as its
        // thumbnails grow back after a drag. Only a carousel moving for its
        // own reasons leads, or that nudge, several times over, moves the
        // carousel following it.
        return;
      }
      // `source` is moving for its own reasons, or we'd have returned above.
      // It may drive unless `dest` is also moving for its own reasons and
      // started doing so more recently - flick one carousel with a wheel,
      // then the other while the first is still coasting, and both are
      // genuinely moving at once; without a rule each wire writes the other
      // every frame and they settle disagreeing. A touch or click settles
      // this before either moves (yieldLead, above); a wheel can't.
      //
      // For a wheel both facts come from real scroll events, never from
      // input events. The browser latches a wheel gesture to the scroller it
      // began on while still dispatching wheel events to whatever is under
      // the cursor, so a wheel event says nothing reliable about which
      // carousel is actually moving.
      sync();
    });
  }

  wire(a, b);
  wire(b, a);
}
