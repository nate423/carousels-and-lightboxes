// Off by default - flip CONSOLE_ENABLED on to bring the panel back.
//
// An on-screen console for debugging on devices where a real one isn't
// practical, which in this project means iOS. Shows a live tail and copies the
// whole buffer on demand.
//
// Kept rather than deleted because it attaches from outside: it reads the two
// carousels through their public surface and touches nothing they do, so
// switching it off costs nothing and switching it back on needs no rebuilding.
//
// Everything it samples is a cheap read - scrollLeft and inline style strings,
// never offsetLeft/offsetWidth - because it runs on every scroll frame and a
// forced layout here would add exactly the kind of jank it exists to measure.
import { onScrollEnd } from "../shared/engine/scroll-end.js";

// Bumped by hand whenever the scrubber's motion changes, so a capture taken on
// a phone says which build produced it - otherwise a stale page and a fixed one
// are indistinguishable from the log alone.
const LOG_VERSION = 6;

const CONSOLE_ENABLED = false;
const BUFFER_LIMIT = 900;
const TAIL_LINES = 7;

function createPanel(title, { top = false } = {}) {
  const lines = [];

  const panel = document.createElement("div");
  panel.style.cssText =
    `position:fixed;left:0;right:0;${top ? "top" : "bottom"}:0;z-index:2147483647;padding:6px 8px;` +
    "background:var(--bg-offset-2);border-top:1px solid var(--bg-offset-10);" +
    "font:10px/1.45 ui-monospace,monospace;color:var(--bg-offset-60)";

  const bar = document.createElement("div");
  bar.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:4px";
  const label = document.createElement("b");
  label.textContent = `${title} · v${LOG_VERSION}`;
  label.style.cssText = "flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
  bar.append(label);

  const status = document.createElement("span");
  const button = (text, onClick) => {
    const el = document.createElement("button");
    el.textContent = text;
    el.style.cssText =
      "font:inherit;padding:4px 10px;border-radius:6px;border:1px solid var(--bg-offset-10);" +
      "background:var(--color-background);color:inherit;-webkit-appearance:none";
    el.addEventListener("click", onClick);
    return el;
  };

  const tail = document.createElement("pre");
  tail.style.cssText = "margin:0;overflow-x:auto;white-space:pre;min-height:88px";

  function render() {
    tail.textContent = lines.slice(-TAIL_LINES).join("\n");
  }

  function allText() {
    return [
      `# ${title} - log v${LOG_VERSION}`,
      `# ${navigator.userAgent}`,
      `# native scroll-driven animations: ${!!window.__supportsScrollDrivenAnimations}`,
      ...lines
    ].join("\n");
  }

  // Always present, hidden until needed: a phone loading this page over the
  // LAN by IP is not a secure context, so navigator.clipboard is unavailable
  // and execCommand is all there is. When even that is refused, showing the
  // text in a selected textarea lets the usual long-press -> Copy work, which
  // is the one route that cannot be blocked.
  const manual = document.createElement("textarea");
  manual.readOnly = true;
  manual.style.cssText =
    "display:none;width:100%;height:120px;margin-top:4px;font:inherit;" +
    "background:var(--color-background);color:inherit;border:1px solid var(--bg-offset-10)";

  function copyAll() {
    const text = allText();
    manual.value = text;
    manual.style.display = "block";
    manual.focus();
    manual.setSelectionRange(0, text.length);

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }
    if (copied) {
      manual.style.display = "none";
      status.textContent = `copied ${lines.length}`;
      return;
    }

    navigator.clipboard?.writeText(text).then(
      () => {
        manual.style.display = "none";
        status.textContent = `copied ${lines.length}`;
      },
      () => (status.textContent = "select above, then Copy")
    );
    if (!navigator.clipboard) status.textContent = "select above, then Copy";
  }

  bar.append(status, button("Copy", copyAll), button("Clear", () => {
    lines.length = 0;
    status.textContent = "";
    manual.style.display = "none";
    render();
  }));
  panel.append(bar, tail, manual);
  document.body.appendChild(panel);
  render();

  return {
    log(line) {
      lines.push(line);
      if (lines.length > BUFFER_LIMIT) lines.shift();
      render();
    }
  };
}

const pad = (value, width) => String(value).padStart(width);
const fixed = (value, width) => pad(value.toFixed(1), width);
const signed = (value) => (value >= 0 ? "+" : "") + value.toFixed(1);

// KNOWN STALE: both readers below sample inline styles, which only the
// hand-computed iOS look ever wrote. That look is archived, and the native
// one paints from generated stylesheet rules instead, so both now read 0.
// Re-pointing them at the resolved --item-shift and thumb width means
// getComputedStyle, which this panel has so far refused on purpose (see the
// header: it runs every scroll frame, and a forced recalc here is the very
// jank it measures). Left broken rather than quietly changed, since the
// panel is off by default and the tradeoff deserves a measurement first.
function translateOf(item) {
  return parseFloat(item.style.transform.replace("translate3d(", "")) || 0;
}

function thumbWidthOf(item) {
  return parseFloat(item.firstElementChild.style.width) || 0;
}

