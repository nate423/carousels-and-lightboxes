# linked-scrolling

Two carousels linked so that scrolling one moves the other, the way a photo
viewer and its thumbnail strip move together in iOS Photos. Whichever one
you're moving leads, and the other follows.

The filmstrip, iOS scrubber and ramka scrubber pages are built on it. The
scale-fade page has a single carousel and doesn't use it.

## Goals

Both carousels should behave like ordinary native scrollers, with the
browser's own momentum, scroll snapping and rubber-banding. The follower
should stay in step with the leader without trailing behind the finger.
Either carousel should be grabbable at any time, including while it's
following or still coasting, and respond from where it appears to be. And
once a finger lifts, other input (a touch on the other carousel, a wheel, a
click on a thumbnail, an arrow key) should be able to interrupt whatever
motion is left.

The reason for all of this is confidence. When the interface tracks your
finger, responds straight away, and never shows a stray frame, you stop
thinking about it and trust it. A dropped frame, a one-frame flicker or a
small jitter each chips away at that. Most of the work in this directory
goes into removing those, especially at the moments one carousel hands over
to the other.

## Why it takes more than a scroll listener

The simplest link listens for the leader's scroll events and sets the
follower's `scrollLeft` to match. That runs into several problems:

- The follower lags. The leader's scroll event has to reach the main thread
  and script has to write the follower before the follower's effect can
  update, so it trails, and trails further when the main thread is busy.
- `scroll-snap-type: mandatory` treats a written scroll position as
  something to correct, and pulls the follower back onto an item.
- Writing a scroll position fires a scroll event, which looks the same as
  someone scrolling the follower. Two carousels that each drive the other can
  end up driving each other in a loop.
- Scroll positions are whole pixels. A short strip driven by a long carousel
  can sit on the same pixel for several frames, so it moves in steps, and the
  browser can decide its scroll has ended while the drag is still going.
- Input events don't reliably say which carousel is moving. The browser keeps
  a wheel gesture on the scroller it started on but sends the wheel events to
  whatever is under the cursor, and iOS sends no touch events for a finger
  that lands on a scroller that is still snapping or coasting.
- iOS runs momentum outside the page, and writing a scroll position into a
  coasting carousel fights the momentum rather than stopping it.

## How it works

### Following on the leader's scroll timeline

Each carousel's effect is a set of CSS animations driven by its own scroll
position rather than by time (scroll-driven animations). While a carousel
follows, it gets a second set of animations driven by the leader's scroll
position instead, through a `ScrollTimeline` on the leader. The browser
updates the follower as it scrolls the leader, on the compositor, without
waiting for script.

The keyframes for those animations are generated up front. Between two
neighboring items, a carousel's progress (its position measured in items)
changes linearly with its scroll offset, and the effects here also change
linearly with progress between items. So the keyframes are placed at each of
the leader's items, at the percentage of its scroll range where that item is
centered, and the browser interpolates between them.

While following this way, the follower's real scroll position stays where it
was when following began, and the difference between that and what's shown
is drawn as a translate.

In browsers without native scroll timelines (where the polyfill runs them in
script), and while the leader rubber-bands past either end, the follower's
scroll position is written on each of the leader's scroll events instead.

### Becoming a real scroller again on touch

A carousel drawn on the leader's timeline only looks like it's at that
position. The browser pans a scroller from its real scroll position, often
before the page hears about the touch. So when real input lands on a follower
(a finger, a pointer, a wheel, a key), or it's given a command (a click on a
thumbnail), the engine:

1. writes its real scroll position to match the progress it's showing,
2. stops the timeline animations, and
3. turns scroll snapping back on.

These happen together in one task, so the frame that follows shows the
carousel in the same place, and the gesture starts from there. While a finger
is already down on a carousel, or it's still moving on its own, it follows by
written scroll positions, so its real position matches what's shown.

Going onto the timeline works the same way in reverse: the real scroll
position is written first, and the effect keeps drawing the carousel itself
until the new animations report they're ready, since a new animation can take
a frame to start drawing.

### Deciding who leads

Every scroll a carousel makes is attributed to one of two sources:

- "self": it's moving for its own reasons, from a gesture on it or a command
  to it. Only these scrolls are passed on to the other carousel.
- "driven": the link is moving it, and its scroll events are echoes of that.

