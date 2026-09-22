// Native `scroll` can fire more than once per animation frame (trackpads in
// particular), and both `resize` and ResizeObserver behave the same way
// during a live window drag - fired on close to every frame, not just once
// it settles. effect.apply() reads item.offsetLeft/offsetWidth
// (getItemMetrics) and then writes styles at the end - fine within one call,
// but if a second event lands before the browser's next natural layout
// pass, its read runs right after the previous call's write, forcing a
// synchronous layout recalc instead of a cheap cached read. Collapsing
// same-frame events down to one rAF-scheduled call guarantees the read
// always happens after the browser's own layout pass.
export function rafThrottle(fn) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...args);
    });
  };
}
