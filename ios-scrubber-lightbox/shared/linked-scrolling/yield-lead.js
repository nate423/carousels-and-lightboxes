// The last touch leads. While a carousel linked to this one is pressed, any
// motion of this one's own - momentum from a flick, a smooth scroll to a
// clicked thumbnail - stops where it is and stops counting as leading, so the
// carousel under the finger drives it from its first frame rather than the
// two writing each other until one comes to rest. Not if this carousel has a
// finger on it too: that finger came first, and the other carousel can't be
// dragged under it (lockPanning in carousel-engine.js).
//
// iOS runs momentum outside the page, and a scroll position written into it
// fights it rather than ending it, so the motion is stopped by making the
// scroller unscrollable by the user: overflow-x hidden, which a drive can
// still write and a scroll timeline still reads. It stays hidden until the
// other carousel is let go, so the browser has drawn at least one frame with
// it hidden. Whatever inline value was there before goes back - ramka's
// slides carry their overflow inline.
//
// It goes on not leading until the other carousel has finished moving
// (endFollowing in scroll-attribution.js), or straight away if it was let go
// without moving.
//
// A sideways wheel on the other carousel yields this one the same way, but a
// wheel has no release to hold the overflow until, and a wheel gesture picks
// the scroller it moves as it begins, before the page hears of it - so an
// overflow still hidden then leaves the next gesture on this carousel moving
// nothing. For a wheel the overflow comes back once a frame has been drawn
// with it hidden, which is all the browser needs to stop the motion. Leading
// stays with the other carousel until it comes to rest either way.
//
// A scroller whose overflow can't be touched while the other carousel is
// being panned (`stopsOnTouch: false`) only yields for a touch, and isn't
// stopped: on the ramka scrubber page, whose strip lies over ramka's slides,
// changing the slides' overflow at any point in a pan on the strip ends that
// pan. The drive writes into whatever is left of their motion instead, which
// iOS lets win within a frame or two.
//
// Returns the function the link calls with whether the other carousel is
// pressed, and on release whether it is moving, or `wheel` for a wheel;
// `onYield` runs once this carousel has stopped leading.
export function createYieldLead(el, { attribution, isPressed, onYield, stopsOnTouch = true }) {
  let overflowBefore = null;

  function restoreOverflow() {
    if (overflowBefore !== null) el.style.overflowX = overflowBefore;
    overflowBefore = null;
  }

  return function yieldLead(otherPressed, { otherMoving = false, wheel = false } = {}) {
    if (!otherPressed) {
      restoreOverflow();
      if (!otherMoving) attribution.endYield();
      return;
    }
    if (isPressed() || !attribution.isMovingItself()) return;
    if (!wheel && !stopsOnTouch) {
      attribution.yieldLead();
      onYield?.();
      return;
    }
    if (overflowBefore === null) overflowBefore = el.style.overflowX;
    el.style.overflowX = "hidden";
    attribution.yieldLead();
    onYield?.();
    // The first callback runs before the frame that draws it hidden, the
    // second after it.
    if (wheel) requestAnimationFrame(() => requestAnimationFrame(restoreOverflow));
  };
}