A carousel stays "driven" until real input reclaims it, with no time limit,
because the effects of a write can go on for a while: the browser's snap
correction after a write has been seen scrolling for over a second. Input
events are only used to switch back to "self". Whether a carousel is actually
moving is read from its scroll events.

Scrolls the browser makes by itself, such as re-snapping after a layout
change, don't count as leading. Otherwise they'd move the other carousel too,
and by several times as much when it's the larger one.

### When following ends

The follower goes onto the timeline on the leader's first scroll, and comes
off when the leader's scroll ends, including momentum and snapping. It then
moves to a real scroll position on the item the leader stopped on, and
snapping comes back on.

The follower's own `scrollend` isn't used for this. During a slow drive it can
sit on one pixel long enough for the browser to consider its scroll over
while the leader is still moving.

## Keeping every frame consistent

At different moments an item can be drawn by its own scroll-driven
animations, by animations on the other carousel's timeline, or by script.
Each switch between them is a chance for one frame to show the wrong thing,
and most of the flickers we've fixed came from one of those switches. They
were usually spotted on a device first, then reproduced with a per-frame
headless check (`../../dev/headless/`) so a fix could be measured.

The general approach is to put the new state in place before switching, and
keep the old way of drawing until the new one is actually drawing. The
specific cases:

- **A written scroll position reaches scroll-driven animations a frame
  late.** In Chrome, a carousel's own animations still draw its old position
  for one frame after script writes a new one. When a follower came off the
  leader's timeline, its centered item shrank and faded for that frame, then
  came back ([#24]). The effect now draws the carousel from
  script for that one frame, then hands back to the animations.
- **A new animation can take a frame to start drawing.** Going onto the
  leader's timeline, the effect keeps drawing the follower until the new
  animations report they're ready. The iOS strip's flatten and grow-back
  animations are filled backwards as well as forwards, and each one is kept
  until its replacement has started. Without that, the strip sometimes showed
  a thumbnail fully grown for a frame after a flick ([#18]).
- **The order of work within a frame.** A browser frame dispatches
  scroll events, then samples scroll-driven animations, then runs
  `requestAnimationFrame` callbacks. A write made in a callback is painted at
  its new position but drawn as if it were still at the old one. On iOS that made the
  follower look detached from the finger, and an item jumped to arrived
  collapsed, then popped to full size. The link now writes the follower from
  inside the leader's scroll event, before the animations are sampled.
- **Whole pixels.** A short strip driven by a long carousel often doesn't
  change pixel, so it fires no scroll event, and a slow drag looked like it
  stepped. The effect now redraws on every write rather than waiting for a
  scroll event. Item positions are also measured to fractions of a pixel,
  since rounding them left a follower resting half a pixel off, which showed
  as several pixels on a larger carousel.
- **Timers.** Snapping used to come back on a short timer after a drive. When
  a drag paused, snapping returned, the follower snapped to the nearest item,
  and the next movement pulled it back between two, over and over. On the
  polyfill, the end of a scroll was guessed from a pause in scroll events, so
  holding still mid-scroll ended it and the strip snapped ([#22]).
  Both now follow events: the leader's scroll actually ending, real input,
  and whether the carousel is resting on an item.
- **Scrolls the browser makes by itself.** On iOS, the strip's thumbnails
  growing back nudged the strip's scroll position, which moved the main
  carousel, which sometimes kept flickering ([#5]). Only a carousel moving
  for its own reasons leads now, and effects don't change item sizes.

Some are still open: in desktop Chrome, the strip's items can drift slightly
out of step with each other during a fast scroll ([#32]), and WebKit
sometimes reports a wheel-scrolled carousel's position flipping between two
values ([#45]).

Each of these fixes currently lives with the effect or module where the
problem showed up. The plan in [docs/architecture.md](../../../docs/architecture.md)
is to handle switching between ways of drawing in one place, so a new effect
gets these cases right without rediscovering them.

[#5]: https://github.com/nate423/carousels-and-lightboxes/issues/5
[#18]: https://github.com/nate423/carousels-and-lightboxes/issues/18
[#22]: https://github.com/nate423/carousels-and-lightboxes/issues/22
[#24]: https://github.com/nate423/carousels-and-lightboxes/issues/24
[#32]: https://github.com/nate423/carousels-and-lightboxes/issues/32
[#45]: https://github.com/nate423/carousels-and-lightboxes/issues/45

## Interruptions

In general, the carousel touched most recently leads, and a finger that's
already down keeps control of its carousel until it lifts.

| What happens | What the link does |
|---|---|
| You drag one carousel while the other is still coasting | The coasting one stops and follows the drag. On iOS it's stopped by hiding its overflow until the finger lifts, because writing into iOS momentum doesn't stop it. |
| You touch a carousel that's following on the other's timeline | It switches to its real scroll position and leads, and the other one follows it. |
| A second finger lands on the other carousel mid-drag | Horizontal panning on it is locked until the first finger lifts, so the two aren't dragged in different directions at once. |
| You use a wheel on one carousel while the other is still moving | The other one stops leading and follows. Its overflow is only hidden for one frame, so the next wheel gesture on it still works. |
| You click a thumbnail while the other carousel is coasting | The click counts as a command: the strip scrolls to that thumbnail and the other carousel follows. |
| A finger lands on an iOS carousel that's still snapping | iOS sends no touch events here. A carousel that was resting on an item treats its next scroll as someone moving it, since the browser has nothing left to correct from there. |
| The leader rubber-bands past an end | The follower is driven directly, so its end item winds down along with it. |
| The window resizes during a follow | The timeline animations are rebuilt for the new item positions. |

Input to the other carousel is ignored while a finger is down and scrolling.
That's intended; the aim is that once the finger lifts, the remaining settle
or coast can be interrupted straight away.

## Two ways to follow

Each side of a link has a setting for how it follows while the other leads,
chosen once by the page:

- "continuous": it tracks the leader's position the whole time.
- "instant": it stays put until the leader's current item changes, then
  changes to that item instantly.

The filmstrip and iOS scrubber pages follow continuously in both directions.
On the ramka scrubber page, the strip follows ramka's slides continuously and
the slides follow the strip instantly.

## The files

They work as one unit: `link.js` calls methods the others provide.

- `link.js` wires two carousels together. It touches no DOM and works through
  each carousel's public controller.
- `scroll-attribution.js` tracks whether a carousel's scrolling is "self" or
  "driven", and whether it's leading, following or idle. Its header explains
  why input events can't answer this.
- `timeline-follow.js` draws a follower on its leader's scroll timeline.
- `snap-suspension.js` turns snapping off while a carousel is driven, and back
  on when the drive ends or real input reclaims it.
- `yield-lead.js` hands the lead from a carousel that's still moving to one
  that was just touched or wheeled.
- `ramka-slides-controller.js` provides the same controller for ramka's
  lightbox slides, which this codebase doesn't own.

## What a carousel has to provide

`link.js` calls `getCurrentProgress`, `getProgressKnots`, `setProgressDirect`,
`follow`, `isMovingItself`, `selfScrollStartedAt`, `getItems`, `onScroll`,
`onScrollEnd` and `endFollowing`, plus `onPressChange`, `lockPanning`,
`yieldLead`, `isPressed` and `onWheel` where they exist. A leader's `wrapper`
is the source of the scroll timeline a continuous follower is drawn on.
`carousel-engine.js` implements all of them. An effect can be drawn on a
timeline if it provides `followFrames`.

`ramka-slides-controller.js` is a second implementation. It adapts ramka's
Lightbox `Slides` viewport, reached only through its public
`data-ramka-slides` and `data-ramka-slide` attributes, so `link.js` can drive
it the same way as a carousel-engine wrapper. See the ramka scrubber page.

Both implementations use the same modules for handing over the lead
(`scroll-attribution.js`, `yield-lead.js`, `../engine/press.js`,
`../engine/scroll-end.js`), so a change there reaches both. Snapping,
geometry and following are implemented separately in each, and a change to
one of those usually needs making in both.

## Re-syncing when the leader stops

When the leader's scroll ends, the link runs the same sync it runs on each
scroll event, as well as `endFollowing`. An "instant" follower only checks for
a new current item on the leader's scroll events, so if the leader's last
scroll event comes before it reaches its final item, nothing would check
again. This happened once with a fast flick on the strip, which left ramka's
slides a couple of items short. `onScrollEnd` only fires once the leader is at
rest, so syncing there picks up the final item.

## Trying it

- `compare/` shows the same linked pair twice, side by side: one follower
  drawn by written scroll positions, the other on the leader's timeline.
- Opening the filmstrip, iOS scrubber or ramka scrubber page with `?log`
  shows an on-screen log of touches, scrolls and handovers.
- `../../dev/headless/` has per-frame checks of how closely the follower
  tracks the leader.
