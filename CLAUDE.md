# Carousels and Lightboxes

Conventions for working in this repo. General working preferences are in the user-level `~/.claude/CLAUDE.md`.

## Git

- **Commit only after a device test.** Serve a fix uncommitted (the version badge then shows "+changes"), hand over the test, and commit once I confirm on the device it's for. Put my result in the commit's "Verified" line. Passing headless checks isn't enough to commit.
- **No pull requests.** Once a fix is committed, fast-forward `main` to the work branch and push `main`.
- Work branches live in their own worktree next to the main checkout. Ask before removing one.

## Issues

Tracked in GitHub Issues (`nate423/carousels-and-lightboxes`); `ISSUES.md` only points there. Use `gh issue` and the bug template in `.github/ISSUE_TEMPLATE/bug.md`. Labels include `fix attempted`, `parked`, `regression`, `needs info`, `ios-27` and `polyfill`. A fix stays open with `fix attempted` until I confirm it on the device it was reported on.

## Dev servers and test versions

- **Fixed ports:** 56576 is always `main`, run from the main checkout. Never switch branches under it or stop it, even during cleanup. 57000 is the current work branch, run from its worktree. 57008 is for whatever reference version the current work compares against. Experiments get throwaway ports from 57010.
- **Version badge:** every page shows its version bottom-left (`ios-scrubber-lightbox/dev/version-badge-plugin.js`): branch, commit, "+changes", `VERSION_LABEL` and any `?switches`. Start experiment servers with `VERSION_LABEL` set so a phone screenshot says what was tested.
- The dev server already listens on the LAN (`server.host: true` in `ios-scrubber-lightbox/vite.config.js`). Put any query switches for an experiment (`?follow=direct`, `?seed=...`) in the links.

## Debugging

- **Headless checks:** `ios-scrubber-lightbox/dev/headless/` has per-frame checks (following accuracy, flatten/grow-back flicker, polyfill first-scroll time). Run them with `node dev/headless/<check>.mjs chromium <url>` after any change to linked scrolling, timeline following or the expand effect, before handing me a phone test. Measure just after a frame (`setTimeout` from `requestAnimationFrame`), not inside `requestAnimationFrame`. Add a check whenever a new one-frame bug turns up. No headless browser has touch momentum, so momentum bugs still need the phone.
- **On-device log:** opening the ramka scrubber, filmstrip or iOS scrubber page with `?log` shows a touch/scroll log with a copy button (`watchHandover` in `dev/debug-console.js`). For a touch or momentum bug headless can't reproduce, get a log from the phone early, plus one from a working version for the same gesture, and compare them before trying fixes.
- **iOS:** a finger landing on a scroller that is still snapping or coasting sends no touch or pointer events, only scrolls. Suspect this first when a bug only happens on a quick re-grab.
- **Chrome desktop:** a page can't stop its own fling or snap animation. Script scroll writes get overridden, and fighting them flickers (#42).

## Behavior

- Ignoring other input while a finger is down and scrolling is fine. Once the finger lifts, any input must be able to interrupt the settle or coast at once.
- A step command (arrow key) mid-settle counts from the item nearest the center right now (the engine's `currentIndex`).
- The long-term aim is interruptible handoff between live, driven and snapshot rendering on the web, beyond carousels. Judge architecture changes by whether they make handoffs general, atomic within a frame, and carry position and velocity over. See `docs/architecture.md`.

## Vocabulary

- Scale-fade, fade, expand and future treatments are **effects**, never "looks" (except in `archive/proto-v1`, where "look" names a separate layer).
- "Snap" means scroll snapping only.

## CSS

- **Effects own their defaults.** Each effect (`shared/effects/*.css`) declares its default tuning variables on its own class, not on `.carousel-wrapper`, so a wrapper only inherits variables its effect reads.
- **Pages restate their knobs.** Each page's CSS restates every variable its carousels could tune, on the specific wrapper: commented out when it keeps the default, live only when it overrides it.
- **Property order:** in a wrapper's rule, the wrapper's own properties come first (including custom properties that feed one, like `--wrapper-gap`), then the item-config variables. Don't add comments explaining this order in the CSS.
