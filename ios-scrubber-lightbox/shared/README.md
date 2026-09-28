# shared

The carousel code every page here builds on, in plain JavaScript and CSS. It
doesn't know which page is using it; anything that differs between pages
lives in that page's own directory.

The aim is motion that feels fluid and responsive enough that people trust
it: it follows the finger, can be interrupted at any point, and doesn't drop
frames, flicker or jitter. Those small glitches are what make an interface
feel unreliable, so much of this code exists to avoid them.

Scroll-driven animations make this far more achievable on the web than it
used to be. They let the browser run an effect from the scroll position
itself, on the compositor, rather than script redrawing it on each scroll
event, and they now ship in current versions of Chrome and Safari.

## Overview

Each carousel is a native scroll container, so momentum, scroll snapping and
rubber-banding come from the browser and match the platform.

The engine describes a carousel's position as its progress, measured in
items: 3 means item 3 is centered, and 3.5 means halfway between items 3 and
4.

Effects (scale-fade, fade, expand) set how each item looks at a given
progress. An effect generates CSS animations that are driven by the
carousel's scroll position rather than by time (scroll-driven animations),
so the browser can run them on the compositor as the carousel scrolls,
without script on each frame. The keyframes are generated up front, one at
each item's position, calculated so each item looks right at every point
between them. Script draws an effect directly only in the few cases the
animations can't cover, such as a carousel driven past either end.

Two carousels can be linked so that scrolling one moves the other. See
[linked-scrolling/](linked-scrolling/) for how the follower is drawn on the
leader's scroll timeline and switches back to a real scroller when touched.

## Contents

```
carousel-engine.js        builds and drives one carousel; returns its controller
carousel-math.js          progress math, as pure functions
base.css                  page chrome, and the boxes a carousel and its items sit in
scroll-timeline-loader.js loads the polyfill where scroll-driven animations are missing
effects/
  scale-fade.js/.css      centered item at full size; the rest smaller and faded
  fade.js/.css            centered item at full opacity; the rest faded
  expand.js/.css          fixed-size thumbnails; the centered one grows
  helpers/                gap compensation, item ids, stylesheet swapping
engine/                   parts of the engine: geometry cache, spacers, press
                          tracking, scroll end, item population
linked-scrolling/         two carousels driving each other
vendor/                   the scroll-timeline polyfill
```

## Using it

```js
import { createCarousel } from "../shared/carousel-engine.js";
import { scaleFadeEffect } from "../shared/effects/scale-fade.js";

const carousel = createCarousel(wrapper, {
  itemCount: 30,
  effect: scaleFadeEffect,
  createItem: createPlaceholderItem
});

carousel.setOnProgress((index, progress) => { /* update a navigator */ });
carousel.goToIndex(3);
```

The page supplies each item's content (`createItem`) and any navigation UI.
To link two carousels:

```js
import { linkCarousels } from "../shared/linked-scrolling/link.js";

linkCarousels(mainCarousel, strip, {
  aWhileFollowing: "continuous",
  bWhileFollowing: "continuous"
});
```

Each page also loads `scroll-timeline-loader.js` as a classic script, after
its stylesheets and before its entry module.

## Effects

An effect is an object with functions the engine calls:

- `setup(ctx)` generates the scroll-driven animations for the current item
  positions. It runs again whenever the items are measured again.
- `apply(ctx)` runs at most once per frame while scrolling. It reports the
  current item, and draws the effect from script where the animations can't.
- `followFrames(ctx, samples)` returns keyframes for drawing this carousel on
  another carousel's scroll timeline. Without it, a follower is drawn by
  writing its scroll position.
- `prepare`, `onItemCreated` and `onMotionChange` are optional hooks: setup
  before items exist, per-item markup, and responding to the carousel
  leading, following or coming to rest. The iOS strip uses the last one to
  flatten its thumbnails while it's dragged.

A carousel's wrapper gets an effect's styles by carrying its class, and each
effect's CSS declares its default tuning variables on that class.

## Conventions

- Effects draw with translate, scale and opacity, which the compositor can
  animate, and don't change an item's layout size.
- Item positions are measured once per layout change and cached
  (`engine/geometry-cache.js`), not read on every frame.
- Progress math lives in `carousel-math.js` as pure functions.

## Browser support

Chrome and Safari 26 run scroll-driven animations natively. Other browsers
get the scroll-timeline polyfill, which runs them in script; there, a
follower is drawn by writing its scroll position, since a polyfilled
timeline wouldn't save any work. Where a browser has no `scrollend` event,
`engine/scroll-end.js` infers the end of a scroll from scroll events.

## Plans

This design came out of working through a lot of odd browser behavior, and
it will keep changing. [docs/architecture.md](../../docs/architecture.md)
describes where it is, its known limits, and the next steps: moving motion
shared by every item onto one element, giving each item keyframes only where
it's on screen, and handling the handoffs between the different ways an item
is drawn in one place, so each new effect doesn't have to solve them again.
