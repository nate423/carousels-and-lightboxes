# Issues

One entry per problem, referenced by number (#4). Numbers are permanent: a new
issue takes the next one, and nothing is renumbered when an entry moves
section. Next number: **#16**.

Status is one of: **open**, **fix attempted** (a change went in, not yet
confirmed on a device), **parked** (known, deliberately not being worked on),
**done**. Newest attempt last. An entry moves to Done once it's confirmed on
the device it was reported on.

"The expand rewrite" below is a4c1425, which redrew the iOS-style look (iOS
scrubber and ramka strips) with translate and scale instead of custom
properties.

## Open

### #1 Items vanish near the screen edge while scrolling (iOS 27)
- **Status:** open - attempted fix preserved on `codex/vanishing-items-fix`, rolled back from `main` because of #15.
- **Where:** carousels whose items scale down, while scrolling natively. A follower drawn on its leader's timeline keeps its edge items until it is touched.
- **Seen:** an item disappears about where its full-size layout box would have left the screen, though its scaled and translated rendering is still visible.
- **Tried:** `isolation: isolate` (3522712) and the `?edge=` hints (09c5735) had no effect. The initial standalone single-transform experiment was reported working on-device.
- **A/C device comparison:** filmstrip in A (`b64029c`) links the carousels correctly, but items in the actively scrolled carousel disappear near the edges. C (`42be56b`) fixes that disappearance in filmstrip but introduces follower-position drift and a settling jump (#15). The improvement is real, but the shared rollout is not acceptable as-is.
- **Preserved attempt:** one explicit transform and one scroll timeline for scale-fade, plus changes to fade, expand, follower, overscroll, and flattening rendering. The initial isolated experiment changed much less than this rollout; the checkpoint notes preserve the distinction.
- **Baseline correction:** A (`b64029c`) already included Claude's `isolation: isolate` workaround (`3522712`) and opt-in CSS experiments (`09c5735`). Our attempt built on both. They have now also been removed from the active demos on `main`; this clean baseline is therefore different from test build A. The frozen `archive/proto-v1` remains a historical reference.
- **Next:** investigate the edge-culling fix independently on `codex/vanishing-items-fix`; preserve A's correct linked scrolling. No further fix attempted during wrap-up.

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

### #14 iOS scrubber carousel items appear late, then flash into view (iOS 27)
- **Status:** open - a fairly recent regression; introducing commit unknown. Investigation branch: `codex/ios-scrubber-late-appearance`.
- **Where:** the iOS scrubber's main carousel and, less reproducibly, its thumbnail carousel. Not observed in filmstrip.
- **Seen:** after scrolling to a position, items are missing for roughly a second, then appear abruptly.
- **A/C device comparison:** present in both A (`b64029c`, before this work) and C (`42be56b`, shared culling fix). The attempted culling fix did not resolve it; it must be investigated separately. A already has the bug and is not a known-good bisect endpoint for this issue.
- **Device isolation results on C:** disconnected but animated works; connected with `follow=direct` also works. This implicates the timeline-following path in this pairing, not timeline following generally: filmstrip works. Timeline following remains the intended implementation and the default.
- **Preserved diagnostics:** `late=baseline`, `late=unlinked`, `late=plain`, `late=main-scale`, and `late=strip-scale`, with `seed=14`, are saved on `codex/vanishing-items-fix`. The two effect-swap modes force timeline following; no device result was reported for those modes. They are not installed on the restored baseline.
- **Next:** find an earlier known-good revision and identify the introducing commit before attempting another fix. Do not assume a shared cause with #1.

### #15 Filmstrip follower overshoots during scrolling, then jumps into place
- **Status:** open on the attempted-fix branch; removed from `main` by restoring A's implementation.
- **Introduced by:** the shared culling-fix rollout, `42be56b` (C). A (`b64029c`) links correctly.
- **Seen:** starting at the beginning and scrolling rightward on the main carousel, the thumbnail follower does not track the correct position. The user reports what appears to be consistent overshoot or insufficient item translation. When the main carousel settles, the thumbnail carousel instantly jumps to the correct position.
- **Tradeoff:** C fixes filmstrip's edge disappearance (#1), but adds this regression. Do not treat C as a complete fix.
- **Hypothesis (unverified):** the timeline-drawn follower's transform/scroll-error composition or interpolation differs from the real scroll position applied at rest. The abrupt correction suggests checking that handoff and the live transform math; it does not establish the cause or even the precise direction of the error. No fix attempted.

## Investigation branches and checkpoint

- `main`: A's implementation with both earlier edge-culling workarounds removed from the active demos as well. Unrelated carousel changes and these issue notes are retained. Rollbacks are new commits; history has not been rewritten.
- `codex/vanishing-items-fix`: preserves the full progression: Claude's `3522712` isolation attempt → `09c5735` CSS experiments → our `42be56b` shared-transform attempt → `e6e3a29` diagnostics, source snapshots, and final device findings. These are original commits in its ancestry, not a squashed replacement.
- `codex/ios-scrubber-late-appearance`: starts from the cleaned baseline (including removal of Claude's earlier active workarounds) and updated issue notes, ready for a separate regression investigation.
- Checkpoint details: `investigation/2026-09-23-culling/README.md` on `codex/vanishing-items-fix`. Includes archived A/B/C sources and the diagnostic patch. Existing local copies may remain while working on `main`.

## Parked

### #10 ramka's slides keep every photo mounted
- `preload={items.length}` (dd04e1a) fixed scrubbing hitches by holding all 12 photos decoded. Fine for a demo, won't scale. Ideas: hold ramka's mount window still while scrubbing, or decode ahead in the direction of travel.

### #11 Fade look sits 0.5px off at rest after being driven
- fade.js never writes `--scroll-error`, so a driven fade carousel keeps its scroll position's rounding. Invisible in practice.

### #12 Error on archive/proto-v1 in WebKit 17.4
- "Advanced beyond the end", from the archive's own polyfill copy. Nothing in `shared/` involved.

## Temporary scaffolding to remove

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
