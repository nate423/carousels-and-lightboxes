// Calls `listener` once a scroll operation on `el` is over - the same moment
// native 'scrollend' marks: gesture, momentum and any snap correction all
// finished. Where the browser has 'scrollend' this is just that event.
//
// Where it doesn't (Safari before 26), the end is inferred from 'scroll'
// events instead. Every scroll re-arms a short timer. When the timer fires,
// the operation still counts as ongoing while a pointer or finger is down,
// because a drag held still emits no scroll events but hasn't ended. It also
// counts as ongoing if the scroll position moved since the last scroll
// event, because a scroll can move without a scroll event having reached
// this listener yet. Releasing the last pointer re-arms the timer, so a drag
// that stops and lifts with no momentum still ends. Only a scroll ever arms
// the timer, so a tap or click with no movement behind it fires nothing,
// just as native 'scrollend' wouldn't.
import { trackPress } from "./press.js";

const SETTLE_DELAY = 120;

export function onScrollEnd(el, listener) {
  if ("onscrollend" in window) {
    el.addEventListener("scrollend", listener);
    return;
  }

  let timer = null;
  let pending = false;
  let lastLeft = el.scrollLeft;
  let lastTop = el.scrollTop;
  const press = trackPress(el, { onRelease: () => pending && arm() });

  function arm() {
    clearTimeout(timer);
    timer = setTimeout(settle, SETTLE_DELAY);
  }

  function settle() {
    timer = null;
    if (!pending || press.isPressed()) return;
    if (el.scrollLeft !== lastLeft || el.scrollTop !== lastTop) {
      lastLeft = el.scrollLeft;
      lastTop = el.scrollTop;
      arm();
      return;
    }
    pending = false;
    listener();
  }

  el.addEventListener(
    "scroll",
    (event) => {
      // An untrusted scroll is carousel-engine.js's nudge to the
      // scroll-timeline polyfill, not a scroll.
      if (!event.isTrusted) return;
      pending = true;
      lastLeft = el.scrollLeft;
      lastTop = el.scrollTop;
      arm();
    },
    { passive: true }
  );
}
