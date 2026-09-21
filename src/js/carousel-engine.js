// Generalized carousel engine, extracted out of what used to be main.js's
// setupCarousel/populateCarousel/updateSpacers/setAlignment. Knows nothing
// about page dots, thumbnail scrubbers, or demo-page concerns like
// placeholder boxes vs. images - callers supply item content via
// `createItem`, and attach whatever navigation UI they want (or none) by
// reading the returned controller's progress and calling its seek methods.
import {
  alignmentFraction,
  getItemMetrics,
  computeScrollTarget,
  computeSpacerSize,
  computeCurrentProgress,
  computeCurrentIndex,
  computeScrollAnchorForProgress,
  wrapperAnchor
} from "./carousel-math.js";

const DEFAULT_ALIGNMENT = "center";

// Which motion states, if any, this carousel drops its contrast in - the
// four-way choice spelled as the two independent bits it actually is.
// "Contrast" here means whatever a look does to distinguish the current item
// from the rest; the engine has no opinion on what that is, only on when it
// should be showing. Dropping it while leading is the iOS filmstrip's
// behavior: the thumbnails flatten out under your finger and the one you
// land on grows once you let go.
const CONTRAST_REMOVAL = {
  never: { leading: false, following: false },
  leading: { leading: true, following: false },
  following: { leading: false, following: true },
  always: { leading: true, following: true }
};
// ms of no further direct writes before scroll-snap is handed back - see
// suspendScrollSnap below.
const SNAP_RESTORE_DELAY = 150;

// Native `scroll` can fire more than once per animation frame (trackpads in
// particular), and both `resize` and ResizeObserver behave the same way
// during a live window drag - fired on close to every frame, not just once
// it settles. effect.apply() reads item.offsetLeft/offsetWidth
// (getItemMetrics) and then writes styles at the end - fine within one call,
// but if a second event lands before the browser's next natural layout
// pass, its read runs right after the previous call's write, forcing a
// synchronous layout recalc instead of a cheap cached read. Collapsing
// same-frame events down to one rAF-scheduled call guarantees the read
// always happens after the browser's own layout pass.
export function rafThrottle(fn) {
  let scheduled = false;
  return (...args) => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn(...args);
    });
  };
}

function defaultCreateItem(item, index) {
  item.textContent = `Item ${index}`;
}

// The ratio an itemSizing derives its main-axis size from: the source
// media's own, which varies per item, or one authored ratio shared by every
// item. "origin" is a callback rather than a list of ratios because what
// counts as the origin is the caller's business - today every carousel that
// asks for it reads the rendered size of another carousel's items, which
// are the same thing as the source media; once there is real media with its
// own intrinsic resolution the two come apart, and only the callback has to
// change.
function aspectFor(size, index) {
  return typeof size.origin === "function" ? size.origin(index) : size.aspect;
}

