// scroll-snap-type: mandatory (every carousel-engine wrapper has it) tries to
// correct exactly what a direct write looks like to it: a scroll position
// that isn't part of an active native gesture. Suspending it for the
// duration of a drive keeps the browser's own resnap from fighting a direct
// write (setProgressDirect in carousel-engine.js), and keeps it from moving
// the items out from under a carousel following on its leader's timeline,
// whose scroll position sits wherever the drive last left it (see
// timeline-follow.js).
//
// Nothing hands it back on a timer. A drive can pause as long as the finger
// behind it does - held still mid-drag, the leader emits no scroll events
// at all - and snap returning in that pause resnaps the follower to the
// nearest item, only for the next movement to write it back between two,
// over and over. It comes back when the drive is actually over: when the
// leader reports its gesture has ended (endFollowing in carousel-engine.js),
// by which point the follower sits exactly on the item the leader came to
// rest on, and the instant real input reclaims this carousel (see
// scroll-attribution.js's onSelfReclaim), while the scroll position is still
// exactly on the anchor the last write put it on. Either way re-enabling it
// corrects nothing.
//
// Both functions only write the style when it would actually change - a
// style write followed by a geometry read (offsetLeft/offsetWidth, in
// setProgressDirect right after) on the same element forces a synchronous
// layout recalculation, and re-writing an unchanged value still re-arms it.
export function createSnapSuspension(wrapper) {
  function suspend() {
    if (wrapper.style.scrollSnapType !== "none") {
      wrapper.style.scrollSnapType = "none";
    }
  }

  function restore() {
    if (wrapper.style.scrollSnapType !== "") {
      wrapper.style.scrollSnapType = "";
    }
  }

  return { suspend, restore };
}
