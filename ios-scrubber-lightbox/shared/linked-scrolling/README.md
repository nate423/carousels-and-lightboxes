# linked-scrolling

Two carousels driving each other: whichever one is being scrolled leads, and
the other follows in real time. The filmstrip and iOS scrubber pages are both
built on it; the scale-fade page is not, and imports none of this.

It is four files because it is four separable questions, but it is one unit -
taking `link.js` without the others leaves it calling methods nothing
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
- **`timeline-follow.js`** - a carousel following another continuously is
  drawn by animations on the leader's own scroll timeline, not by writing its
  scroll position on every scroll of the leader, so it moves with the leader
  from the same frame and with no script in between. Its real scroll position
  is written back the instant anything could need it - real input on it, a
  command to it - so anything that handles it starts from where it really
  is.
- **`link.js`** - the wiring itself. Touches no DOM; works entirely through the
  carousel controller's public surface.

## What a carousel has to provide

`link.js` calls `getCurrentProgress`, `getProgressKnots`, `setProgressDirect`,
`follow`, `onPressChange`, `lockPanning` and `yieldLead` (all optional), `isMovingItself`, `selfScrollStartedAt`, `getItems`, `onScroll`,
`onScrollEnd` and `endFollowing`, and a leader's `wrapper` is the source of
the scroll timeline a continuous follower is drawn on. `carousel-engine.js`
implements all of them, and builds the attribution, snap suspension and
timeline following above as part of doing so; an effect opts into being
drawn on a timeline by providing `followFrames`.

`ramka-slides-controller.js` is a second implementer, adapting a scrollport
this codebase doesn't own the internals of (ramka's Lightbox `Slides`
viewport, reached only through its public `data-ramka-slides`/`data-ramka-slide`
data attributes) so `link.js` can drive it the same way, with no knowledge
that it isn't a carousel-engine wrapper. See the ramka-scrubber page.

Both implementers build what they share from the same modules -
`scroll-attribution.js`, `yield-lead.js`, `../engine/press.js`,
`../engine/scroll-end.js` - so a change to how carousels hand over the lead
reaches both. What each does around them (snap, geometry, following) is its
own, and a change there usually needs making in both.

## The part that is easy to get wrong

A driven carousel cannot trust its own `scrollend`. Its scroll position is
quantised, so during a slow drive it sits on the same pixel for long enough
that the browser calls the scroll over while the carousel actually driving it
is still moving. So "following" ends when the *leader* reports its gesture is
done - that is what `endFollowing` is for, and why the link forwards the
leader's `onScrollEnd` rather than letting each side watch its own.

The leader's `onScrollEnd` also re-runs the same sync `onScroll` does, not
just `endFollowing`. "Instant" mode only checks for a new index on the
leader's own scroll events, so if the leader's last scroll event before going
idle doesn't land on its truly-final index - a fast flick landed the dest a
couple of items short of where the leader actually stopped, once, against
`ramka-slides-controller.js`'s dest and its own async reconciliation - nothing
ever re-checks afterward. `onScrollEnd` only fires once the leader is
genuinely at rest, so re-syncing there catches it regardless of what caused
the miss on the way.
