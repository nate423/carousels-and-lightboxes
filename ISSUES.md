# Issues

One entry per problem, referenced by number (#4). Numbers are permanent: a new
issue takes the next one, and nothing is renumbered when an entry moves
section. Next number: **#14**.

Status is one of: **open**, **fix attempted** (a change went in, not yet
confirmed on a device), **parked** (known, deliberately not being worked on),
**done**. Newest attempt last. An entry moves to Done once it's confirmed on
the device it was reported on.

"The expand rewrite" below is a4c1425, which redrew the iOS-style look (iOS
scrubber and ramka strips) with translate and scale instead of custom
properties.

## Open

### #1 Items vanish near the screen edge while scrolling (iOS 27)
- **Status:** open
- **Where:** any carousel whose items scale down (filmstrip, scale-fade, both strips), only while it scrolls natively. A follower drawn on its leader's timeline keeps its edge items until it's touched.
- **Seen:** an item disappears about where it would have left the screen at full size, though scaled down and moved inward it's still in view.
- **Tried:**
  - `isolation: isolate` on items (3522712) - no effect.
  - The `?edge=` candidates from 09c5735 - `willchange`, `outline`, `backface`, `slotlayer`, `noisolate` - none had any effect.
- **Next:** stop adding CSS hints and change the layout: e.g. keep each item's box at the size and place it's drawn at, so nothing on screen is outside its own box.

### #3 iOS scrubber strip flickers while it's dragged, as thumbnails expand
- **Status:** open - introduced by the expand rewrite
- **Where:** iOS scrubber strip.
- **Seen:** dragging the strip itself, the thumbnails flicker as they expand. The time-based flattening (collapse over 200ms when the strip starts leading, grow back over 200ms when it stops) doesn't seem quite right.

### #4 Strip gets stuck with ~2 items fixed in place
- **Status:** open - introduced by the expand rewrite
- **Where:** every iOS-style strip, ramka's included. Seen on iOS 18.6.2 Safari and desktop Safari 17.4.1 (both on the polyfill), possibly iOS 27.
- **Seen:** switching back and forth between scrolling the strip and the main carousel, the strip sometimes ends up with what look like two extra items that stay fixed on screen while the rest scroll across. Hard to pin down, but it undermines confidence in the rewrite generally.
- **Suspects (unverified):** flattening animations (`fill: forwards`) left behind on some items when a flatten is superseded or a timeline takes over; or the polyfill losing its hold on some items' CSS animations after they're paused and resumed.

### #7 Two linked carousels dragged at once
- **Status:** open - better after b890ab4, still janky
- **Tried:** b890ab4 - with a finger on one carousel, the other can't start a horizontal drag until it lifts.

### #8 Collapsed thumbnails' corners stretch
- **Status:** open - introduced by the expand rewrite
- **Seen:** the thumbnail is scaled on x, so 4px corners read as about 2.7px across when collapsed. Not acceptable.
- **Ideas:** draw the thumbnail in three parts - two fixed-width end caps carrying the corners, which translate, and a middle that scales - so the corners never scale and everything stays on the compositor.

### #9 Scroll input issues on iOS
- **Status:** open
- **Seen:** mentioned but not yet described - separate from the motion's performance, and gets in the way of judging it.

## Parked

### #10 ramka's slides keep every photo mounted
- `preload={items.length}` (dd04e1a) fixed scrubbing hitches by holding all 12 photos decoded. Fine for a demo, won't scale. Ideas: hold ramka's mount window still while scrubbing, or decode ahead in the direction of travel.

### #11 Fade look sits 0.5px off at rest after being driven
- fade.js never writes `--scroll-error`, so a driven fade carousel keeps its scroll position's rounding. Invisible in practice.

### #12 Error on archive/proto-v1 in WebKit 17.4
- "Advanced beyond the end", from the archive's own polyfill copy. Nothing in `shared/` involved.

## Temporary scaffolding to remove

- `ios-scrubber-lightbox/dev/edge-experiment.js` and the `?edge=` switch (09c5735) - none of its candidates helped #1, so it can go.
- The compare page and `?follow=direct`, if before/after comparison stops being useful.

## Done

### #2 iOS scrubber strip loads off item 0 (iOS 27)
- **Seen:** on first render, item 0 left of centre, item 1 part-grown, and the gap after item 1 wider than the rest - the strip's scroll position a little past 0.
- **History:** never seen before the timeline-following work (43b4107 onward); first noticed after it.
- **Tried:** 60181de - `overflow-anchor: none` on carousels, and a resting carousel returns to its item after a resize.
- **Fixed by** the expand rewrite (a4c1425), which stopped the look changing any box's size. Plausibly the thumbnails' width changes were what moved the strip.

### #5 Main carousel nudged or flickers as the iOS strip's thumbnails grow back
- **Seen:** after scrolling the strip, over the thumbnail's grow-back, the main carousel shifted left, sometimes flickering indefinitely.
- **Tried:** 970b26f - only a carousel moving for its own reasons drives the other, and a follower lets go of its leader at rest.
- **Fixed by** 970b26f and the expand rewrite together.

### #6 Follower jitters or drops frames behind its leader
- **Seen:** the strip lagged and jittered behind the main carousel, most visibly on ramka's lightbox and during momentum on iOS 27.
- **Fixed by** 4926074 (a follower's own animations pause while a timeline draws it) and the expand rewrite (the iOS-style look runs on the compositor). Confirmed buttery on the ramka scrubber on iOS 27.

### #13 Earlier fixes, confirmed
- Follower flickering when pausing a drag mid-way - the snap restore timer (4926074).
- The iOS scrubber's carousels resting on different items after a thumbnail click mid-motion (4926074, 970b26f).
- The filmstrip strip dropping frames under CPU throttling in Chrome - its own animations blocked compositing (4926074).
- A one-frame collapsed flash when the main carousel jumps to an item (c55c3d7).
