# linked-scrolling

Two carousels driving each other: whichever one is being scrolled leads, and
the other follows in real time. The filmstrip and iOS scrubber pages are both
built on it; the scale-fade page is not, and imports none of this.

It is three files because it is three separable questions, but it is one unit -
taking `link.js` without the other two leaves it calling methods nothing
implements.

- **`scroll-attribution.js`** - is this carousel moving for its own reasons, or
  because we just wrote its scroll position? Every scroll event a wrapper emits
  is attributed to one or the other, and "driven" is sticky rather than timed,
  because a programmatic write's consequences have no bounded duration. This is
  the hard part, and its header explains why input events cannot answer it.
- **`snap-suspension.js`** - `scroll-snap-type: mandatory` tries to correct
  exactly what a direct write looks like to it, so snap is suspended for the
  duration of a drive and handed back the instant real input reclaims the
  carousel, not on a timer.
- **`link.js`** - the wiring itself. Touches no DOM; works entirely through the
  carousel controller's public surface.

## What a carousel has to provide

`link.js` calls `getCurrentProgress`, `setProgressDirect`, `isMovingItself`,
`selfScrollStartedAt`, `getItems`, `onScroll`, `onScrollEnd` and
`endFollowing`. `carousel-engine.js` implements all of them, and builds the
attribution and snap suspension above as part of doing so.

## The part that is easy to get wrong

A driven carousel cannot trust its own `scrollend`. Its scroll position is
quantised, so during a slow drive it sits on the same pixel for long enough
that the browser calls the scroll over while the carousel actually driving it
is still moving. So "following" ends when the *leader* reports its gesture is
done - that is what `endFollowing` is for, and why the link forwards the
leader's `onScrollEnd` rather than letting each side watch its own.
