# Headless checks

Scripted checks of the iOS scrubber page in a headless browser, measuring
every frame. They catch what's too quick to see reliably by eye: a single
frame drawn in the wrong place, a flicker at a handover, a slow first scroll.
They don't replace trying things on a phone - headless browsers have no
touch or momentum - but they're quick to re-run after every change.

Each takes a browser (`chromium` or `webkit`) and a page URL, defaulting to
the main dev server, and prints the version badge of what it measured. The
first two exit non-zero if anything is off.

```
node dev/headless/following.mjs chromium http://localhost:57000/ios-scrubber/
```

- **`following.mjs`** - scrolls each carousel in turn, and checks on every
  frame that the strip matches the expand effect's formula and the main
  carousel's centre items match the fade's, at the main carousel's measured
  progress. A frame is bad if the strip is more than 0.5px out, or an
  opacity more than 0.02. Found the one-frame jumps when following on a
  timeline starts or stops. While the main carousel is wheeled in WebKit,
  it skips frames where the last scroll event reported a position that
  didn't stick (#45), and prints how many.
- **`flattening.mjs`** - drags the strip, drags it again mid-grow-back, and
  has the main carousel take over, and checks the centre thumbnail never
  changes width by more than 4px from one frame to the next. Found the
  one-frame flash of the full-size thumbnail before it grows back.
  Chromium only: headless WebKit stalls time-based animations.
- **`first-scroll.mjs`** - times the main carousel's first scroll event, every
  listener included, and the longest frame after it. Defaults to WebKit.
  Measured #17 at ~120ms on a4c1425, ~10ms since.
- **`filmstrip-following.mjs`** - scrolls each carousel on the filmstrip
  page in turn, and checks on every frame that both match the scale-fade
  effect at the scrolled carousel's position, within 0.5px. Main at e0c5a28
  already has two frames 1.8px off in "strip leads, right" in Chromium. Use
  Chromium to compare versions: in WebKit, the carousels come to rest on
  different items depending on how quickly the page handles each wheel
  event.
- **`effect-snapshot.mjs`** - records each item's on-screen box and opacity
  at 41 scroll positions, for every scale-fade carousel on a page; `compare`
  diffs two snapshots. Use the filmstrip page with `?seed=14`, since the
  scale-fade page picks random item sizes on every load.

`lib.mjs` holds what they share, including the probe they inject: it reads
the effect's dimensions from the page's own custom properties, and measures
just after each frame, once every animation frame callback has run -
measured at the start of a frame, it reads styles the engine hasn't
finished writing.

## Browsers

`webkit` is WebKit 17.4, with no scroll timelines of its own, so the pages
load the scroll-timeline polyfill, as Safari 17.4 and iOS 18 do. That's why
`playwright-core` is pinned to 1.43.1: the last version on WebKit 17.4. If
it isn't already cached, `npx playwright-core install webkit`.

`chromium` uses any Chrome for Testing in Playwright's cache
(`~/Library/Caches/ms-playwright`), or `CHROMIUM_PATH`.
