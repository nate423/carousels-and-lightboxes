// Live-gesture mirroring between two carousel-engine instances: whichever
// one is actively being scrolled drives the other, in real time, off its own
// currentProgress - never via a native wrapper.scrollTo() for a moving
// target, since the source progress is itself continuously changing during a
// live scroll/drag and native smooth-scroll only makes sense against a fixed
// destination.
//
// Per direction, configurable between two response modes:
//   - "continuous": the driven side is a direct 1:1 read of the source's
//     live, fractional progress, written every frame - it visibly tracks the
//     source's scroll pixel-for-pixel, in lock-step, the whole time it's
//     moving.
//   - "instant": the driven side doesn't move at all until the source's
//     *discrete* current item actually changes (crosses the 50% threshold to
//     a neighbor) - at that moment it jumps straight to showing the new item
//     as current, with no motion in between.
// (An earlier third mode eased the driven side toward the source's progress
// over several frames instead of matching either of the above exactly -
// dropped entirely: scroll-snap kept fighting the deliberately-unsettled
// in-between position it relied on holding, which read as a flicker rather
// than an ease no matter how that fight was mitigated.)
//
// This module deliberately touches no DOM of its own. Deciding whether a
// given scroll is the user's doing or an echo of a write we just made used
// to live here, reconstructed from wheel/touchmove listeners on each
// wrapper; it belongs to carousel-engine.js now, which knows first-hand
// which of its own movements it caused (see the scroll-attribution block
// there). Everything below works purely off the two controllers' public
// surface: onScroll's `source`, getScrollSource, getLastInputStrength,
// getCurrentProgress and setProgressDirect.
import { computeCurrentIndex } from "./carousel-math.js";

const LIVENESS_MS = 50; // ~3 dropped frames at 60fps - how stale the other carousel's last accepted scroll can be and still count as "still actively moving" (see the interrupt check below)
const MIN_STEAL_STRENGTH = 15; // input strength required to interrupt a carousel that's still live - see the interrupt check below

// Temporary - flip off (or delete this whole block and its call sites below)
// once things feel settled. Logs each scroll-driven decision this link makes
// with a timestamp and how long the write itself took, so a slow/irregular
// frame cadence shows up directly in the console instead of being guessed at.
const DEBUG = true;
let lastLogAt = null;
function debugLog(directionKey, label, data) {
  if (!DEBUG) return;
  const now = performance.now();
  const sinceLast = lastLogAt === null ? null : Math.round(now - lastLogAt);
  lastLogAt = now;
  console.log(`[carousel-link] ${directionKey} ${label}`, { sinceLastLogMs: sinceLast, ...data });
}

function currentIndexOf(carousel) {
  return computeCurrentIndex(carousel.getCurrentProgress(), carousel.getItems().length);
}

export function linkCarousels(a, b, { aToB = "continuous", bToA = "instant" } = {}) {
  // Mutable, not captured per-wire - setMode() (see the returned controller)
  // can flip either direction's mode live, e.g. from a debug control, without
  // tearing down and re-registering the scroll subscriptions below.
  const modes = { aToB, bToA };

  // Per-side link state. The carousels themselves own everything about who
  // is moving them; all this layer adds is when each side was last seen
  // moving under its own steam, which is what the interrupt check needs.
  const sides = {
    a: { carousel: a, lastAcceptedScrollAt: null },
    b: { carousel: b, lastAcceptedScrollAt: null }
  };

  function wire(source, dest, directionKey) {
    source.carousel.onScroll(({ source: scrollSource }) => {
      const handlerStart = performance.now();

      if (scrollSource === "driven") {
        // This carousel is being written to by us; everything it emits until
        // something moves it for its own reasons is an echo of that write.
        debugLog(directionKey, "ignored (driven by us, not yet reclaimed)");
        return;
      }
      source.lastAcceptedScrollAt = handlerStart;

      // `dest` is the only other carousel in this link. If it's currently
      // moving under its own steam (not because we're driving it - exclude
      // that with its own attribution, or our echo chain into it would look
      // "alive" here too), don't let a weak tick fight it.
      //
      // Liveness alone isn't enough, though: during a hard flick's momentum
      // tail, dest keeps refreshing lastAcceptedScrollAt every ~8-16ms for
      // as long as it coasts, so a pure liveness check would suppress a
      // genuinely deliberate quick-flick-to-take-over for that whole
      // stretch - directly against wanting whichever side you actually
      // touch most recently to win immediately. A decisive input (a real
      // flick or drag's opening delta, a finger, a scrollbar press - much
      // bigger than the late, decaying residue of someone else's momentum
      // tail) bypasses the liveness check entirely and takes over right
      // away; only a weak one gets held back while dest is still genuinely
      // moving. See getLastInputStrength in carousel-engine.js for why only
      // wheel input can ever be weak.
      const destStillLive =
        dest.carousel.getScrollSource() !== "driven" &&
        dest.lastAcceptedScrollAt !== null &&
        handlerStart - dest.lastAcceptedScrollAt < LIVENESS_MS;
      const inputStrength = source.carousel.getLastInputStrength();
      if (destStillLive && inputStrength < MIN_STEAL_STRENGTH) {
        debugLog(directionKey, "suppressed (dest still live, weak input)", { inputStrength });
        return;
      }

      const progress = source.carousel.getCurrentProgress();

      if (modes[directionKey] === "continuous") {
        writeToDest(progress);
        debugLog(directionKey, "continuous frame", {
          progress,
          handlerDurationMs: +(performance.now() - handlerStart).toFixed(2)
        });
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
      const index = computeCurrentIndex(progress, source.carousel.getItems().length);
      const destIndex = currentIndexOf(dest.carousel);
      if (index === destIndex) {
        debugLog(directionKey, "instant no-op (dest already current)", { index });
        return;
      }
      writeToDest(index);
    });

    function writeToDest(progress) {
      // setProgressDirect handles its own scroll-snap suspension and marks
      // dest as driven, so the echo it's about to emit is already correctly
      // attributed by the time dest's own subscription sees it.
      const t0 = performance.now();
      dest.carousel.setProgressDirect(progress);
      debugLog(directionKey, "writeToDest", { progress, writeDurationMs: +(performance.now() - t0).toFixed(2) });
    }
  }

  wire(sides.a, sides.b, "aToB");
  wire(sides.b, sides.a, "bToA");

  return {
    setMode(directionKey, mode) {
      modes[directionKey] = mode;
    }
  };
}
