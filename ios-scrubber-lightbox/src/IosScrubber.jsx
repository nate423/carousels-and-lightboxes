import { useEffect, useRef } from "react";

// The iOS Photos filmstrip look, ported down to just what this lightbox
// needs: fixed-size thumbnails at a constant gap, where only the item
// nearest the center grows (both its own width and the space its neighbors
// give it) - collapsing to flat while you're dragging the strip itself, and
// tracking smoothly (still grown) while Slides drives it instead. Replaces
// ramka's default ThumbnailStrip chrome.
//
// The grow/shift formula is the vanilla prototype's
// src/js/effects/ios-scrubber-css-effect.js, specialized to center alignment
// (this strip is always center-aligned, so that formula's "bend" correction
// term - needed only for other alignments - is identically zero and never
// appears below) and to fixed-width, fixed-gap thumbnails (so every item's
// rest position is `index * PITCH` by construction: no DOM measurement,
// geometry cache, or resize handling needed to know where an item anchors).
//
// The other half - *when* transitions should ease a change in versus snap it
// instantly, and whose scroll position to trust while painting - is the
// vanilla prototype's settle-effect.js + contrast-policy.js, reduced from
// their fully general leading/following/idle machinery (which has to
// arbitrate between two peer carousels, either of which might be driving the
// other) down to the two fixed roles here: this strip, and ramka's own
// Slides scroller. The rule those two modules land on, and the one this file
// copies, is *not* "transitions off while dragging" - it's:
//
//   transitionsEnabled = idle || contrast-is-off
//
// - at idle, so re-expanding after a drag eases in;
// - while *this* strip is being dragged (`leading`), because dropping
//   contrast there pins every item's target at its flat rest state - a
//   constant, not a value that changes every frame - so a transition can
//   happily ease into it once and then simply has nothing left to fight;
// - and OFF only while *Slides* is driving this strip (`following`) with
//   contrast still on, because that target *is* changing every frame, and a
//   transition restarting its easing curve on every one of those would only
//   add felt lag.
// Getting this backwards - disabling transitions for the drag itself - is
// exactly what read as "the collapse/expand isn't smooth" and "the strip
// jumps when you start scrolling": both were the same instant, untransitioned
// snap between a neighbor's pushed-aside shift and its flat one.
const ITEM_WIDTH = 20;
const ITEM_HEIGHT = 30;
const GAP = 3;
const EXPANDED_WIDTH = 30;
const EXPANDED_PADDING = 10;
const PITCH = ITEM_WIDTH + GAP;
const THUMB_GROWTH = EXPANDED_WIDTH - ITEM_WIDTH;
const FOOTPRINT_GROWTH = EXPANDED_WIDTH - ITEM_WIDTH + 2 * EXPANDED_PADDING;
// Matches main.css's --ios-thumbnail-scrubber-item/-thumb transition duration
// exactly (130ms ease) - the vanilla prototype's own house value for this
// look's collapse/expand.
const TRANSITION = "transform 130ms ease, width 130ms ease";

// u = how many items away `index` is from the shared progress, signed.
// grow: 1 at u=0 (this is the current item), fading to 0 by |u|=1.
// shift: how far this item's fixed box must move so the *visual* layout -
// every item at its real (grown) footprint, this one included - keeps the
// current position anchored at center. See ios-scrubber-css-effect.js for
// the full walkthrough; center alignment is what makes it this short.
function itemVisual(index, progress) {
  const u = index - progress;
  const lo = Math.min(Math.max(1 + u, 0), 1);
  const hi = Math.min(Math.max(u, 0), 1);
  const grow = lo - hi;
  const shift = (FOOTPRINT_GROWTH / 2) * (lo + hi - 1);
  return { grow, shift };
}

function rafThrottle(fn) {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      fn();
    });
  };
}

function clampIndex(i, count) {
  return Math.min(count - 1, Math.max(0, Math.round(i)));
}

// `scroll-snap-type: mandatory` (both this strip and ramka's own Slides have
// it) doesn't wait for a gesture to end before correcting a plain
// `el.scrollLeft = x` write - browsers resolve that kind of write as a
// complete, instantaneous scroll operation and immediately snap it to the
// nearest item, which is fatal to writing a *continuous* target position
// every frame (each write lands, gets corrected back to the nearest whole
// item, and the fractional-progress illusion never happens). Suspending
// scroll-snap-type for the duration of a drive - restoring the instant a
// real gesture reclaims the element, with a debounced fallback in case that
// never comes - is exactly what the vanilla prototype's
// engine/snap-suspension.js does for every carousel wrapper; ported
// verbatim here since both elements this strip writes to need it.
const SNAP_RESTORE_DELAY = 150;

function createSnapSuspension(el) {
  let timer = null;
  function suspend() {
    if (el.style.scrollSnapType !== "none") el.style.scrollSnapType = "none";
    clearTimeout(timer);
    timer = setTimeout(restore, SNAP_RESTORE_DELAY);
  }
  function restore() {
    clearTimeout(timer);
    if (el.style.scrollSnapType !== "") el.style.scrollSnapType = "";
  }
  return { suspend, restore };
}

