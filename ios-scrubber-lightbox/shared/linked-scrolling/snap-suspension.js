// scroll-snap-type: mandatory (every carousel-engine wrapper has it) tries to
// correct exactly what a direct write looks like to it: a scroll position
// that isn't part of an active native gesture. Suspending it for the
// duration of a drive keeps the browser's own resnap from fighting a direct
// write (setProgressDirect in carousel-engine.js).
//
// Handing it back is timer-based only because a drive has no natural end
// event - but the timer must never be what hands it back mid-gesture. Snap
// returning while the browser still has the driven position latched makes it
// resnap to that position rather than to wherever the gesture has since got
// to, which reads as the carousel scrolling normally and then, up to a
// second later, jumping back to where it started. restore() is therefore
// also called the instant real input reclaims this carousel (see
// scroll-attribution.js's onSelfReclaim), while the scroll position is still
// exactly on the anchor the last write put it on, so re-enabling snap there
// corrects nothing.
//
// Both functions only write the style when it would actually change - a
// style write followed by a geometry read (offsetLeft/offsetWidth, in
// setProgressDirect right after) on the same element forces a synchronous
// layout recalculation, and re-writing an unchanged value still re-arms it.
const SNAP_RESTORE_DELAY = 150;

export function createSnapSuspension(wrapper) {
  let snapRestoreTimer = null;

  function suspend() {
    if (wrapper.style.scrollSnapType !== "none") {
      wrapper.style.scrollSnapType = "none";
    }
    clearTimeout(snapRestoreTimer);
    snapRestoreTimer = setTimeout(restore, SNAP_RESTORE_DELAY);
  }

  // Suspends snap with no timer to hand it back. For as long as a carousel is
  // following on its leader's timeline (see timeline-follow.js), its real
  // scroll position sits wherever the drive last left it, usually between
  // two snap points, and a resnap there would move the items out from under
  // the translate that is standing in for their scroll. Held until the
  // next suspend() or restore().
  function hold() {
    if (wrapper.style.scrollSnapType !== "none") {
      wrapper.style.scrollSnapType = "none";
    }
    clearTimeout(snapRestoreTimer);
  }

  function restore() {
    clearTimeout(snapRestoreTimer);
    if (wrapper.style.scrollSnapType !== "") {
      wrapper.style.scrollSnapType = "";
    }
  }

  return { suspend, hold, restore };
}
