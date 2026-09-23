// The carousel engine every page here builds on. Knows nothing about page
// dots, thumbnail scrubbers, or what an item contains - callers supply item
// content via `createItem`, and attach whatever navigation UI they want (or
// none) by reading the returned controller's progress and calling its seek
// methods.
//
// The stateful pieces below - scroll attribution, snap suspension, geometry
// caching, spacers, item population - each live in their
// own module under engine/, self-contained apart from the accessors
// (getItems, getNoncurrentScale, ...) and callbacks this file wires
// between them. This file is the orchestrator: it owns nothing but the glue
// - the event listeners, the ctx bundle effects read, and the public API -
// and the seams between the pieces are exactly the places where two of them
// have to agree, which is also where the comments explaining *why* now live.
// The pure math they all build on was already factored out to
// carousel-math.js.
import { computeScrollTarget, computeScrollAnchorForProgress, computeCurrentIndex } from "./carousel-math.js";
import { rafThrottle } from "./engine/raf-throttle.js";
import { createScrollAttribution } from "./linked-scrolling/scroll-attribution.js";
import { createSnapSuspension } from "./linked-scrolling/snap-suspension.js";
import { createTimelineFollow } from "./linked-scrolling/timeline-follow.js";
import { createGeometryCache } from "./engine/geometry-cache.js";
import { createSpacers } from "./engine/spacers.js";
import { onScrollEnd } from "./engine/scroll-end.js";
import { trackPress } from "./engine/press.js";
import { populateItems as populateItemsInto } from "./engine/populate-items.js";

export { rafThrottle };

// Marked on the document by scroll-timeline-loader.js, which runs before any
// module does, when it loads the polyfill.
const usingScrollTimelinePolyfill = document.documentElement.hasAttribute("data-scroll-timeline-polyfill");