export function IosScrubber({ photos, activeIndex, slidesEl, className }) {
  const count = photos.length;
  const stripRef = useRef(null);
  const boxRefs = useRef([]);
  const thumbRefs = useRef([]);
  // useRef's initializer only runs on the first render, which is exactly
  // what we want: where the strip opens is decided once, at mount - after
  // that, position comes from scroll (either side), never from a re-render.
  const initialIndexRef = useRef(activeIndex);

  function paintProgress(progress) {
    const current = Math.round(progress);
    for (let i = 0; i < count; i++) {
      const { grow, shift } = itemVisual(i, progress);
      const box = boxRefs.current[i];
      const thumb = thumbRefs.current[i];
      if (box) {
        box.style.transform = `translate3d(${shift.toFixed(2)}px, 0, 0)`;
        box.setAttribute("aria-selected", String(i === current));
      }
      if (thumb) thumb.style.width = `${(ITEM_WIDTH + grow * THUMB_GROWTH).toFixed(2)}px`;
    }
  }

  // The look's own undecorated state - every thumbnail at its base size, no
  // shift - painted once when a drag starts (contrast off), then left alone:
  // the target is a constant, not a per-frame curve, so nothing needs to
  // repaint it again until the drag ends. Iterated for-loop rather than the
  // paintProgress formula evaluated at some progress, to be explicit that
  // this is contrast being off, not "curved toward" anything.
  function paintFlat() {
    for (let i = 0; i < count; i++) {
      const box = boxRefs.current[i];
      const thumb = thumbRefs.current[i];
      if (box) box.style.transform = "translate3d(0, 0, 0)";
      if (thumb) thumb.style.width = `${ITEM_WIDTH}px`;
    }
  }

  function setTransitionsEnabled(enabled) {
    const value = enabled ? TRANSITION : "none";
    for (let i = 0; i < count; i++) {
      const box = boxRefs.current[i];
      const thumb = thumbRefs.current[i];
      if (box) box.style.transition = value;
      if (thumb) thumb.style.transition = value;
    }
    // A transition only animates a property change that happens *after* the
    // browser has committed a style recalc with the transition already
    // active - turning transitions on and writing the new value in the same
    // synchronous pass, with nothing in between, style-computes as one
    // atomic change instead. Reading a layout property forces that recalc to
    // happen right here, so the paint call after this one lands in a frame
    // that already has the transition live. Only matters going from
    // following (the one state with transitions off) back to idle.
    if (enabled) void boxRefs.current[0]?.offsetWidth;
  }

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !slidesEl) return;

    // Whether *this strip* is the one currently being moved for its own
    // reasons - a real drag/wheel gesture on it, or a tap-a-thumbnail glide
    // - as opposed to being carried along by Slides. The only place this
    // gets set true is a real input event on the strip (never as a reaction
    // to a write this effect made itself), so no echo-suppression flag is
    // needed anywhere below: Slides' scroll handler simply doesn't act while
    // this is true, and the strip's own scroll handler simply doesn't act
    // while it's false.
    let leading = false;
    // Whether Slides is currently mid-glide for any reason (swipe, momentum,
    // Next/Previous, keyboard, a trigger tapped elsewhere) - matches
    // scroll-attribution.js's "following": *any* index change Slides didn't
    // get from this strip leading it, with no special case for what caused
    // it. Tracked only to decide whether transitions should be on (a
    // one-time change easing in) or off (a live curve being written every
    // frame, which a transition would just lag behind).
    let following = false;
    let transitionsEnabled = true;
    const stripSnap = createSnapSuspension(strip);
    const slidesSnap = createSnapSuspension(slidesEl);

    // 'scrollend' is the right signal for "the gesture is over" and is what
    // both settle paths listen for below - but real trackpad/touch momentum
    // can run long, and not every engine fires 'scrollend' reliably at the
    // end of it. Without a fallback, a flick that ends without that event
    // leaves the strip stuck flat/collapsed forever. This is a second,
    // independent path to the same settle functions: whichever fires first
    // wins, and the other is a no-op (both settle functions bail immediately
    // once leading/following is already false).
    const QUIET_SETTLE_DELAY = 120;
    let quietSettleTimer = null;
    function scheduleQuietSettle(fn) {
      clearTimeout(quietSettleTimer);
      quietSettleTimer = setTimeout(fn, QUIET_SETTLE_DELAY);
    }

    stripSnap.suspend();
    strip.scrollLeft = initialIndexRef.current * PITCH;
    stripSnap.restore();
    paintProgress(initialIndexRef.current);

    function startLeading() {
      // This strip is being reclaimed for a real gesture (or a tap-glide -
      // see selectIndex) - if `following` had scroll-snap suspended on it
      // moments ago, hand it back now rather than waiting on the debounce,
      // the same instant-reclaim rule scroll-attribution.js's onSelfReclaim
      // documents: reasserting snap while the scroll position is already
      // exactly where the last write put it corrects nothing, but waiting
      // risks the timer firing mid-gesture instead.
      stripSnap.restore();
      // Armed here too, not just from onStripScroll below: a gesture that
      // starts but produces no actual 'scroll' event (e.g. a wheel tick too
      // small to move a snap-locked strip) would otherwise never get a
      // settle scheduled at all and stay flat.
      scheduleQuietSettle(settleLeading);
      if (leading) return;
      leading = true;
      // Contrast just dropped to off - transitions stay ON here (see the
      // header comment), so this flat target eases in instead of snapping.
      paintFlat();
    }

    function settleLeading() {
      if (!leading) return;
      clearTimeout(quietSettleTimer);
      leading = false;
      const settled = clampIndex(strip.scrollLeft / PITCH, count);
      strip.scrollLeft = settled * PITCH;
      slidesSnap.suspend();
      slidesEl.scrollLeft = settled * slidesEl.clientWidth;
      // Contrast is back on and motion is ending - still the "transitions
      // stay on" case, so the re-grow eases in too.
      paintProgress(settled);
    }

    function settleFollowing() {
      if (leading || !following) return;
      clearTimeout(quietSettleTimer);
      following = false;
      const settled = clampIndex(slidesEl.scrollLeft / slidesEl.clientWidth, count);
      if (!transitionsEnabled) {
        transitionsEnabled = true;
        setTransitionsEnabled(true);
      }
      strip.scrollLeft = settled * PITCH;
      paintProgress(settled);
    }

    // ramka's Content has its own pull-to-dismiss gesture that listens for
    // wheel/touch input anywhere in Stage - including, it turns out, right
    // over this strip's own buttons, which it has no way to know are a
    // second scrollable region rather than a dismiss target. Stopping
    // propagation here keeps that input for the strip's own horizontal drag
    // instead of letting it also arm a vertical dismiss underneath it.
    const onStripInputStart = (event) => {
      event.stopPropagation();
      startLeading();
    };

    const onStripScroll = rafThrottle(() => {
      if (!leading) return;
      const progress = strip.scrollLeft / PITCH;
      slidesSnap.suspend();
      slidesEl.scrollLeft = progress * slidesEl.clientWidth;
      scheduleQuietSettle(settleLeading);
    });

    const onStripScrollEnd = () => settleLeading();

    const onSlidesScroll = rafThrottle(() => {
      if (leading) return;
      if (!following) {
        following = true;
      }
      if (transitionsEnabled) {
        transitionsEnabled = false;
        setTransitionsEnabled(false);
      }
      const progress = slidesEl.scrollLeft / slidesEl.clientWidth;
      paintProgress(progress);
      stripSnap.suspend();
      strip.scrollLeft = progress * PITCH;
      scheduleQuietSettle(settleFollowing);
    });

    const onSlidesScrollEnd = () => settleFollowing();

    // pointerdown covers mouse/touch/pen drags; wheel covers trackpad swipes
    // that never fire pointerdown at all.
    strip.addEventListener("pointerdown", onStripInputStart);
    strip.addEventListener("wheel", onStripInputStart, { passive: true });
    strip.addEventListener("scroll", onStripScroll);
    strip.addEventListener("scrollend", onStripScrollEnd);
    slidesEl.addEventListener("scroll", onSlidesScroll);
    slidesEl.addEventListener("scrollend", onSlidesScrollEnd);
    return () => {
      clearTimeout(quietSettleTimer);
      strip.removeEventListener("pointerdown", onStripInputStart);
      strip.removeEventListener("wheel", onStripInputStart);
      strip.removeEventListener("scroll", onStripScroll);
      strip.removeEventListener("scrollend", onStripScrollEnd);
      slidesEl.removeEventListener("scroll", onSlidesScroll);
      slidesEl.removeEventListener("scrollend", onSlidesScrollEnd);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, slidesEl]);

  function selectIndex(i) {
    // A tap is also "this strip moving for its own reasons" - the same
    // collapse-then-settle treatment a drag gets, via the pointerdown this
    // click was preceded by; scrollTo's own glide drives the rest through
    // the normal scroll handler.
    stripRef.current?.scrollTo({ left: i * PITCH, behavior: "smooth" });
  }

  return (
    <div className={className} ref={stripRef} role="tablist" aria-label="Photo thumbnails">
      <div className="ios-scrubber-spacer" aria-hidden="true" />
      {photos.map((photo, i) => (
        <button
          key={photo.id}
          type="button"
          role="tab"
          aria-label={photo.alt}
          className="ios-scrubber-item"
          ref={(el) => (boxRefs.current[i] = el)}
          style={{ "--ios-item-height": `${ITEM_HEIGHT}px`, transition: TRANSITION }}
          onClick={() => selectIndex(i)}
        >
          <span className="ios-scrubber-thumb" ref={(el) => (thumbRefs.current[i] = el)} style={{ transition: TRANSITION }}>
            <img src={photo.thumbSrc} alt="" />
          </span>
        </button>
      ))}
      <div className="ios-scrubber-spacer" aria-hidden="true" />
    </div>
  );
}