export function createCarousel(wrapper, options = {}) {
  const {
    itemCount = 30,
    effect,
    createItem = defaultCreateItem,
    itemSizing,
    removeContrastWhileScrolling = "never"
  } = options;

  wrapper.dataset.scrollAlignment ||= DEFAULT_ALIGNMENT;

  const scrollAxis = wrapper.getAttribute("data-scroll-axis") || "x";
  const scrollDistance = scrollAxis === "x" ? "scrollLeft" : "scrollTop";
  const offsetSize = scrollAxis === "x" ? "offsetWidth" : "offsetHeight";
  const offsetFromStart = scrollAxis === "x" ? "offsetLeft" : "offsetTop";
  const scrollSize = scrollAxis === "x" ? "scrollWidth" : "scrollHeight";

  // --- Scroll attribution -------------------------------------------------
  // Every scroll this wrapper emits is attributed to one of two sources, and
  // anything watching it - a link relaying it to another carousel, an effect
  // that renders differently depending on who is moving it (see
  // ios-scrubber-effect.js) - reads that attribution instead of trying to
  // reconstruct it from raw DOM events of its own.
  //
  //   "self"   - this carousel is moving for its own reasons: a real gesture
  //              on it, or a goToIndex/setAlignment command aimed at it.
  //              Authoritative motion, and the only kind worth relaying.
  //   "driven" - an outside driver is writing this carousel's scroll position
  //              directly through setProgressDirect. The scroll events that
  //              follow are echoes of that write, not new information.
  //
  // "driven" is a hard, sticky state rather than a timing window, because a
  // programmatic write's consequences have no bounded duration: the write
  // fires its own native 'scroll' event (the echo), and so does the
  // browser's scroll-snap "resnap" correction, which runs *asynchronously*
  // after snap is handed back and can itself animate for an unpredictable
  // stretch (observed up to ~1.8s) whenever the anchor we computed isn't
  // pixel-identical to the browser's own snap-point geometry. Neither can
  // happen without setProgressDirect having run first, so "has anything
  // moved this carousel for its own reasons since the last direct write" is
  // a complete, exact answer - no elapsed-time guess, and so no window that
  // might cut off a legitimate but slow-to-arrive correction.
  //
  // Event ordering makes the flip back to "self" safe even when real input
  // lands in the same batched frame as a pending echo: an input handler runs
  // synchronously as part of input dispatch, before the 'scroll' it causes is
  // ever queued, so the attribution is already correct by the time that
  // scroll event's own handler runs.
  let scrollSource = "self";

  // Whether this carousel is currently scrolling for its own reasons, and when
  // that stretch of movement began. Both are derived from real scroll events
  // rather than from input events, which is the only way to get this right:
  // the browser latches a wheel gesture to whichever scroller it started on,
  // but keeps dispatching the wheel events themselves to whatever is under the
  // cursor. Move the cursor to another carousel mid-flick and its wheel
  // handlers fire while the original scroller is the one actually moving, so
  // anything that reads input to decide who is in charge names the wrong one.
  let movingItself = false;
  let selfScrollStartedAt = 0;

  // The same question asked about the other source: whether a drive is
  // currently moving this carousel. Unlike movingItself it cannot be read off
  // scroll events alone, because a drive does not reliably produce one - a
  // scroll position is quantised, so when a short scroller is driven by a much
  // longer one most frames resolve to the pixel it is already on and emit
  // nothing (see the note in setProgressDirect). setProgressDirect therefore
  // sets this itself. That is sound where inferring a gesture from input
  // events would not be: a direct write is this module's own doing, not a
  // guess about which scroller the browser latched.
  let movingDriven = false;

  // The exact progress the last setProgressDirect was asked for. Worth keeping
  // because it cannot be recovered afterwards: writing it moves scrollLeft,
  // and a scroll position is quantised - WebKit reports whole pixels - so
  // reading it back returns a coarser value than went in. An effect rendering
  // a driven carousel should use this rather than measure the scroll position
  // it was just handed.
  let lastDrivenProgress = 0;

  // --- Motion state -------------------------------------------------------
  // Three states, and the distinction between them is what separates a
  // carousel that is merely *attributed* to a source from one that is
  // actually moving:
  //
  //   "leading"   - moving for its own reasons, right now.
  //   "following" - being moved by a driver, right now.
  //   "idle"      - at rest, whoever moved it last.
  //
  // getScrollSource answers a different question and both are worth having.
  // Attribution is deliberately sticky: it stays "driven" through the whole
  // unbounded tail of echoes and resnap corrections a direct write can
  // provoke, which is what makes it safe to suppress those. Motion is bounded
  // instead - by a real scroll event or a direct write on the way in, and on
  // the way out by 'scrollend' (this wrapper's own for leading, the driving
  // carousel's, relayed through endFollowing, for following - see there) -
  // so it can answer "is this thing moving" at an instant.
  //
  // Reading attribution as if it were motion is the trap: "self" is also what
  // a carousel at rest reports, so anything that treats it as "leading"
  // fires at page load, before a gesture has happened at all.
  function getMotionState() {
    if (movingItself) return "leading";
    if (movingDriven) return "following";
    return "idle";
  }

  // Ends "following", called by the link once the carousel actually driving
  // this one reports that *its* gesture is over - see onScrollEnd below and
  // carousel-link.js. Not driven by this wrapper's own 'scrollend': a driven
  // carousel's scroll position is quantised (setProgressDirect's note above),
  // so most frames of a slow drive leave it sitting on the same pixel for a
  // stretch well past what the browser treats as "no longer scrolling",
  // firing this wrapper's own scrollend while the carousel actually driving
  // it is still moving. The leader's scrollend has no such problem - it's
  // real, continuous scroll input - so it's the only reliable end-of-motion
  // signal for the side being driven.
  function endFollowing() {
    if (!movingDriven) return;
    movingDriven = false;
    updateContrast();
    applyIfReady();
  }

  // --- Contrast -----------------------------------------------------------
  // Published as an attribute rather than handed to the effect, so that a
  // look written entirely in CSS needs no JS of its own to honour the
  // policy - it just declares what data-contrast="off" means for it. The
  // engine decides *when*; the look decides *what*.
  //
  // There is no separate "settle" step and nothing to re-expand on. Coming
  // to rest is idle, and idle is not a state any policy removes contrast in,
  // so the attribute goes back on its own. The easing on the way back is the
  // look's business too - a CSS transition on whatever it derives from this.
  let contrastRemovalMode = removeContrastWhileScrolling in CONTRAST_REMOVAL ? removeContrastWhileScrolling : "never";
  let contrastRemoval = CONTRAST_REMOVAL[contrastRemovalMode];

  // Whether this carousel's contrast can ever change. A look may be able to
  // draw itself more cheaply when it cannot - see css-effect.js, which can
  // hand its whole look to the compositor in that case and cannot when a
  // multiplier has to be applied to it every frame.
  function usesContrast() {
    return contrastRemovalMode !== "never";
  }

  function updateContrast() {
    const motionState = getMotionState();
    const removed = motionState !== "idle" && contrastRemoval[motionState];
    const next = removed ? "off" : "on";
    // Only on a real change: this runs on every scroll event, and rewriting
    // an unchanged attribute still invalidates style for the whole subtree.
    if (wrapper.dataset.contrast === next) return false;
    wrapper.dataset.contrast = next;
    return true;
  }

  // A look painted in CSS redraws itself when the attribute changes; one
  // painted in JS only draws from apply(). Both places below are ones where
  // a JS look would otherwise be left holding a stale frame, since neither
  // is a scroll.
  function applyIfReady() {
    if (ready) effect.apply(ctx);
  }

  // effect.apply reads state that effect.setup builds, so nothing may call
  // it before the first setup below has run.
  let ready = false;

  function markSelfDriven() {
    scrollSource = "self";
    // Whatever a driver was doing to this carousel, it is not what is moving
    // it any more.
    movingDriven = false;
    // This carousel is the user's again, so any suspension left over from a
    // drive is finished - see restoreScrollSnap for why it can't be left to
    // expire on its own.
    restoreScrollSnap();
  }

  // touchmove/pointerdown cover fingers and scrollbar drags; keydown covers
  // arrow/page/home/end scrolling on browsers that make scrollers focusable.
  ["wheel", "touchmove", "pointerdown", "keydown"].forEach((type) =>
    wrapper.addEventListener(type, markSelfDriven, { passive: true })
  );

  // scroll-snap-type: mandatory (every carousel-engine wrapper has it) tries
  // to correct exactly what a direct write looks like to it: a scroll position
  // that isn't part of an active native gesture. Suspending it for the
  // duration of a drive keeps the browser's own resnap from fighting
  // setProgressDirect.
  //
  // Handing it back is timer-based only because a drive has no natural end
  // event - but the timer must never be what hands it back mid-gesture. Snap
  // returning while the browser still has the driven position latched makes it
  // resnap to that position rather than to wherever the gesture has since got
  // to, which reads as the carousel scrolling normally and then, up to a
  // second later, jumping back to where it started. restoreScrollSnap is
  // therefore also called the instant real input reclaims this carousel, while
  // the scroll position is still exactly on the anchor the last write put it
  // on, so re-enabling snap there corrects nothing.
  //
  // Both functions only write the style when it would actually change - a style
  // write followed by a geometry read (offsetLeft/offsetWidth, in
  // setProgressDirect right after) on the same element forces a synchronous
  // layout recalculation, and re-writing an unchanged value still re-arms it.
  let snapRestoreTimer = null;

  function suspendScrollSnap() {
    if (wrapper.style.scrollSnapType !== "none") {
      wrapper.style.scrollSnapType = "none";
    }
    clearTimeout(snapRestoreTimer);
    snapRestoreTimer = setTimeout(restoreScrollSnap, SNAP_RESTORE_DELAY);
  }

  function restoreScrollSnap() {
    clearTimeout(snapRestoreTimer);
    if (wrapper.style.scrollSnapType !== "") {
      wrapper.style.scrollSnapType = "";
    }
  }

  const scrollListeners = new Set();
  const scrollEndListeners = new Set();

  function getAlignment() {
    return wrapper.dataset.scrollAlignment || DEFAULT_ALIGNMENT;
  }

  function getAlignmentFraction() {
    return alignmentFraction(getAlignment());
  }

  function getScrollPadding() {
    return (
      parseFloat(
        getComputedStyle(wrapper).getPropertyValue("--carousel-scroll-padding")
      ) || 0
    );
  }

  function getNoncurrentScale() {
    return (
      parseFloat(getComputedStyle(wrapper).getPropertyValue("--noncurrent-scale")) || 1
    );
  }

  function getItems() {
    return wrapper.querySelectorAll(".carousel-item");
  }

  const firstSpacer = document.createElement("div");
  const lastSpacer = document.createElement("div");
  firstSpacer.classList.add("spacer");
  lastSpacer.classList.add("spacer");
  wrapper.prepend(firstSpacer);
  wrapper.append(lastSpacer);

  function updateSpacers() {
    const items = getItems();
    const [firstItem, lastItem] = [items[0], items[items.length - 1] || items[0]];
    const gapSize = parseFloat(getComputedStyle(wrapper).gap);
    const alignment = getAlignmentFraction();
    const scrollPadding = getScrollPadding();

    [firstSpacer, lastSpacer].forEach((spacer, index) => {
      // Each spacer only needs to make up the room on its own side of the
      // alignment point - see computeSpacerSize in carousel-math.js.
      const edgeFraction = index === 0 ? alignment : 1 - alignment;
      const item = index === 0 ? firstItem : lastItem;
      const size = Math.max(
        0,
        computeSpacerSize(
          wrapper[offsetSize],
          item[offsetSize],
          edgeFraction,
          gapSize,
          scrollPadding
        )
      );
      spacer.style[scrollAxis === "x" ? "width" : "height"] = size + "px";
    });

    // Every path that can move an item - init, resize, an item resizing
    // itself, an alignment change - resizes the spacers on its way through,
    // so invalidating here covers all of them at once and cannot be
    // forgotten at a new call site.
    geometry = null;
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
    // for its own reasons and propagates through a link.
    scrollSource = "self";

    const scrollTarget = computeScrollTarget(
      wrapper,
      item,
      offsetFromStart,
      offsetSize,
      getAlignmentFraction(),
      getScrollPadding()
    );

    wrapper.scrollTo({
      [scrollAxis === "x" ? "left" : "top"]: scrollTarget,
      behavior
    });
  }

  // --- Geometry ------------------------------------------------------------
  // Where every item's anchor point sits, and where the wrapper's own is.
  // Both are pure layout, and layout only moves on the events that already
  // rebuild it: the spacers being resized, which every one of those events
  // goes through. So this is computed once per such event rather than per
  // frame.
  //
  // What makes that safe is that no effect changes an item's border box.
  // They draw with transforms and with properties confined inside the box
  // (looks/ios-box-look.js is built around this and says why: letting an
  // item's box grow feeds the geometry back into the progress derived from
  // it). offsetLeft and offsetWidth therefore cannot move between rebuilds,
  // and an effect that did move them would opt out of its own correctness,
  // not just this cache's.
  //
  // Driving one carousel from another used to cost three full passes over
  // every item per frame - the leader's getCurrentProgress, the follower's
  // setProgressDirect, and the effect's own apply - each a querySelectorAll
  // and a layout read per item, to move a single scroll offset. Effects
  // that cached this themselves (js-effect, ios-box-look, settle-effect)
  // already avoided their share; this is the same idea where the engine
  // does it once for everyone, including the effects that did not.
  //
  // The scroll position is deliberately not part of it. That is the one
  // thing here that does change every frame, and it is a single read rather
  // than one per item.
  let geometry = null;

  function getGeometry() {
    if (geometry) return geometry;

    const items = getItems();
    const alignment = getAlignmentFraction();
    const scrollPadding = getScrollPadding();
    const { anchors, sizes } = getItemMetrics(
      wrapper,
      items,
      offsetFromStart,
      offsetSize,
      scrollDistance,
      alignment,
      scrollPadding
    );

    geometry = {
      items,
      anchors,
      sizes,
      alignment,
      wrapperAnchorPoint: wrapperAnchor(wrapper[offsetSize], alignment, scrollPadding)
    };
    return geometry;
  }

  function currentScrollAnchor() {
    return wrapper[scrollDistance] + getGeometry().wrapperAnchorPoint;
  }

  // Continuous (fractional) "which item is current" - see
  // computeCurrentProgress in carousel-math.js.
  function getCurrentProgress() {
    return computeCurrentProgress(getGeometry().anchors, currentScrollAnchor());
  }

  // Manually takes over the scroll position to match an externally-driven
  // currentProgress (e.g. another carousel's live scroll) - a direct write,
  // not wrapper.scrollTo(), since the source progress is itself
  // continuously changing during a live scroll/drag and native smooth-scroll
  // only makes sense against a fixed destination. See carousel-link.js.
  function setProgressDirect(progress) {
    scrollSource = "driven";
    movingDriven = true;
    updateContrast();
    lastDrivenProgress = progress;
    suspendScrollSnap();

    const { anchors, wrapperAnchorPoint } = getGeometry();
    wrapper[scrollDistance] = computeScrollAnchorForProgress(anchors, progress) - wrapperAnchorPoint;

    // Render here rather than waiting for the scroll event this write usually
    // causes, because it does not always cause one: a scroll position is
    // quantised to whole pixels, so when a short scroller is driven by a much
    // longer one most frames resolve to the pixel it is already on, emit
    // nothing, and would otherwise hold the previous frame's render. That is
    // what makes a slow drag on the driver look like it steps rather than
    // glides. Effects are free to re-run - they compute from current state
    // rather than accumulating - so the echo, when it does arrive, is harmless.
    effect.apply(ctx);
  }

  // Fixes an item's cross-axis size and derives its main-axis size from a
  // ratio - the shape both filmstrip navigators need, where thumbnails line
  // up along one axis at a constant thickness. A carousel that passes no
  // itemSizing at all is the other case entirely: its items are whatever
  // size their content makes them, on both axes, which is what every main
  // carousel here wants.
  //
  // Which axis is which comes from this wrapper's own scrollAxis, so a
  // vertical strip fixes its width and derives its height rather than
  // always fixing height as if every strip were horizontal.
  function applyItemSizing(item, index) {
    if (!itemSizing) return;

    const { crossSize, size } = itemSizing;
    const crossSide = scrollAxis === "x" ? "height" : "width";
    const mainSide = scrollAxis === "x" ? "width" : "height";

    let mainSize;
    if (typeof size === "number") {
      mainSize = size;
    } else {
      const aspect = aspectFor(size, index);
      mainSize = scrollAxis === "x" ? crossSize * aspect : crossSize / aspect;
    }

    item.style[crossSide] = crossSize + "px";
    item.style[mainSide] = Math.round(mainSize) + "px";
  }

  function populateItems() {
    for (let i = 0; i < itemCount; i++) {
      const snapFixDiv = document.createElement("div");
      snapFixDiv.classList.add("carousel-item-snap-fix");

      const item = document.createElement("div");
      item.classList.add("carousel-item");
      effect.onItemCreated(item);
      // Before createItem, so a caller that wants to size one item specially
      // can still do it there without this overwriting the result.
      applyItemSizing(item, i);
      createItem(item, i);

      snapFixDiv.appendChild(item);
      wrapper.insertBefore(snapFixDiv, lastSpacer);

      item.addEventListener("click", () => goToIndex(i, { behavior: "smooth" }));
    }

    updateSpacers();
  }

  // ctx bundles everything an effect module needs to read geometry and
  // report progress for this one wrapper. onProgress starts unset - a
  // navigator (page-controls, etc) attaches itself via setOnProgress after
  // createCarousel returns.
  const ctx = {
    wrapper,
    scrollDistance,
    offsetSize,
    offsetFromStart,
    scrollSize,
    scrollAxis,
    getAlignmentFraction,
    getScrollPadding,
    getNoncurrentScale,
    getScrollSource: () => scrollSource,
    getMotionState,
    getDrivenProgress: () => lastDrivenProgress,
    // Shared rather than measured per effect - see the geometry block
    // above. Effects that keep their own copy predate this and are not
    // wrong to; what they must not do is read it fresh every frame.
    getGeometry,
    currentScrollAnchor,
    usesContrast,
    onProgress: undefined
  };

  populateItems();
  updateContrast();
  effect.setup(ctx);
  effect.apply(ctx);
  ready = true;

  // A single rAF-throttled pass per scroll frame, shared by the effect and
  // every onScroll subscriber, so a link and an effect watching the same
  // wrapper can never disagree about which frame they're in, and so the
  // effect has always re-rendered for this position before anything
  // downstream reads it. `source` is sampled once rather than per listener:
  // it can only change on a real input event, which can't interleave with
  // this synchronous loop.
  // 'scrollend' fires once a scroll operation - gesture, momentum and any snap
  // correction together - is over, which is what bounds a stretch of movement.
  // Contrast is updated from the unthrottled listener, not the rAF-throttled
  // one below, so it flips on the first scroll event of a gesture rather
  // than a frame into it.
  wrapper.addEventListener("scroll", () => {
    const nowMovingItself = scrollSource === "self";
    if (nowMovingItself && !movingItself) selfScrollStartedAt = performance.now();
    movingItself = nowMovingItself;
    updateContrast();
  });
  // Unconditionally, not just when contrast changed: this is where a
  // gesture's final position becomes final, and the apply below is
  // rAF-throttled, so the last scroll event's render is still pending when
  // this fires. Rendering once more here is what guarantees the look ends
  // up drawing the position the carousel actually came to rest at.
  //
  // Only ends *this* carousel's own leading motion, not driven motion - see
  // endFollowing above for why the driven side can't trust its own
  // 'scrollend'. scrollEndListeners only fire on a real leading gesture
  // ending (wasLeading), so a spurious/early scrollend while merely being
  // driven, or one with no motion behind it at all, never gets relayed as if
  // it were the authoritative "the gesture is over" signal.
  wrapper.addEventListener("scrollend", () => {
    const wasLeading = movingItself;
    movingItself = false;
    updateContrast();
    applyIfReady();
    if (wasLeading) {
      scrollEndListeners.forEach((listener) => listener());
    }
  });

  wrapper.addEventListener(
    "scroll",
    rafThrottle(() => {
      effect.apply(ctx);
      const source = scrollSource;
      scrollListeners.forEach((listener) => listener({ source }));
    })
  );

  // Shared by both triggers below so a resize that also changes an item's
  // own size (e.g. dragging the window while an image is still loading)
  // coalesces into one refresh per frame instead of two.
  const refreshGeometry = rafThrottle(() => {
    updateSpacers();
    effect.setup(ctx);
    effect.apply(ctx);
  });

  window.addEventListener("resize", refreshGeometry);

  // Recovers from an item's size changing for reasons outside this module's
  // own control (e.g. a placeholder image finishing its load mid-scroll).
  // Effects that resize items themselves as their normal scroll-driven
  // behavior (see ios-scrubber-effect.js) opt out via
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

  // Re-points the wrapper at a new alignment: keeps whichever item is
  // currently "current" under the cursor of the new alignment (no smooth
  // scroll, so it doesn't fight the user's next scroll gesture), then
  // resizes the spacers and redraws to match.
  function setAlignment(alignment) {
    // Read before the change, so this is still the alignment the carousel
    // is currently laid out under. updateSpacers below drops the cache.
    const currentIndex = computeCurrentIndex(getCurrentProgress(), getGeometry().items.length);
    wrapper.dataset.scrollAlignment = alignment;
    updateSpacers();
    effect.setup(ctx);
    goToIndex(currentIndex, { behavior: "instant" });
    effect.apply(ctx);
  }

  return {
    wrapper,
    scrollAxis,
    getItems,
    goToIndex,
    getCurrentProgress,
    setProgressDirect,
    setAlignment,
    getScrollSource: () => scrollSource,
    getMotionState,
    // Which motion states drop contrast, changeable live (e.g. from a demo
    // control) - the policy is read fresh on every update, not captured.
    setContrastRemoval(mode) {
      const next = mode in CONTRAST_REMOVAL ? mode : "never";
      // Crossing between "never" and anything else can change how a look
      // draws itself, not just what it draws, so the effect is rebuilt
      // rather than merely re-rendered.
      const rebuild = ready && usesContrast() !== (next !== "never");
      contrastRemovalMode = next;
      contrastRemoval = CONTRAST_REMOVAL[next];
      if (rebuild) {
        effect.setup(ctx);
        effect.apply(ctx);
      }
      if (updateContrast()) applyIfReady();
    },
    isMovingItself: () => movingItself,
    selfScrollStartedAt: () => selfScrollStartedAt,
    // Notified once per scroll frame, after effect.apply, with the
    // attribution of that scroll - see the scroll-attribution block above.
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