export function createCarousel(wrapper, options = {}) {
  const {
    itemCount = 30,
    effect,
    createItem,
    itemSizing
  } = options;

  function getNoncurrentScale() {
    return parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-scale"));
  }

  function getItems() {
    return wrapper.querySelectorAll(".carousel-item");
  }

  // snap-suspension has no dependents, so it can be built first; attribution
  // reclaims it (onSelfReclaim) the instant real input takes the carousel
  // back from a drive - see linked-scrolling/ for
  // why that instant, rather than the suspension's own timer, is what has to
  // hand snap back.
  const snap = createSnapSuspension(wrapper);
  const attribution = createScrollAttribution(wrapper, { onSelfReclaim: reclaim });
  const geometry = createGeometryCache({ wrapper, getItems });
  const spacers = createSpacers(wrapper, { getItems });
  const press = trackPress(wrapper);

  // Whoever is watching this carousel move - today, the iOS strip, which
  // flattens its thumbnails while you are dragging it and lets them grow
  // again once you let go. The engine has no opinion on what a page does
  // with this; it only knows which of leading/following/idle it is in.
  //
  // Fired from the unthrottled scroll listener below rather than the
  // rAF-throttled one, so a gesture registers on its first scroll event
  // rather than a frame into it, and only on an actual change, since a
  // listener will typically write an attribute and rewriting an unchanged
  // one still invalidates style for the whole subtree.
  const motionListeners = new Set();
  let lastMotionState = attribution.getMotionState();

  function notifyMotion() {
    const state = attribution.getMotionState();
    if (state === lastMotionState) return;
    lastMotionState = state;
    motionListeners.forEach((listener) => listener(state));
  }

  // effect.apply reads state that effect.setup builds, so nothing may call
  // it before the first setup below has run.
  let ready = false;

  // Both call sites are ends of motion, where the rAF-throttled render below
  // still has the previous frame's position pending and no further scroll is
  // coming to flush it.
  function applyIfReady() {
    if (ready) effect.apply(ctx);
  }

  // At most one render per frame, however many scroll events and direct
  // writes land in it. The render only writes styles, which the frame reads
  // after its animation callbacks, so deferring it to one costs nothing.
  const applyThisFrame = rafThrottle(() => effect.apply(ctx));

  // Every path that can move an item - init, resize, an item resizing
  // itself, an alignment change - goes through here, so invalidating the
  // geometry cache on its way through covers all of them at once and cannot
  // be forgotten at a new call site.
  function updateSpacers() {
    spacers.update();
    geometry.invalidate();
  }

  // Scroll offset that puts the given item's anchor point at the wrapper's
  // anchor point. Shared by click-to-scroll and any external seek (e.g. a
  // page-dot click).
  function goToIndex(index, { behavior = "smooth" } = {}) {
    const items = getItems();
    const item = items[index];
    if (!item) return;

    // An explicit command to this carousel, not an echo of something driving
    // it, so the scrolling it is about to do counts as this carousel moving
    // for its own reasons and propagates through a link. It scrolls from
    // wherever it is showing, so a carousel following on a timeline is put
    // back on its own scroll first.
    reclaim();
    attribution.noteSelfCommand();

    const scrollTarget = computeScrollTarget(wrapper, item);

    wrapper.scrollTo({ left: scrollTarget, behavior });
  }

  // Manually takes over the scroll position to match an externally-driven
  // currentProgress (e.g. another carousel's live scroll) - a direct write,
  // not wrapper.scrollTo(), since the source progress is itself
  // continuously changing during a live scroll/drag and native smooth-scroll
  // only makes sense against a fixed destination. See linked-scrolling/link.js.
  function setProgressDirect(progress) {
    attribution.noteDirectWrite(progress);
    notifyMotion();
    snap.suspend();
    writeScroll(progress);

    // Render this frame rather than waiting for the scroll event this write
    // usually causes, because it does not always cause one: a scroll position
    // is quantised to whole pixels, so when a short scroller is driven by a
    // much longer one most frames resolve to the pixel it is already on, emit
    // nothing, and would otherwise hold the previous frame's render. That is
    // what makes a slow drag on the driver look like it steps rather than
    // glides. Effects are free to re-run - they compute from current state
    // rather than accumulating - so the echo, when it does arrive, is harmless.
    applyThisFrame();
  }

  function writeScroll(progress) {
    const { anchors, wrapperAnchorPoint } = geometry.get();
    wrapper.scrollLeft = computeScrollAnchorForProgress(anchors, progress) - wrapperAnchorPoint;

    // The polyfill advances this wrapper's timelines only from a scroll event
    // on it, and the one this write causes is not dispatched until the next
    // frame - a frame in which the new position would be painted with the old
    // look. Dispatching one now has it catch up in the same frame the write
    // lands in, as a native timeline does. Every listener of this engine's
    // own skips events that aren't trusted, so only the polyfill hears it.
    if (usingScrollTimelinePolyfill) wrapper.dispatchEvent(new Event("scroll"));
  }

  // Follows `leader` continuously: this carousel shows the leader's live
  // progress, called on every scroll of the leader (see
  // linked-scrolling/link.js).
  //
  // Shown on the leader's own scroll timeline wherever it can be (see
  // linked-scrolling/timeline-follow.js), and by writing this carousel's
  // scroll position wherever it can't: while a finger or pointer is down on
  // it, while it is still moving for its own reasons, and while the leader
  // is past either end of its range. The first two are the ones that matter.
  // The browser pans a scroller from its real scroll position, often
  // without the page hearing about it first, so a carousel anyone could be
  // about to drag must really be where it looks - which a written scroll
  // position is, every frame, and a timeline standing in for one is not.
  //
  // Whichever way it is showing, the switch to the other writes the real
  // scroll position to the progress being shown first, so the frame the
  // switch lands in looks the same as the one before it.
  function follow(leader) {
    const progress = leader.getCurrentProgress();
    const onTimeline = timelineFollow.leader();

    if (press.isPressed() || attribution.isMovingItself() || !timelineFollow.canShow(leader)) {
      setProgressDirect(progress);
      timelineFollow.stop();
      return;
    }

    if (onTimeline !== leader) {
      // Written first, so the frame that shows the timeline's first frame
      // already looks the same underneath it, and so the error it folds in
      // is measured from where this carousel really is.
      setProgressDirect(progress);
      timelineFollow.stop();
      snap.hold();
      timelineFollow.show(leader);
    } else {
      // Nothing to write, but still the progress this carousel is being
      // driven to, for anything that asks.
      attribution.noteDirectWrite(progress);
      notifyMotion();
    }

    ctx.onProgress?.(computeCurrentIndex(progress, geometry.get().items.length), progress);
  }

  // Off the leader's timeline and back onto a real scroll position that
  // shows what the timeline was showing, handing snap back with it. Called
  // the instant real input lands on this carousel, or a command is given to
  // it - whatever happens next has to start from where it really is.
  function reclaim() {
    const leader = timelineFollow.leader();
    if (leader) {
      writeScroll(leader.getCurrentProgress());
      timelineFollow.stop();
      applyThisFrame();
    }
    snap.restore();
  }

  function populateItems() {
    populateItemsInto(wrapper, spacers.lastSpacer, {
      itemCount,
      effect,
      createItem,
      itemSizing,
      onItemClick: (index) => goToIndex(index, { behavior: "smooth" })
    });
    updateSpacers();
  }

  // ctx bundles everything an effect module needs to read geometry and
  // report progress for this one wrapper. onProgress starts unset - a
  // navigator (page-controls, etc) attaches itself via setOnProgress after
  // createCarousel returns.
  const ctx = {
    wrapper,
    getNoncurrentScale,
    getScrollSource: attribution.getScrollSource,
    getMotionState: attribution.getMotionState,
    getDrivenProgress: attribution.getDrivenProgress,
    // Shared rather than measured per effect - see geometry-cache.js.
    // Effects that keep their own copy predate this and are not wrong to;
    // what they must not do is read it fresh every frame.
    getGeometry: geometry.get,
    currentScrollAnchor: geometry.currentScrollAnchor,
    onProgress: undefined
  };

  const timelineFollow = createTimelineFollow({ effect, ctx });

  // Snap stays off until the spacers have their real size. Sizing them means
  // measuring the items, and that measurement forces a layout in which the
  // spacers are still zero-width - where every item centred left of the
  // wrapper's midpoint clamps to the same snap offset, 0. WebKit latches one
  // of those as the item it is snapped to and, once the spacers grow, scrolls
  // to keep that item centred, so the carousel loads a few items in rather
  // than on the first one. With snap off through that layout there is nothing
  // to latch, and snap comes back on a layout where 0 belongs to the first
  // item alone.
  snap.suspend();
  populateItems();
  effect.setup(ctx);
  effect.apply(ctx);
  snap.restore();
  ready = true;

  const scrollListeners = new Set();
  const scrollEndListeners = new Set();

  // Subscribers hear a scroll in the event itself rather than a frame later,
  // because a link writes another carousel's position from here, and that
  // write has to land before the frame samples the other carousel's
  // scroll-driven animations. The browser samples them after dispatching
  // scroll events but before running animation frame callbacks; a write from
  // a callback is painted at its new position with the look its old position
  // gave it, and only catches up a frame later - which reads as a follower
  // lagging a frame behind, and as an item jumped to arriving collapsed and
  // then popping to full size.
  //
  // The effect's own render stays at one per frame (applyThisFrame), since
  // it only writes styles, which nothing reads until after those callbacks.
  //
  // `source` is sampled once rather than per listener: it can only change on
  // a real input event, which can't interleave with this synchronous loop.
  // Untrusted scroll events are setProgressDirect's nudge to the polyfill,
  // not scrolling.
  wrapper.addEventListener("scroll", (event) => {
    if (!event.isTrusted) return;
    attribution.noteScrollEvent();
    // A timeline draws this carousel relative to where its real scroll
    // position sat when it took over, so anything else moving that position
    // leaves it drawing from the wrong place. Whatever this engine is asked
    // to do reclaims it first; this is for what it isn't asked - the browser
    // bringing a focused item into view, say - where the real scroll
    // position is the truer of the two.
    if (timelineFollow.leader() && wrapper.scrollLeft !== timelineFollow.scrollLeftShownFrom()) {
      timelineFollow.stop();
      snap.restore();
    }
    notifyMotion();
    const source = attribution.getScrollSource();
    scrollListeners.forEach((listener) => listener({ source }));
    applyThisFrame();
  });

  // 'scrollend' fires once a scroll operation - gesture, momentum and any snap
  // correction together - is over, which is what bounds a stretch of movement.
  // onScrollEnd stands in for it where the browser doesn't have it.
  //
  // This is where a gesture's final position becomes final, and the apply
  // above is rAF-throttled, so the last scroll event's render is still
  // pending when this fires. Rendering once more here is what guarantees the
  // look ends up drawing the position the carousel actually came to rest at.
  //
  // Only ends *this* carousel's own leading motion, not driven motion - see
  // endFollowing below for why the driven side can't trust its own
  // 'scrollend'. scrollEndListeners only fire on a real leading gesture
  // ending (wasLeading), so a spurious/early scrollend while merely being
  // driven, or one with no motion behind it at all, never gets relayed as if
  // it were the authoritative "the gesture is over" signal.
  onScrollEnd(wrapper, () => {
    const wasLeading = attribution.endLeading();
    notifyMotion();
    applyIfReady();
    if (wasLeading) {
      scrollEndListeners.forEach((listener) => listener());
    }
  });

  // Shared by both triggers below so a resize that also changes an item's
  // own size (e.g. dragging the window while an image is still loading)
  // coalesces into one refresh per frame instead of two.
  const refreshGeometry = rafThrottle(() => {
    // The timeline's keyframes were laid out against the old geometry.
    const leader = timelineFollow.leader();
    if (leader) {
      setProgressDirect(leader.getCurrentProgress());
      timelineFollow.stop();
    }
    updateSpacers();
    effect.setup(ctx);
    effect.apply(ctx);
  });

  window.addEventListener("resize", refreshGeometry);

  // Recovers from an item's size changing for reasons outside this module's
  // own control (e.g. a placeholder image finishing its load mid-scroll).
  // Effects that resize items themselves as their normal scroll-driven
  // behavior (see the iOS scrubber's look.js) opt out via
  // effect.skipItemResizeObserver - without that, every write the effect
  // makes would itself be observed here as "an item's size changed
  // unexpectedly", re-triggering refreshGeometry (and so effect.apply
  // again) on the very next frame regardless of whether the wrapper's own
  // scroll actually moved - a self-sustaining cascade of redundant,
  // slightly-stale re-renders that reads as items flickering their
  // position.
  if (!effect.skipItemResizeObserver) {
    const itemResizeObserver = new ResizeObserver(refreshGeometry);
    getItems().forEach((item) => itemResizeObserver.observe(item));
  }

  // Ends "following", called by the link once the carousel actually driving
  // this one reports that *its* gesture is over - see onScrollEnd below and
  // linked-scrolling/link.js.
  //
  // A carousel following on the leader's timeline stays on it: at rest it
  // shows exactly what its own scroll position would, and it is ready for
  // the leader's next gesture. Anything that needs its real scroll position
  // reclaims it for itself (see reclaim above).
  function endFollowing() {
    if (!attribution.endFollowing()) return;
    notifyMotion();
    applyIfReady();
  }

  return {
    wrapper,
    getItems,
    goToIndex,
    // While following on a timeline, the progress being shown is the
    // leader's, not what this carousel's own scroll position says.
    getCurrentProgress: () => timelineFollow.leader()?.getCurrentProgress() ?? geometry.getCurrentProgress(),
    getProgressKnots: geometry.getProgressKnots,
    setProgressDirect,
    follow,
    getScrollSource: attribution.getScrollSource,
    getMotionState: attribution.getMotionState,
    // Notified whenever this carousel changes between leading, following and
    // idle. Returns an unsubscribe function.
    onMotionChange(listener) {
      motionListeners.add(listener);
      return () => motionListeners.delete(listener);
    },
    isMovingItself: attribution.isMovingItself,
    selfScrollStartedAt: attribution.selfScrollStartedAt,
    // Notified on every scroll event, synchronously, with the attribution of
    // that scroll - see linked-scrolling/scroll-attribution.js.
    // Returns an unsubscribe function.
    onScroll(listener) {
      scrollListeners.add(listener);
      return () => scrollListeners.delete(listener);
    },
    // Notified when this carousel's own gesture - the kind that sets
    // isMovingItself, not one driven onto it - actually ends. The reliable
    // end-of-motion signal a link forwards to whatever this carousel is
    // driving; see endFollowing. Returns an unsubscribe function.
    onScrollEnd(listener) {
      scrollEndListeners.add(listener);
      return () => scrollEndListeners.delete(listener);
    },
    endFollowing,
    setOnProgress(onProgress) {
      ctx.onProgress = onProgress;
    },
    effect
  };
}
