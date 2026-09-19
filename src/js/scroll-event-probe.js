// Temporary diagnostic - flip PROBE_ENABLED off (or delete this file and its
// import in main.js) once the scroll/snap event behavior is settled.
//
// Exists because the interesting questions here are all device-dependent and
// the device that matters least resembles a desktop dev console: iOS. What
// fires, in what order, and how early differs between iOS 18 (no 'scrollend'
// at all, but 'scrollsnapchange' since Safari 18.2) and iOS 26+ (everything),
// and between a flick, a slow drag and a programmatic scroll. Rather than
// guess, load the page on the device and watch this panel.
//
// Observed in Chrome 152 on desktop, for reference:
//   - 'scrollsnapchanging' fires EARLY - at the start of a scroll operation,
//     carrying the target it predicts the scroll will land on. On a ~1s
//     smooth scroll it arrived a full second before the scroll got there.
//     It is a prediction, not a "currently moving" signal, which is why
//     ios-scrubber-effect.js doesn't use it to collapse.
//   - 'scrollsnapchange' fires exactly when the operation completes, just
//     before 'scrollend', carrying the target actually landed on.
//   - 'scrollend' carries no target (it's a plain Event, not a SnapEvent).
//   - Neither end-of-operation event fires at all for some synthetic/
//     automated wheel input, where only 'scrollsnapchanging' showed up.
const PROBE_ENABLED = true;

const TAIL_LENGTH = 8;

const FEATURES = [
  ["scrollend", () => "onscrollend" in window],
  ["scrollsnapchange", () => "onscrollsnapchange" in window],
  ["scrollsnapchanging", () => "onscrollsnapchanging" in window],
  ["scroll-state()", () => CSS.supports("container-type", "scroll-state")]
];

export function attachScrollEventProbe(wrapper, label) {
  if (!PROBE_ENABLED) return;

  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:8px;bottom:8px;z-index:100;width:240px;padding:8px 10px;" +
    "background:var(--bg-offset-2);border:1px solid var(--bg-offset-10);border-radius:8px;" +
    "font:10px/1.5 monospace;color:var(--bg-offset-60);pointer-events:none";

  const support = FEATURES.map(([name, test]) => `${test() ? "✓" : "✗"} ${name}`).join("<br>");
  const tail = document.createElement("div");
  tail.style.cssText = "margin-top:6px;border-top:1px solid var(--bg-offset-10);padding-top:6px;min-height:80px";
  panel.innerHTML = `<b>${label}</b><br>${support}`;
  panel.appendChild(tail);
  document.body.appendChild(panel);

  // Indexed off the element scroll-snap-align actually sits on - the
  // .carousel-item-snap-fix wrapper - since that's what a SnapEvent reports.
  const snapTargets = [...wrapper.querySelectorAll(".carousel-item-snap-fix")];
  const lines = [];
  let previousAt = null;

  function record(type, target) {
    const now = performance.now();
    const since = previousAt === null ? 0 : Math.round(now - previousAt);
    previousAt = now;
    const index = target ? snapTargets.indexOf(target) : null;
    lines.unshift(`${String(since).padStart(4)}ms ${type}${index === null ? "" : " #" + index}`);
    lines.length = Math.min(lines.length, TAIL_LENGTH);
    tail.textContent = "";
    tail.append(...lines.map((line) => Object.assign(document.createElement("div"), { textContent: line })));
  }

  ["scrollsnapchanging", "scrollsnapchange", "scrollend"].forEach((type) => {
    if (!(`on${type}` in window)) return;
    wrapper.addEventListener(type, (event) => record(type, event.snapTargetInline));
  });
}
