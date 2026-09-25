# Architecture: where we are, where we're going

## Context

Written on Friday, Sep 25, 2026, from an architecture review. Over the
previous ten days (about 145 commits since Sep 16) we had fixed the linked
carousels one problem at a time: flicker, lag, handovers between carousels,
and frame rate on the scroll-timeline polyfill (#1–#39). That Friday we
stepped back to review everything we'd built, how it got here, and whether
it can carry what's planned next.

What prompted it:

- #32 and #19, which both ask whether we animate too many things at once.
- Shortcuts that won't scale, like keeping every photo mounted (#10).
- Planned work the current design wasn't built for: card stacks,
  slot-machine wheels, editable items that change size, and collections of
  hundreds or thousands of items.

The review was a conversation, and several ideas here changed during it.
Laying scale-fade out at its non-current size was proposed and dropped
(#41). Decoupling the scroller from the visuals was weighed against how
messy interaction gets when a separate scroller sits over or under
interactive content, which led to the sticky visual layer (#46).

## The goal

Interfaces that feel like an extension of the mind: every response instant,
every motion interruptible, never a dropped frame. Carousels and lightboxes
are the first cases. The same core should carry card stacks, slot-machine
wheels, editable items, and collections of thousands of items.

The core is not one component for every use case. It is a small set of
general parts that each look and each page composes.

## What we have

- **Native scrollers.** Every carousel is a real scroll container with
  native momentum, snap and rubber-banding.
- **Looks as scroll-driven animations.** Each look (scale-fade, fade,
  expand) generates keyframes that the browser runs on the carousel's own
  scroll timeline, on the compositor.
- **Exact keyframes.** Every look is linear in progress between whole
  items, so keyframes at each item's anchor draw it exactly, not
  approximately.
- **Linked carousels.** Whichever carousel is moving for its own reasons
  leads. That is decided from scroll events, since input events can't say
  which scroller the browser is moving. The follower is drawn on the
  leader's scroll timeline, with no script between the finger and the
  follower.
- **A few firm rules.** No look changes an item's layout box. Geometry is
  measured once per layout change, not per frame. Progress math is pure
  functions (`carousel-math.js`).

## The diagnosis

The hard part is not scaling, translating or scrolling. It is handing an
item between the different things that draw it, without a visible seam.

A strip thumbnail today can be drawn by any of:

1. its own scroll-timeline animation;
2. an animation on the other carousel's scroll timeline, while following;
3. an `!important` inline style written from script (driven past an end, or
   a frame where a timeline is behind);
4. time-based animations for flattening, plus a hold animation under them.

Which one shows in a given frame falls out of the CSS cascade, animation
stacking order, `animation.ready` promises and double-rAF waits. The state
that governs it is about twenty flags across five modules. Many fixes since
Sep 21 are about one frame during one of these handoffs (#3, #5, #22, #24,
#27 among them).

### Measurements

iOS scrubber page, 30 items, desktop Chrome:

| | Animations | Keyframes |
|---|---|---|
| At rest | 120 | 360 |
| Main carousel dragged, strip following | 210 | 3,240 |

While the strip follows, each thumbnail's outer edge carries the strip's
whole follow distance (about 850px) in its own animation. The look's own
movement is about ±12px. Thirty separate animations must agree every frame
on motion they all share. That is the leading suspect for #32.

How keyframe counts grow:

- **expand:** O(n). One shared `@keyframes`, a per-item range.
- **scale-fade:** O(n²). Gap compensation makes each item's shift depend on
  every item between it and the center, so each item gets n + 2 keyframes.
- **Following on a timeline, any look:** O(n × m), one keyframe per item
  per leader item.

At 1,000 items, scale-fade alone is about a million keyframes. Most of
them describe items at positions where they're off screen.

## Principles

1. **Motion shared by every item goes on one element.** A carousel-wide
   offset (follow distance, scroll error) is one animation on a track that
   wraps the items. Items carry only their own look. Items can then never
   drift apart, since there is only one copy of the shared motion. The look
   itself (an item growing, its neighbors moving over) differs per item and
   stays on each item.
2. **An item only needs keyframes where it's on screen.** Each item's
   keyframes cover the positions where it's visible, plus a margin, and it
   holds an unseen value elsewhere. This works for any look, and keyframes
   grow with (items × items visible at once). It is the first step toward
   virtualization: an item with no keyframes outside its window can also
   have no content there, and a resize only redoes the items whose windows
   include it. A look that depends only on an item's distance from the
   current one, `u = i - progress`, can go further and share one set of
   keyframes across items, but only when every item is the same size (the
   expand strip).
3. **An animation runs where its interrupter lives.** While a native
   scroller is the input, motion belongs on the compositor (scroll
   timelines). While script is the input (a drag, a tap, a released
   spring), motion belongs with script, or is compiled by script into a
   compositor animation that script can replace at any moment.
4. **What's on screen is computed, never read back.** The browser can't
   report what the compositor is showing. Every look is a pure function of
   progress and every time-based animation has a known curve, so JS can
   always compute the on-screen position and velocity. Every handoff starts
   from that.
5. **Handoffs are atomic within a frame.** Write the new state before
   switching who draws; keep the old drawer until the new one is ready.
   Implemented once, not per look.
6. **Springs keep velocity.** Interrupting or retargeting a motion carries
   its current velocity into the next one.

## Direction

- **Progress is the model.** A carousel's state is its progress. Scrollers
  are input devices that produce it; looks are views of it.
- **Progress sources.** A scroll timeline, a finger, and a spring over time
  all produce progress. What draws an item doesn't care which one it is on,
  and can switch mid-motion with position and velocity carried over.
- **Presenters.** At any moment one presenter draws an item: its own
  scroller, another scroller's timeline, script, or a time-based animation.
  "Who presents this now" is one explicit state per carousel, with handoffs
  between presenters implemented once (principle 5).
- **Deterministic between events.** Once a spring is released, its path is
  fixed until the next input. So script can compile the whole path into a
  compositor animation (`linear()` easing). It stays smooth while the main
  thread is busy, and on interruption script computes the exact state from
  the spring's equation and launches the next one.
- **Looks as data.** A look declares its parts (the elements it draws on)
  and a pure `frame(u, strength)`. One compiler turns that into
  keyframes for its own timeline, animations on another carousel's
  timeline, a script painter, and time-based transitions.
- **One item, many presentations.** Thumbnail *i* and slide *i* are the
  same item shown twice. A lightbox opening, or a card lifting out of a
  stack to be edited, is one live item moving between presentations. The
  item stays live the whole time: an item mid-edit can't be a snapshot.
  `moveBefore()` moves a node without resetting its state, and the top
  layer gives an overlay above every view.
- **Geometry as a model.** Item sizes live in an array with prefix sums,
  and the DOM follows it. Virtualize item contents and animations, and keep
  every slot: empty, sized slots are cheap, and keep native snap and scroll
  length correct.
- **Slots and a sticky visual layer.** For looks whose items overlap, the
  scroller holds only empty slots, and the visuals sit in one layer inside
  the same scroller, held in place with `position: sticky`. The slots give
  native momentum and snap and set the scroll distance per item; the layer
  lays items out freely. Because the visuals stay inside the scroller, a
  touch on them still pans it and a text field in an item still works
  natively. Whether the layer rubber-bands on iOS is untested (#46).

### Looks this should carry

- **Card stack (iMessage-style):** each card's look depends on its distance
  from the top card, with a cap on how many show behind it. Cards overlap,
  so it needs the sticky visual layer. A JS version of this stack
  (abjt.dev/lab/card-stack) computes each card's transform on scroll.
- **Cover flow:** each item's look depends on its distance from the
  current one.
- **Slot-machine wheel:** items placed statically around a drum; only the
  drum rotates. One animated element. `rotateX` is linear in progress, so
  keyframes at item anchors stay exact.

## Decisions

- **DOM and compositor animations are the main renderer**, with one script
  painter as the fallback. The bottleneck is keeping input and drawing in
  step, not rendering or compute; the GPU already draws these layers.
- **No canvas, WebGPU or WASM for the core.** Drawing in rAF puts every
  view a frame behind native scrolling, and gives up DOM text, editing,
  accessibility, and the React integration.
- **The scroll-timeline polyfill doesn't draw looks.** Where it loads, the
  script painter draws them in one rAF loop.

## Known platform limits

- The compositor's current state can't be read from script.
- iOS runs scroll momentum outside the page, and sends no touch events for
  a finger landing on a scroller that is still moving.
- A native scroller's motion can't be given a custom curve or retargeted.
- A new animation can take a frame to start drawing (`animation.ready`).
- Noticing an interruption needs the main thread. If it's blocked, a finger
  on a moving item is heard late.

## Parked

- **Linking more than two carousels.** One shared progress with a single
  elected leader, in place of pairwise links.
- **WebGL for a single item's content**, where an effect needs shaders.
- **HTML-in-canvas** (Chromium only, origin trial from Chrome 148). It draws
  in a `paint` event on the main thread, so scroll timelines can't drive it.
  Worth revisiting if its proposed threaded mode ships.
- **Spec proposals.** If the prototype needs primitives the web lacks
  (reading compositor state, interruptible view transitions,
  WICG/view-transitions#157), it is the evidence for proposing them.

## Plan

1. Test #32's suspect: fast-drag the strip itself, then the main carousel.
2. Move shared motion onto a track element (#40).
3. Give each item keyframes only where it's on screen (#41).
4. Alongside: the handoff prototype (#42, see
   [handoff-proto.md](handoff-proto.md)) and the sticky visual layer
   proof of concept (#46).
5. After those: looks as data with one compiler and explicit presenter
   state (#43); then virtualization and dynamic sizes (#44).

Polyfill drawing: see #19.

The new terms here (presenter, progress source) feed into #35's renaming.
