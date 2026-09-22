// Temporary diagnostic - flip PROBE_ENABLED off (or delete this file and its
// import from a page's entry script) once the scroll/snap event behavior is
// settled.
//
// Exists because the interesting questions here are all device-dependent and
// the device that matters least resembles a desktop dev console: iOS. What
// fires, in what order, and how early differs between iOS 18 (no 'scrollend'
// at all, but 'scrollsnapchange' since Safari 18.2) and iOS 26+ (everything),
// and between a flick, a slow drag and a programmatic scroll. Rather than
// guess, load the page on the device and watch this panel.
//
// Watches ONE scroller - whichever carousel it was attached to - and labels
// every line with that carousel's own scroll attribution, because the most
// confusing thing this panel shows is events on the strip that were caused
// by scrolling the *main* carousel. See below for why there are so many.
//
// Observed in Chrome 152 on desktop:
//   - 'scrollsnapchanging' fires EARLY - at the start of a scroll operation,
//     carrying the target it predicts the scroll will land on. On a ~1s
//     smooth scroll it arrived a full second before the scroll got there.
//     It is a prediction, not a "currently moving" signal.
//   - 'scrollsnapchange' fires when an operation completes, just before
//     'scrollend', carrying the target actually landed on. It fires only if
//     that target differs from the one the operation started on.
//   - 'scrollend' carries no target (it's a plain Event, not a SnapEvent).
//   - A programmatic scroll position write is its own complete scroll
//     operation: it starts and finishes in the same frame and fires its own
//     'scrollend'. So while linked-scrolling/link.js relays a gesture frame by
//     frame, the driven side emits one 'scrollend' per relayed write -
//     measured at 17 scroll / 17 scrollend on the strip for a single flick
//     of the main carousel, against 1 scrollend on the main carousel
//     itself. 'scrollend' is therefore NOT a "the user finished" signal on
//     a scroller something else is driving, which is exactly why the engine
//     ends a driven carousel's motion from the driver's scrollend instead
//     (see endFollowing in carousel-engine.js).
const PROBE_ENABLED = false;

const TAIL_LENGTH = 8;

const FEATURES = [
  ["scrollend", () => "onscrollend" in window],
  ["scrollsnapchange", () => "onscrollsnapchange" in window],
  ["scrollsnapchanging", () => "onscrollsnapchanging" in window],
  ["scroll-state()", () => CSS.supports("container-type", "scroll-state")]
];

// `carousel` is a createCarousel controller, not a bare element - the panel
// needs its getScrollSource() as much as its wrapper.
export function attachScrollEventProbe(carousel, label) {
  if (!PROBE_ENABLED) return;

  const { wrapper } = carousel;
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;right:8px;bottom:8px;z-index:100;width:260px;padding:8px 10px;" +
    "background:var(--bg-offset-2);border:1px solid var(--bg-offset-10);border-radius:8px;" +
    "font:10px/1.5 monospace;color:var(--bg-offset-60);pointer-events:none";

  const support = FEATURES.map(([name, test]) => `${test() ? "✓" : "✗"} ${name}`).join("<br>");
  const tail = document.createElement("div");
  tail.style.cssText = "margin-top:6px;border-top:1px solid var(--bg-offset-10);padding-top:6px;min-height:80px";
  panel.innerHTML = `<b>watching: ${label}</b><br>${support}`;
  panel.appendChild(tail);
  document.body.appendChild(panel);

  // Indexed off the element scroll-snap-align actually sits on - the
  // .carousel-item-snap-fix wrapper - since that's what a SnapEvent reports.
  const snapTargets = [...wrapper.querySelectorAll(".carousel-item-snap-fix")];
  const lines = [];
  let previousAt = null;

  function repaint() {
    tail.textContent = "";
    tail.append(
      ...lines.map((line) =>
        Object.assign(document.createElement("div"), {
          textContent: `${String(line.since).padStart(4)}ms ${line.text}${line.count > 1 ? ` ×${line.count}` : ""}`
        })
      )
    );
  }

  function record(type, target) {
    const now = performance.now();
    const index = target ? snapTargets.indexOf(target) : null;
    const text = `${type}${index === null ? "" : " #" + index} (${carousel.getScrollSource()})`;

    // Collapse consecutive identical events into a count. Without this a
    // single flick of the main carousel buries everything else under a
    // screen of identical driven 'scrollend' lines.
    if (lines[0] && lines[0].text === text) {
      lines[0].count++;
    } else {
      lines.unshift({ text, count: 1, since: previousAt === null ? 0 : Math.round(now - previousAt) });
      lines.length = Math.min(lines.length, TAIL_LENGTH);
    }
    previousAt = now;
    repaint();
  }

  ["scrollsnapchanging", "scrollsnapchange", "scrollend"].forEach((type) => {
    if (!(`on${type}` in window)) return;
    wrapper.addEventListener(type, (event) => record(type, event.snapTargetInline));
  });
}
