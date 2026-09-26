# Carousels and Lightboxes

One app, one dev server. `ios-scrubber-lightbox/` is a Vite multi-page app:
a React lightbox page alongside the vanilla HTML/CSS/JS carousel prototypes,
built on native CSS scroll-driven animations (with the standard
scroll-timeline polyfill where those are not supported natively).

## Structure

```
ios-scrubber-lightbox/
  index.html               links to the pages below
  lightbox-app/            the React lightbox (mounts src/App.jsx)
  src/                     the React app's source
  scale-fade/              a carousel with a page-dot navigator
  filmstrip/               the same effect, navigated by a proportional filmstrip
  ios-scrubber/             fixed-size thumbnails; only the centred one expands
  shared/
    carousel-math.js        numbers in, numbers out
    carousel-engine.js      builds and drives one scroller
    effects/                the scale-fade, fade and expand effects
    linked-scrolling/       two carousels driving each other (see its README)
    base.css                page chrome, and the carousel and item boxes
  dev/                      debugging aids, all off by default
  archive/proto-v1/         the frozen prototype these were reduced from
```

`shared/` holds what is genuinely common and carries no configuration - none of
it asks which page is calling. Anything that varies between the behaviours
lives in that behaviour's own directory instead, which is why `ios-scrubber/`
is much the largest of the three.

A wrapper opts into the scale-fade effect by carrying the `scale-fade` class.
Which carousels want it differs per page - both of the filmstrip's, only the
main one on the iOS page - and saying that in the markup rather than in each
page's selectors is what keeps the stylesheet identical everywhere.

`archive/proto-v1/` is a complete, runnable snapshot of the earlier version -
all four effect variants side by side, with live controls. It is the reference
implementation for the hand-computed effects and the A/B baseline for checking
the reduced versions against. It never imports from outside itself, and it
never gets fixed. See its own README.

## Planning

- [docs/architecture.md](docs/architecture.md) - where the architecture is
  and where it's going.
- [docs/handoff-proto.md](docs/handoff-proto.md) - the prototype that proves
  the handoff model first.

## Running locally

```bash
cd ios-scrubber-lightbox
npm install
npm run dev
```

Serves everything - the landing page, the vanilla pages, and the React
lightbox - from one Vite dev server at `http://localhost:56576`.
