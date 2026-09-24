/**
 * The thumbnail strip this page swaps in for ramka's own ThumbnailStrip: a
 * real carousel-engine instance (native scroll + snap, the iOS-scrubber
 * expand look), linked to ramka's Slides viewport through
 * ramka-slides-controller.js instead of ramka's built-in ScrollTimeline sync.
 *
 * ramka doesn't mount its Slides until the lightbox is opened for the first
 * time, so that's also this component's first real mount (it lives inside
 * Content) - the [data-ramka-slides] lookup below always finds a live node.
 *
 * Guarded against re-running on the same DOM node (the dataset flag, not a
 * ref) because createCarousel has no teardown: it appends DOM items and
 * attaches listeners straight to `wrapper`, so React StrictMode's dev-only
 * double-invoke of this effect - the wrapper node itself survives that
 * simulated unmount/remount - would otherwise populate the strip twice (24
 * items instead of 12) and wire the ramka link twice over, corrupting the
 * geometry every position/index calc here depends on.
 *
 * This effect intentionally returns no cleanup. createCarousel's listeners
 * (scroll/scrollend, on `wrapper` itself) and linkCarousels' wiring have no
 * teardown either, so they stay live through StrictMode's simulated
 * unmount regardless - only the guard above stops a second real init.
 */
import { useEffect, useRef } from 'react';
import { createCarousel } from '../../shared/carousel-engine.js';
import { expandEffect } from '../../shared/effects/expand.js';
import { linkCarousels } from '../../shared/linked-scrolling/link.js';
import { createRamkaSlidesController } from '../../shared/linked-scrolling/ramka-slides-controller.js';

export function ScrubberStrip({ items }) {
  const wrapperRef = useRef(null);

  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || wrapper.dataset.scrubberInitialized) return;
    wrapper.dataset.scrubberInitialized = 'true';

    const scrubber = createCarousel(wrapper, {
      itemCount: items.length,
      // Same as the iOS scrubber page: the thumbnails flatten out while the
      // strip itself is being dragged, and grow again once it comes to rest.
      effect: expandEffect({ flattenWhileLeading: true }),
      createItem: (item, i) => {
        const thumb = item.querySelector('.expand-effect-thumb');
        const img = document.createElement('img');
        img.src = items[i].thumb;
        img.alt = items[i].alt;
        img.draggable = false;
        thumb.appendChild(img);
      }
    });

    // Public contract only (see @ramka/react's lightbox-data-attributes.js) -
    // the one lightbox on this page, so a page-wide query is enough.
    const slidesEl = document.querySelector('[data-ramka-slides]');
    if (!slidesEl) {
      console.warn('ScrubberStrip: no [data-ramka-slides] found to link against');
      return;
    }

    const ramkaController = createRamkaSlidesController(slidesEl);
    linkCarousels(ramkaController, scrubber, {
      // ramka's own slides jump straight to the item the strip lands on,
      // same as the iOS scrubber page's main carousel. Tried 'continuous'
      // here at one point, chasing a hard-flick bug - it traded the
      // expected discrete jump for a smooth pan, which wasn't what was
      // actually wanted (the bug was staleness under a fast flick, not the
      // jump itself). Reverted; see ramka-slides-controller.js's geometry
      // cache and this file's scrollend catch-up for the fixes that
      // actually address staleness without changing the character of the
      // motion.
      aWhileFollowing: 'instant',
      // The strip tracks ramka's slides 1:1 while they're being dragged.
      bWhileFollowing: 'continuous'
    });
  }, [items]);

  return <div className="carousel-wrapper ios-thumbnail-scrubber-strip" ref={wrapperRef} />;
}
