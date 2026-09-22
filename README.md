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
  index.html               links to the pages below
  scale-fade/              a carousel with a page-dot navigator
  filmstrip/               the same look, navigated by a proportional filmstrip
  ios-scrubber/            fixed-size thumbnails; only the centred one expands
  shared/
    carousel-math.js       numbers in, numbers out
    carousel-engine.js     builds and drives one scroller
    effects/               the scale-fade look
    linked-scrolling/      two carousels driving each other (see its README)
    base.css               page chrome, and the carousel and item boxes
    scale-fade-look.css    the look's timelines, for any .scale-fade wrapper
  dev/                     debugging aids, all off by default
  archive/proto-v1/        the frozen prototype these were reduced from
```

`shared/` holds what is genuinely common and carries no configuration - none of
it asks which page is calling. Anything that varies between the behaviours
lives in that behaviour's own directory instead, which is why `ios-scrubber/`
is much the largest of the three.

A wrapper opts into the scale-fade look by carrying the `scale-fade` class.
Which carousels want it differs per page - both of the filmstrip's, only the
main one on the iOS page - and saying that in the markup rather than in each
page's selectors is what keeps the stylesheet identical everywhere.

`archive/proto-v1/` is a complete, runnable snapshot of the earlier version -
all four effect variants side by side, with live controls. It is the reference
implementation for the hand-computed looks and the A/B baseline for checking
the reduced versions against. It never imports from outside itself, and it
never gets fixed. See its own README.

## Running locally

```bash
npx serve src
```
