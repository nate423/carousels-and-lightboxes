# Gotchas from replacing ramka's thumbnail strip

This page swaps ramka's built-in `ThumbnailStrip` for a real
`shared/carousel-engine.js` instance (`scrubber-strip.jsx`), linked to
ramka's `Slides` viewport through `shared/linked-scrolling/ramka-slides-controller.js`.
That file's own header documents the linking half - the adapter pattern,
why it measures via `getBoundingClientRect` instead of the shared
geometry cache, why its snap suspension isn't the shared one. Below is
the other half: bugs that specifically came from wiring a
`carousel-engine` look into ramka's React tree, hit while building this
page. Not a checklist to follow - a record of what actually went wrong,
in case the next attempt at this runs into the same class of bug.

## Init ran twice under React StrictMode

`createCarousel` has no teardown - it appends DOM items and attaches
listeners straight to the wrapper element. StrictMode's dev-only
mount→cleanup→mount double-invoke runs against the *same* wrapper node
(it isn't recreated), so without a guard we got two populated item sets
and two link wirings stacked on top of each other - 24 items instead of
12, positions computed against corrupted geometry.

The guard took two tries to get right:

- Setting it synchronously, before some deferred work, meant StrictMode's
  cleanup could cancel that work while the flag already read 'true' - the
  first invocation's init never finished, and the second bailed out on
  the guard. Nothing initialized at all.
- Once that was fixed, returning a cleanup function that tore down *part*
  of what init set up (we unsubscribed the `onMotionChange` listener,
  specifically) produced an asymmetric leak: everything else, having no
  teardown, stayed wired from the first invocation, but the one thing we
  *did* unsubscribe never got resubscribed, since the guard skipped the
  second invocation entirely. Every contrast-flatten-while-dragging
  callback silently went dead.

What worked: set the flag only once initialization actually completes,
and return no cleanup at all. Nothing here is safely tearable-down
piecemeal, so no partial cleanup is safe either.

## Borrowed snap-suspension clobbered ramka's own

`shared/linked-scrolling/snap-suspension.js` restores `scroll-snap-type`
to `""` - correct for a `carousel-engine` wrapper, which falls back to a
stylesheet rule. ramka's `Slides` manages `scroll-snap-type` itself,
entirely via inline style (see its own source, embedded in
`node_modules/@ramka/react/dist/lightbox/lightbox-slides.js.map`'s
`sourcesContent`), with no stylesheet fallback. Reusing the shared
suspension against it permanently wiped ramka's own value the first time
we suspended it - the main carousel lost native scroll-snap entirely,
scrolling free from then on. Fixed by capturing ramka's actual current
inline value before overwriting and restoring exactly that, rather than
assuming an empty override was a safe default (or hardcoding ramka's own
literal value in its place).

## A CSS ordering gap baked in a wrong spacer size

`createCarousel` calls `populateItems()` (which measures items to size
the spacers) *before* `effect.setup()` (which is what adds a look's own
class - `expand.js` adding `.expand-effect`). `expand.css` derives
`--expand-item-width` from `--expand-item-height` only inside a rule
scoped to that class. Our override only set the height, not the derived
width, so the very first read - the one the initial spacer size got
permanently computed from - landed before `.expand-effect` was present,
and fell back to the property's own `@property initial-value` (24px)
instead of the 32px our override actually meant. The strip then sat
persistently offset from the main carousel whenever it was driven, by
exactly that error, forever - nothing ever re-measured it. Invisible on
`ios-scrubber.css`, which never overrides the height away from a default
that happens to equal the initial-value. Fixed by declaring the derived
width directly on our own selector, not dependent on the look's own class
landing first.

## Copied transitions added lag that wasn't there in the reference page

`expand.css` ships `transition: none` on its item/thumb, on purpose - the
comment explains why: self-scrolling reads a continuous, scroll-linked
value (`animation-timeline`), and a transition on top of an
already-continuous value only adds lag. `ios-scrubber.css` re-enables a
200ms transition anyway, because *that* page's strip is driven by a
carousel roughly 8x its own length, badly undersampling writes.

We copied that transition here, assuming it'd carry over the same way.
It made things worse: this strip's driver (`ramka-slides-controller.js`)
writes a fresh value every rAF-throttled scroll frame already, so the
extra 200ms just trailed it by about half that - a visible, measured lag
when the main image drove the strip. It also compounded with the
`--contrast-amount` transition (the flatten-while-dragging effect) on
scrollend, since `--item-progress-effective` already carries that
transition through its own `calc()` chain without needing a second one -
re-expanding after a drag read as noticeably slower than the reference
page instead of matching it. Removed the copied transition entirely;
position and width now track their already-smooth sources directly.

## A hard flick on the strip leaves the main carousel stale - still open

Flicking the strip hard toward one end can leave ramka's main carousel
stuck a few items short of where the strip actually settled, only catching
up (visibly, distractingly) once something else nudges it. Two real,
independently-justified fixes landed while chasing this - a geometry cache
in `ramka-slides-controller.js` (measuring every slide via
`getBoundingClientRect` on every single call was real, measurable
layout-thrashing) and a `scrollend` catch-up in `link.js` (the "instant"
follow mode's per-tick sync had nothing to correct a source that went idle
right after an undershooting tick) - but retesting after each showed the
underlying staleness itself unchanged.

Also tried: switching the main-carousel-follows-strip direction from
`link.js`'s "instant" mode to `'continuous'`, on the theory that "instant"
only reacts to whatever `scroll` events land and ramka's own React
reconciliation makes those land more sparsely under load than on the
featherweight vanilla `ios-scrubber` page (where the same "instant" logic
never shows this). That theory may still be right, but `'continuous'` was
the wrong fix for it regardless: it swaps the discrete jump-between-photos
character for a smooth pan, which is a different behavior, not a repaired
version of the same one - and reverting it was needed. Reverted back to
`'instant'`.

Net state: the geometry cache and scrollend catch-up are real
improvements, kept. The core staleness-under-a-fast-flick bug is not yet
fixed. Whatever the real mechanism is, it wasn't found by any of the three
attempts above, each of which seemed well-supported by evidence gathered
*from this environment's own synthetic scroll tooling* - which cannot
reproduce a genuine multi-event momentum flick (confirmed: it either fires
one coalesced native scroll or, via a smooth programmatic `goToIndex`,
fires many). Every fix here needs verifying against a real trackpad/mouse
flick, by a person, not just against what this tooling can show.

## None of this was found by reading the code

Each bug needed the lightbox open in a real browser with `javascript_exec`
reading live state - computed styles, `scrollLeft`, item counts, `data-*`
attributes - compared against what the math said it should be. "It looks
right" and "the position/spacer/transition math checks out against a live
measurement" are different claims; only the second one caught any of
these.
