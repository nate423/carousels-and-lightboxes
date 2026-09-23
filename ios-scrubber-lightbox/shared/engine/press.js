// Whether a pointer or finger is down on `el` right now. Calls `onRelease`
// once the last one lifts.
//
// Touches are counted separately from pointers because the browser sends
// 'pointercancel' the moment it takes over a touch for native panning, while
// the finger is still down; touch events keep reporting it until it lifts.
// Releases are watched on window: a drag can end with the pointer or finger
// well outside `el`.
export function trackPress(el, { onRelease } = {}) {
  const pointersDown = new Set();
  let touchesDown = 0;

  const isPressed = () => pointersDown.size > 0 || touchesDown > 0;

  function release() {
    if (!isPressed()) onRelease?.();
  }

  el.addEventListener("pointerdown", (e) => pointersDown.add(e.pointerId), { passive: true });
  el.addEventListener("touchstart", (e) => (touchesDown = e.touches.length), { passive: true });

  ["pointerup", "pointercancel"].forEach((type) =>
    window.addEventListener(
      type,
      (e) => {
        if (pointersDown.delete(e.pointerId)) release();
      },
      { passive: true }
    )
  );
  ["touchend", "touchcancel"].forEach((type) =>
    window.addEventListener(
      type,
      (e) => {
        if (touchesDown === 0) return;
        touchesDown = e.touches.length;
        release();
      },
      { passive: true }
    )
  );

  return { isPressed };
}
