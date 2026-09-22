# Carousels and Lightboxes

Vanilla HTML/CSS/JS prototypes of carousel and scrubber behaviours, built on
native CSS scroll-driven animations (with the standard scroll-timeline
polyfill where those are not supported natively).

## Structure

Each behaviour is its own page, self-contained: its own markup, its own
stylesheet, its own entry script, and no runtime switch that would let it be
configured into one of the others.

```
src/
  index.html          links to the pages below
  scale-fade/         a carousel with a page-dot navigator
  filmstrip/          the same look, navigated by a proportional filmstrip
  ios-scrubber/       fixed-size thumbnails; only the centred one expands
  shared/             the engine, the geometry math, and linked scrolling
  dev/                debugging aids, all off by default
  archive/proto-v1/   the frozen prototype these were reduced from
```

`shared/` holds what is genuinely common and carries no configuration:
`carousel-math.js` is numbers in and numbers out, `carousel-engine.js` builds
and drives one scroller, and `carousel-link.js` (with `engine/`'s scroll
attribution and snap suspension) is what lets two carousels drive each other.
Anything that varies between the behaviours lives in that behaviour's own
directory instead.

`archive/proto-v1/` is a complete, runnable snapshot of the earlier version -
all four effect variants side by side, with live controls. It is the reference
implementation for the hand-computed looks and the A/B baseline for checking
the reduced versions against. It never imports from outside itself, and it
never gets fixed. See its own README.

## Running locally

```bash
npx serve src
```
