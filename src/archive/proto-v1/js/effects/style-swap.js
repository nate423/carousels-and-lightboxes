// Shared by every CSS-driven effect that generates its own stylesheet rules
// (css-effect.js, origin-effect.js, ios-scrubber-css-effect.js): all of them
// hand geometry to the scroll-timeline polyfill (Safari) through real
// stylesheet rules rather than inline styles, because the polyfill only
// discovers animation-name/-timeline/-range - and, for css-effect.js and
// origin-effect.js, the @keyframes themselves - by parsing a <style>
// element's contents, and only does that parsing once, at the moment the
// element is inserted into the DOM. A later `.textContent =` on an
// already-inserted element is just a text-node mutation inside it, which the
// polyfill never sees. So every flush swaps in a fresh <style> with its
// final text already set, rather than mutating the previous element's
// textContent in place.
export function replaceStyleEl(prevEl, cssText) {
  const nextEl = document.createElement("style");
  nextEl.textContent = cssText;
  document.head.appendChild(nextEl);
  if (prevEl) prevEl.remove();
  return nextEl;
}

// A generated stylesheet built from named rules and rebuilt wholesale on
// flush(), rather than mutated rule-by-rule: setting textContent is a full
// reparse/recalc of every rule in it, so callers batch all their set() calls
// for a pass (e.g. one per item in a setup()'s forEach) and flush() exactly
// once after - flushing per rule would reparse the whole, growing rule set on
// every one of n writes instead of once.
export class RuleSheet {
  #rules = new Map();
  #styleEl = null;

  set(name, cssText) {
    this.#rules.set(name, cssText);
  }

  flush() {
    this.#styleEl = replaceStyleEl(this.#styleEl, [...this.#rules.values()].join("\n"));
  }
}
