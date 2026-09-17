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
import { computeCurrentIndex } from "./carousel-math.js";
import { rafThrottle } from "./carousel-engine.js";

const SNAP_RESTORE_DELAY = 150; // ms of no further programmatic writes before scroll-snap is handed back
const LIVENESS_MS = 50; // ~3 dropped frames at 60fps - how stale the other wrapper's last accepted scroll can be and still count as "still actively moving" (see the interrupt check below)
const MIN_STEAL_DELTA = 15; // wheel delta magnitude required to interrupt a wrapper that's still live - see the interrupt check below

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

export function linkCarousels(a, b, { aToB = "continuous", bToA = "instant" } = {}) {
  // Mutable, not captured per-wire - setMode() (see the returned controller)
  // can flip either direction's mode live, e.g. from a debug control, without
  // tearing down and re-registering the scroll listeners below.
  const modes = { aToB, bToA };

  // Whether each wrapper currently has a pending programmatic drive on it
  // that hasn't yet been "claimed back" by a real gesture. Set whenever we
  // write to a wrapper as a dest; cleared the moment that same wrapper gets
  // real wheel/touch input of its own.
  //
  // This is a hard, unconditional gate, not a timing window: a carousel
  // driven by setProgressDirect still fires its own native 'scroll' event
  // (the echo), and so does the browser's own scroll-snap "resnap"
  // correction, which runs *asynchronously* after handing scroll-snap-type
  // back and can itself animate for an unpredictable stretch (observed up to
  // ~1.8s) if our computed anchor isn't pixel-identical to the browser's own
  // snap-point geometry. Neither can happen without us having written to
  // that wrapper first, so "has this wrapper had a real gesture since the
  // last time we drove it" is a complete, exact answer - no elapsed-time
  // guess needed, and so no window to accidentally cut off a legitimate but
  // slow-to-arrive correction (a real native ease-to-rest, which fires
  // 'scroll' every frame with no further wheel/touchmove at all, can take a
  // real and sometimes surprisingly long moment to even start - a wrapper we
  // never drove doesn't have this problem, since every one of its events is
  // provably the user's own doing). Event ordering makes this safe even when
  // real input lands in the same batched frame as a pending echo: the
  // wheel/touchmove handler fires synchronously as part of input dispatch,
  // before the 'scroll' it causes is ever queued, so the flag is already
  // cleared by the time that scroll event's handler runs.
  const writtenByUs = { a: false, b: false };

  // Last time a scroll event on each wrapper was accepted as genuine (i.e.
  // passed the writtenByUs gate above). Used only to decide whether a
  // wrapper that just started moving should be allowed to interrupt the
  // *other* one - unlike the echo/drift problem above, "is the other side
  // still actively moving right now" is inherently about current, live
  // state, not a fact that can be captured with a boolean.
  const lastAcceptedScrollAt = { a: null, b: null };

  // Magnitude of the most recent wheel tick landing on each wrapper - see the
  // interrupt check below.
  const lastWheelDelta = { a: 0, b: 0 };

  function wire(source, dest, sourceKey, destKey, directionKey) {
    let snapRestoreTimer = null;
    // Baselined to the source's real position at link time (not null) so the
    // very first scroll event on it only writes to dest if the item it's
    // "current" on has actually changed since then - not on every event.
    let lastSourceIndex = computeCurrentIndex(source.getCurrentProgress(), source.getItems().length);

    const markGesture = (e) => {
      writtenByUs[sourceKey] = false;
      if (e.type === "wheel") {
        lastWheelDelta[sourceKey] = Math.abs(e.deltaX) + Math.abs(e.deltaY);
      }
      debugLog(directionKey, `${e.type} on source`, { sourceKey, wheelDelta: lastWheelDelta[sourceKey] });
    };
    source.wrapper.addEventListener("wheel", markGesture, { passive: true });
    source.wrapper.addEventListener("touchmove", markGesture, { passive: true });

    // scroll-snap-type: mandatory (every carousel-engine wrapper has it)
    // tries to correct exactly what a programmatic write looks like to it: a
    // scroll position that isn't part of an active native gesture. Suspending
    // it for the duration of a drive (and handing it back once writes stop)
    // keeps the browser's own resnap from fighting these writes.
    //
    // Only actually writes the style when it's not already "none" - a style
    // write followed by a geometry read (offsetLeft/offsetWidth, inside
    // setProgressDirect right below) on the same element forces a synchronous
    // layout recalculation. Re-writing "none" to "none" every single frame of
    // a live "continuous" drag was exactly that: a no-op value change that
    // still re-armed the forced reflow on every frame - the likely source of
    // the reported jank.
    function writeToDest(progress) {
      if (dest.wrapper.style.scrollSnapType !== "none") {
        dest.wrapper.style.scrollSnapType = "none";
      }
      clearTimeout(snapRestoreTimer);
      snapRestoreTimer = setTimeout(() => {
        dest.wrapper.style.scrollSnapType = "";
      }, SNAP_RESTORE_DELAY);

      writtenByUs[destKey] = true;
      const t0 = performance.now();
      dest.setProgressDirect(progress);
      debugLog(directionKey, "writeToDest", { progress, writeDurationMs: +(performance.now() - t0).toFixed(2) });
    }

    source.wrapper.addEventListener(
      "scroll",
      rafThrottle(() => {
        const handlerStart = performance.now();

        if (writtenByUs[sourceKey]) {
          // Nothing has touched this wrapper for real since we last drove it
          // - definitionally not user input, no matter how long it's been.
          debugLog(directionKey, "ignored (written by us, not yet reclaimed)");
          return;
        }
        lastAcceptedScrollAt[sourceKey] = handlerStart;

        // `dest` is the only other wrapper in this link. If it's currently
        // moving under its own steam (not because we're driving it - exclude
        // that with !writtenByUs, or our own echo chain into it would look
        // "alive" here too), don't let a weak tick fight it - this is the one
        // place a moving-target decision can't be reduced to a boolean, since
        // it's genuinely asking "is the other side still live right now."
        //
        // Liveness alone isn't enough, though: during a hard flick's momentum
        // tail, dest keeps refreshing lastAcceptedScrollAt every ~8-16ms for
        // as long as it coasts, so a pure liveness check would suppress a
        // genuinely deliberate quick-flick-to-take-over for that whole
        // stretch - directly against wanting whichever side you actually
        // touch most recently to win immediately. A strong tick (a real flick
        // or drag's opening delta, much bigger than the late, decaying
        // residue of someone else's tail) bypasses the liveness check
        // entirely and takes over right away; only a weak one - e.g. momentum
        // wheel events macOS/Chrome dispatch to wherever the cursor currently
        // sits, not where the original gesture started, so hovering the
        // other carousel mid-coast can land real but tiny ticks on it - gets
        // held back while dest is still genuinely moving.
        const destStillLive =
          !writtenByUs[destKey] &&
          lastAcceptedScrollAt[destKey] !== null &&
          handlerStart - lastAcceptedScrollAt[destKey] < LIVENESS_MS;
        if (destStillLive && lastWheelDelta[sourceKey] < MIN_STEAL_DELTA) {
          debugLog(directionKey, "suppressed (dest still live, weak input)", {
            wheelDelta: lastWheelDelta[sourceKey]
          });
          return;
        }

        const progress = source.getCurrentProgress();

        if (modes[directionKey] === "continuous") {
          writeToDest(progress);
          debugLog(directionKey, "continuous frame", {
            progress,
            handlerDurationMs: +(performance.now() - handlerStart).toFixed(2)
          });
          return;
        }

        // "instant": only react once the source's discrete current item
        // changes - an integer progress value lands dest exactly on that
        // item's own anchor, same as any other item position.
        const index = computeCurrentIndex(progress, source.getItems().length);
        if (index === lastSourceIndex) return;
        lastSourceIndex = index;
        writeToDest(index);
      })
    );
  }

  wire(a, b, "a", "b", "aToB");
  wire(b, a, "b", "a", "bToA");

  return {
    setMode(directionKey, mode) {
      modes[directionKey] = mode;
    }
  };
}