// Samples a line per scroll frame from BOTH carousels, following the chain the
// position travels along: the main carousel's own scroll, the scroll position
// relayed onto the strip, and the transforms the strip's effect paints from it.
// Whichever of those stops moving smoothly is where the jitter is introduced.
//
// Sampling the strip too, not just the carousel driving it, is what catches the
// strip moving when nothing is driving it - a snap correction after the gesture
// ends, say, which produces no main scroll event at all and so leaves no trace
// in a log keyed only to the driver.
//
// Each line is tagged with what triggered it and how the strip's scroll is
// attributed at that moment:
//   M     - the main carousel scrolled
//   S/own - the strip scrolled for its own reasons
//   S/drv - the strip scrolled as an echo of a relayed write
// followed by the strip's scroll-snap state, since snap being handed back is
// itself able to move the strip.
export function watchScrubberJitter(mainCarousel, scrubber, title = "main scroll -> strip render") {
  if (!CONSOLE_ENABLED) return;

  const panel = createPanel(title);
  const items = [...scrubber.getItems()];
  // One layout read, at setup, so the per-frame path needs none.
  const pitch = items.length > 1 ? items[1].offsetLeft - items[0].offsetLeft : 1;
  let previous = null;

  function sample(tag) {
    const now = performance.now();
    const mainScroll = mainCarousel.wrapper.scrollLeft;
    const stripScroll = scrubber.wrapper.scrollLeft;
    const snap = scrubber.wrapper.style.scrollSnapType === "none" ? "snap-off" : "snap-on ";
    const index = Math.max(0, Math.min(items.length - 2, Math.round(stripScroll / pitch)));
    const near = translateOf(items[index]);

    const deltas = previous
      ? ` | d main ${signed(mainScroll - previous.mainScroll)} strip ${signed(stripScroll - previous.stripScroll)}` +
        (index === previous.index ? ` t ${signed(near - previous.near)}` : " (item changed)")
      : "";

    panel.log(
      `${pad(Math.round(now - (previous ? previous.now : now)), 4)}ms ${tag} ` +
        `main ${fixed(mainScroll, 8)} strip ${fixed(stripScroll, 7)} ${snap} ` +
        `i${pad(index, 2)} t ${fixed(near, 7)} w ${fixed(thumbWidthOf(items[index]), 5)}` +
        deltas
    );

    previous = { now, mainScroll, stripScroll, index, near };
  }

  mainCarousel.onScroll(() => sample("M    "));
  scrubber.onScroll(({ source }) => sample(source === "driven" ? "S/drv" : "S/own"));
  scrubber.wrapper.addEventListener("scrollend", () => sample("S/end"));
}

// On with ?log. Logs a handover between two linked carousels as it happens on
// a phone: every touch starting and ending with the number of fingers down,
// the first move of each touch and whether anything cancelled it (and at
// which stage - before the page's own listeners run, or after), pointer
// cancels, and every scroll of either carousel with its motion state and
// the inline styles the link sets on it. Sits at the top of the screen, clear
// of a strip along the bottom.
export function watchHandover(a, b, title = "handover") {
  if (!new URLSearchParams(location.search).has("log")) return;

  const panel = createPanel(title, { top: true });
  const start = performance.now();
  const t = () => pad(Math.round(performance.now() - start), 6);
  const named = [
    [a.wrapper, "A"],
    [b.wrapper, "B"]
  ];
  const nameOf = (target) => named.find(([el]) => el.contains(target))?.[1] ?? "-";
  const state = (c) =>
    `${c.getMotionState?.() ?? (c.isMovingItself() ? "leading" : "idle")}/${c.getScrollSource?.() ?? "?"}` +
    ` ox:${c.wrapper.style.overflowX || "css"} ta:${c.wrapper.style.touchAction || "css"}`;
  const both = () => `A ${state(a)} | B ${state(b)}`;

  let moved = false;
  let wasPrevented = null;

  document.addEventListener(
    "touchstart",
    (e) => {
      moved = false;
      wasPrevented = null;
      panel.log(`${t()} touchstart on ${nameOf(e.target)} fingers ${e.touches.length} | ${both()}`);
    },
    { capture: true, passive: true }
  );
  document.addEventListener(
    "touchmove",
    (e) => {
      if (!moved) {
        moved = true;
        panel.log(`${t()} touchmove on ${nameOf(e.target)} fingers ${e.touches.length} cancelled-before:${e.defaultPrevented}`);
      }
    },
    { capture: true, passive: true }
  );
  window.addEventListener(
    "touchmove",
    (e) => {
      if (e.defaultPrevented !== wasPrevented) {
        wasPrevented = e.defaultPrevented;
        panel.log(`${t()} touchmove cancelled-after:${e.defaultPrevented} cancelable:${e.cancelable}`);
      }
    },
    { passive: true }
  );
  ["touchend", "touchcancel"].forEach((type) =>
    window.addEventListener(
      type,
      (e) => panel.log(`${t()} ${type} fingers left ${e.touches.length}`),
      { passive: true }
    )
  );
  window.addEventListener(
    "pointercancel",
    (e) => panel.log(`${t()} pointercancel on ${nameOf(e.target)}`),
    { capture: true, passive: true }
  );

  window.addEventListener("scroll", () => panel.log(`${t()} page scroll ${Math.round(scrollY)}`), { passive: true });
  const snapOf = (c) => (c.wrapper.style.scrollSnapType === "none" ? " snap-off" : "");

  for (const [carousel, name] of [
    [a, "A"],
    [b, "B"]
  ]) {
    carousel.wrapper.addEventListener(
      "scroll",
      (e) => e.isTrusted && panel.log(`${t()} ${name} scroll ${fixed(carousel.wrapper.scrollLeft, 7)}${snapOf(carousel)} | ${both()}`),
      { passive: true }
    );
    // Inferred where the browser has no 'scrollend' (see scroll-end.js), so
    // an end that doesn't reach the link as "gesture over" shows too.
    onScrollEnd(carousel.wrapper, () => panel.log(`${t()} ${name} scrollend | ${both()}`));
    carousel.onScrollEnd(() => panel.log(`${t()} ${name} gesture over`));
  }
}
