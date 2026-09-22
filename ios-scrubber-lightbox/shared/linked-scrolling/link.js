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
//     fractional progress, written every frame, so it tracks the leader's
//     scroll in lock-step the whole time it moves.
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
// onScrollEnd and endFollowing.
import { computeCurrentIndex } from "../carousel-math.js";

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
    // dest's own "following" motion ends here, off source's real scrollend,
    // rather than off any scrollend dest itself fires - see endFollowing in
    // carousel-engine.js for why dest's own native scrollend can't be
    // trusted for this while it's the one being driven.
    source.onScrollEnd(() => dest.endFollowing());

    source.onScroll(({ source: scrollSource }) => {
      if (scrollSource === "driven") {
        // This carousel is being written to by us; everything it emits until
        // something moves it for its own reasons is an echo of that write.
        return;
      }
      // `source` is moving for its own reasons, or we'd have returned above.
      // It may drive unless `dest` is also moving for its own reasons and
      // started doing so more recently - flick one carousel hard, then flick
      // the other while the first is still coasting, and both are genuinely
      // moving at once; without a rule each wire writes the other every frame
      // and they settle disagreeing.
      //
      // Both facts come from real scroll events, never from input events. The
      // browser latches a wheel gesture to the scroller it began on while
      // still dispatching wheel events to whatever is under the cursor, so
      // input says nothing reliable about which carousel is actually moving.
      if (dest.isMovingItself() && dest.selfScrollStartedAt() > source.selfScrollStartedAt()) {
        return;
      }

      const progress = source.getCurrentProgress();

      // `dest` is the one being written, so it is the one following, so its
      // setting is the one that applies.
      if (whileFollowing.get(dest) === "continuous") {
        writeToDest(progress);
        return;
      }

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
      writeToDest(index);
    });

    function writeToDest(progress) {
      // setProgressDirect handles its own scroll-snap suspension and marks
      // dest as driven, so the echo it's about to emit is already correctly
      // attributed by the time dest's own subscription sees it.
      dest.setProgressDirect(progress);
    }
  }

  wire(a, b);
  wire(b, a);
}
