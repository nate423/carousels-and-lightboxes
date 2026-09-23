// Whether a pointer or finger is down on `el` right now. Calls `onChange`
// with the new state whenever that changes, and `onRelease` once the last
// one lifts.
//
// Touches are counted separately from pointers because the browser sends
// 'pointercancel' the moment it takes over a touch for native panning, while
// the finger is still down; touch events keep reporting it until it lifts.
// They are counted by identifier, only those that began on `el`, since a
// touch event's own lists cover every finger on the screen - a finger on
// another carousel would otherwise hold this one pressed too. Releases are
// watched on window: a drag can end with the pointer or finger well outside
// `el`.
export function trackPress(el, { onRelease, onChange } = {}) {
  const pointersDown = new Set();
  const touchesDown = new Set();
  let pressed = false;

  const isPressed = () => pointersDown.size > 0 || touchesDown.size > 0;

  function update() {
    const now = isPressed();
    if (now === pressed) return;
    pressed = now;
    onChange?.(now);
    if (!now) onRelease?.();
  }

  el.addEventListener(
    "pointerdown",
    (e) => {
      pointersDown.add(e.pointerId);
      update();
    },
    { passive: true }
  );
  el.addEventListener(
    "touchstart",
    (e) => {
      for (const touch of e.changedTouches) touchesDown.add(touch.identifier);
      update();
    },
    { passive: true }
  );

  ["pointerup", "pointercancel"].forEach((type) =>
    window.addEventListener(
      type,
      (e) => {
        // A touch's pointer is cancelled while its finger is still down (see
        // above); the touch itself still holds the press until it lifts.
        if (pointersDown.delete(e.pointerId)) update();
      },
      { passive: true }
    )
  );
  ["touchend", "touchcancel"].forEach((type) =>
    window.addEventListener(
      type,
      (e) => {
        let changed = false;
        for (const touch of e.changedTouches) changed = touchesDown.delete(touch.identifier) || changed;
        if (changed) update();
      },
      { passive: true }
    )
  );

  return { isPressed };
}
