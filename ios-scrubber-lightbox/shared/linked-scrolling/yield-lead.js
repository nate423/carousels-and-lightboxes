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
// Returns the function the link calls with whether the other carousel is
// pressed, and on release whether it is moving; `onYield` runs once this
// carousel has stopped leading.
export function createYieldLead(el, { attribution, isPressed, onYield }) {
  let overflowBefore = null;

  return function yieldLead(otherPressed, { otherMoving = false } = {}) {
    if (!otherPressed) {
      if (overflowBefore !== null) el.style.overflowX = overflowBefore;
      overflowBefore = null;
      if (!otherMoving) attribution.endYield();
      return;
    }
    if (isPressed() || !attribution.isMovingItself()) return;
    if (overflowBefore === null) overflowBefore = el.style.overflowX;
    el.style.overflowX = "hidden";
    attribution.yieldLead();
    onYield?.();
  };
}
