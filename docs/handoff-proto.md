# Handoff prototype

Tracked in #42.

## Context

Written on Friday, Sep 25, 2026, during the architecture review described
in [architecture.md](architecture.md). The review found that the hardest
problems of the previous ten days were handoffs: moments where an item
passes from one thing drawing it to another, each fixed separately.

Three comparisons shaped this plan:

- **View transitions** move between two frozen snapshots, which is why
  they can't be interrupted
  ([WICG/view-transitions#157](https://github.com/WICG/view-transitions/issues/157)).
  Handing off a live element is the missing piece.
- **iOS's [Portal](https://github.com/Aeastr/Portal) library** carries live
  views between screens, the same idea on native.
- **A public debate that week (Sep 15–16)** over SwiftUI running
  animations in the app process rather than in Core Animation's render
  server (see [Kyle Macomber's thread](https://x.com/kylemacomber/status/2100029347419877794)). It showed
  the trade-off: animations off the main thread stay smooth when it's
  blocked, and animations beside the event handling can be interrupted and
  keep their velocity. This plan aims for both.

We agreed to prove the model on its own page before refactoring any
carousel onto it.

## Plan

A standalone page that proves the handoff model in
[architecture.md](architecture.md) before any carousel is refactored onto
it. It imports nothing from `shared/`.

## Question

Can one live element be handed between presenters at any moment, in either
direction, with no jump in position or velocity, while staying smooth when
the main thread is blocked?

## Setup

One item, moving along one axis, and three presenters that can draw it:

1. **Its own scroller.** The item sits in a native scroll container and
   moves with native momentum and snap.
2. **Another scroller's timeline.** A second scroller leads; the item is
   drawn by an animation on that scroller's scroll timeline.
3. **A spring.** A drag on the item, then release. The spring starts at the
   release velocity. Script computes its whole path and runs it on the
   compositor as one animation with `linear()` easing.

Every handoff between two presenters, in both directions, can be triggered
by input at any moment: touching the item mid-spring, scrolling either
scroller mid-spring, dragging mid-momentum.

## Parts

- **Presentation model.** Pure functions giving the item's position and
  velocity at a given time for whichever presenter is active: scroll
  position mapped through progress, or the spring's equation. Never read
  back from the DOM.
- **Presenter state.** One value saying who draws the item now, and one
  handoff function: compute the current state, write the next presenter's
  starting state, switch, and keep the old presenter drawing until the new
  one's animation is ready.
- **Spring compiler.** Spring parameters, start position and velocity in; a
  sampled `linear()` easing and duration out. Retargeting mid-flight starts
  a new spring from the computed state. Nothing waits on a spring's
  duration: any input replaces it immediately.
- **Block button.** Stalls the main thread for 500ms, to show which motion
  keeps running and which waits.
- **Handover log.** The on-screen `?log` from the carousel pages, recording
  each handoff with the position and velocity on each side.

## Checks

A headless harness, built on `dev/headless/`, samples the item every frame
and asserts:

- **Position continuity:** no step at a handoff larger than the motion's
  own per-frame movement.
- **Velocity continuity:** velocity after a handoff within a small
  tolerance of velocity before it.
- **Readiness gap:** no frame where neither presenter draws the item.

Headless sampling sees the main thread's values, not the compositor's, so
device testing stays the final check.

## Open questions it answers

- Does replacing an animation's timeline (scroll timeline to document
  timeline) keep its progress, and can that run on the compositor?
- Do `composite: "add"` animations stay on the compositor, in Chrome and in
  WebKit?
- How late is an interruption heard while the main thread is blocked, and
  what does the item do in that gap?
- How many frames does `animation.ready` cost at a handoff, per engine?

## Passes when

On iOS 26/27 and desktop Chrome:

- a released spring stays smooth through a 500ms block;
- interrupting it at any moment continues with no visible jump in position
  or speed;
- every handoff between the three presenters passes the checks above.

iOS 18 and Safari 17 (the polyfill) are out of scope.

## Out of scope

Carousels, effects, linking logic, multiple items. Those come after, onto
whatever this proves.
