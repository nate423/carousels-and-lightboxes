// Live-gesture mirroring between two carousel-engine instances: whichever one
// is actively being scrolled drives the other in real time, off its own
// currentProgress. Never via wrapper.scrollTo(), since the source's progress
// changes continuously during a live gesture and native smooth-scroll only
// makes sense against a fixed destination.
//
// Each direction is independently configurable between two response modes:
//   - "continuous": the driven side is a 1:1 read of the source's live,
//     fractional progress, written every frame, so it tracks the source's
//     scroll in lock-step the whole time it moves.
//   - "instant": the driven side stays put until the source's discrete
//     current item changes (crossing the 50% threshold to a neighbour), then
//     jumps straight to it with no motion in between.
//
// This module touches no DOM of its own. Whether a given scroll is the user's
// doing or an echo of a write we just made is carousel-engine's to answer -
// see the scroll-attribution block there. Everything below works off the two
// controllers' public surface: onScroll's `source`, getScrollSource,
// isMovingItself, selfScrollStartedAt, getCurrentProgress and setProgressDirect.
import { computeCurrentIndex } from "./carousel-math.js";

// Temporary - flip off (or delete this whole block and its call sites below)
// once things feel settled. Every decision this link makes goes into a ring
// buffer as well as the console; run __linkTrace() in the console to dump the
// whole thing as text.
const DEBUG = true;
const trace = [];
let lastLogAt = null;

function record(entry) {
  trace.push(entry);
  if (trace.length > 600) trace.shift();
}

function debugLog(directionKey, label, data) {
  if (!DEBUG) return;
  const now = performance.now();
  const sinceLast = lastLogAt === null ? null : Math.round(now - lastLogAt);
  lastLogAt = now;
  const entry = { t: Math.round(now), ms: sinceLast, dir: directionKey, label, ...data };
  record(entry);
  console.log(`[carousel-link] ${directionKey} ${label}`, entry);
}

if (DEBUG) {
  // Which element each wheel tick is dispatched to, and how big it is. Note
  // this is NOT which carousel the tick actually scrolls: the browser latches
  // a gesture to the scroller it began on and keeps scrolling that one, while
  // dispatching the events to whatever the cursor has since moved over. Useful
  // for spotting that divergence, not for deciding anything.
  document.addEventListener(
    "wheel",
    (event) => {
      const wrapper = event.target.closest?.(".carousel-wrapper");
      record({
        t: Math.round(performance.now()),
        label: "wheel",
        on: wrapper ? wrapper.id || "(unnamed wrapper)" : "(outside any carousel)",
        delta: Math.round(Math.abs(event.deltaX) + Math.abs(event.deltaY)),
        deltaMode: event.deltaMode
      });
    },
    { capture: true, passive: true }
  );

  window.__linkTrace = () => {
    const text = trace.map((entry) => JSON.stringify(entry)).join("\n");
    console.log(text);
    return text;
  };
}

function currentIndexOf(carousel) {
  return computeCurrentIndex(carousel.getCurrentProgress(), carousel.getItems().length);
}

export function linkCarousels(a, b, { aToB = "continuous", bToA = "instant" } = {}) {
  // Mutable, not captured per-wire - setMode() (see the returned controller)
  // can flip either direction's mode live, e.g. from a debug control, without
  // tearing down and re-registering the scroll subscriptions below.
  const modes = { aToB, bToA };

  function wire(source, dest, directionKey) {
    // Cheap enough to attach to every log line: scrollLeft is already being
    // read this frame, so unlike getCurrentProgress this forces no layout.
    const snapshot = () => ({
      srcAttr: source.getScrollSource(),
      dstAttr: dest.getScrollSource(),
      srcMoving: source.isMovingItself(),
      dstMoving: dest.isMovingItself(),
      srcStartedAgoMs: Math.round(performance.now() - source.selfScrollStartedAt()),
      dstStartedAgoMs: Math.round(performance.now() - dest.selfScrollStartedAt()),
      srcSL: Math.round(source.wrapper.scrollLeft),
      dstSL: Math.round(dest.wrapper.scrollLeft)
    });

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
        debugLog(directionKey, "yielded (dest started moving more recently)", snapshot());
        return;
      }

      const progress = source.getCurrentProgress();

      if (modes[directionKey] === "continuous") {
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
      // Sampled before the write, since setProgressDirect immediately marks
      // dest as driven. Writing to a dest that was moving under its own steam
      // is the case worth seeing: both wires are then writing each other, and
      // they can end up disagreeing.
      const destWasMovingItself = dest.getScrollSource() === "self";

      // setProgressDirect handles its own scroll-snap suspension and marks
      // dest as driven, so the echo it's about to emit is already correctly
      // attributed by the time dest's own subscription sees it.
      dest.setProgressDirect(progress);

      if (destWasMovingItself) {
        debugLog(directionKey, "CONTESTED write (dest was moving itself)", {
          wrote: +progress.toFixed(2),
          ...snapshot()
        });
      }
    }
  }

  wire(a, b, "aToB");
  wire(b, a, "bToA");

  return {
    setMode(directionKey, mode) {
      modes[directionKey] = mode;
    }
  };
}
