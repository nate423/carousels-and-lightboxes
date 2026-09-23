/**
 * Trimmed copy of Lightbox.Gallery (../lightbox/lightbox.jsx) for this
 * spike: GalleryThumbnailStrip swapped for our own ScrubberStrip, everything
 * else - Slides/Item/Media/Zoom, the glass controls, the caption placard,
 * the snug/bleed layout toggle - unchanged from the default preset.
 */
import * as React from 'react';
import { Lightbox } from '../lightbox/lightbox.jsx';
import { ScrubberStrip } from './scrubber-strip.jsx';

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Miniature of the snug layout — a centered card with the neighbouring
 * slides peeking in from the edges. */
function IconLayoutSnug() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
      <rect x="8.5" y="7" width="7" height="10" rx="1.5" />
      <path d="M4 9v6M20 9v6" strokeLinecap="round" />
    </svg>
  );
}

/** Miniature of the bleed layout — one slide, edge to edge. */
function IconLayoutBleed() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
      <rect x="4" y="7" width="16" height="10" rx="1.5" />
    </svg>
  );
}

/**
 * The snug/bleed choice is a user preference, so it survives across galleries
 * and visits - same storage key as the base preset's Gallery (../lightbox/
 * lightbox.jsx), since it's the same toggle on the same primitive. Guarded
 * reads/writes: localStorage throws in some private modes, and `window`
 * doesn't exist during SSR.
 */
const SLIDES_LAYOUT_STORAGE_KEY = 'ramka-lightbox-slides-layout';

function readStoredSlidesLayout() {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(SLIDES_LAYOUT_STORAGE_KEY);
    return value === 'snug' || value === 'bleed' ? value : null;
  } catch {
    return null;
  }
}

function storeSlidesLayout(layout) {
  try {
    window.localStorage.setItem(SLIDES_LAYOUT_STORAGE_KEY, layout);
  } catch {
    // Storage unavailable — the toggle still works for this session.
  }
}

function itemAspectRatio(item) {
  return item.width / item.height;
}

export function ScrubberGallery({ items, ariaLabel }) {
  const [slidesLayout, setSlidesLayout] = React.useState(() => readStoredSlidesLayout() ?? 'snug');
  const snug = slidesLayout === 'snug';

  const toggleSlidesLayout = React.useCallback(() => {
    setSlidesLayout((current) => {
      const next = current === 'snug' ? 'bleed' : 'snug';
      storeSlidesLayout(next);
      return next;
    });
  }, []);

  const snugEdgeRatios =
    snug && items.length > 0
      ? {
          start: itemAspectRatio(items[0]),
          end: itemAspectRatio(items[items.length - 1]),
        }
      : null;

  return (
    <Lightbox.Portal>
      <Lightbox.Backdrop />
      <Lightbox.Content aria-label={ariaLabel} className={snug ? 'lb-content-snug' : undefined}>
        <Lightbox.Slides
          key={slidesLayout}
          aria-label="Full-size images"
          aria-roledescription="carousel"
          // Every slide's content stays mounted. The strip jumps these slides
          // an item at a time as it's scrubbed, and with a preload window
          // each jump mounted one slide's photo and unmounted another's - a
          // re-layout and a full-size decode per item crossed, which is what
          // made scrubbing here run at a lower frame rate than the iOS
          // scrubber page. A gallery this size can afford to hold them all.
          preload={items.length}
          className={snug ? 'lb-slides-snug' : undefined}
          style={
            snugEdgeRatios
              ? {
                  '--lb-snug-ratio-start': snugEdgeRatios.start,
                  '--lb-snug-ratio-end': snugEdgeRatios.end,
                }
              : undefined
          }
        >
          {items.map((item, i) => {
            const ratio = itemAspectRatio(item);
            return (
              <Lightbox.Slide
                key={item.id ?? i}
                className={snug ? 'lb-slide-snug' : undefined}
                style={snug ? { '--lb-snug-ratio': ratio } : undefined}
              >
                <Lightbox.Item
                  index={i}
                  caption={item.caption ?? item.alt}
                  aria-roledescription="slide"
                  // Our scrubber replaces ramka's own ThumbnailStrip, whose
                  // Thumbnail/tab relationship is normally what names each
                  // slide - see the console warning this silences.
                  aria-label={`${i + 1} of ${items.length}`}
                >
                  <Lightbox.Zoom maxZoom={6}>
                    <Lightbox.Media width={item.width} height={item.height}>
                      <img
                        width={item.width}
                        height={item.height}
                        src={item.src}
                        alt={item.alt}
                        loading="eager"
                        draggable={false}
                      />
                    </Lightbox.Media>
                  </Lightbox.Zoom>
                </Lightbox.Item>
              </Lightbox.Slide>
            );
          })}
        </Lightbox.Slides>

        <div className="lb-top-right lb-chrome-gesture-hide">
          <button
            type="button"
            className={cx('lb-control', 'lb-control-md', 'lb-control-layout')}
            aria-pressed={snug}
            aria-label={snug ? 'Switch to theater layout' : 'Switch to peek layout'}
            onClick={toggleSlidesLayout}
          >
            {snug ? <IconLayoutSnug /> : <IconLayoutBleed />}
          </button>
          <div className="lb-control-group lb-control-md">
            <Lightbox.ZoomOut />
            <Lightbox.ZoomIn />
          </div>
          <Lightbox.Close className="lb-control" aria-label="Close">
            <IconX />
          </Lightbox.Close>
        </div>

        <div className="lb-bottom lb-chrome-gesture-hide">
          <div className="lb-caption-group">
            <Lightbox.Caption />
            <Lightbox.Counter>{({ current, total }) => `${current} of ${total}`}</Lightbox.Counter>
          </div>
          {/* Remounts alongside Slides (same key) - ScrubberStrip links to
              [data-ramka-slides] once, on its own mount, so it has to remount
              too whenever Slides does (layout toggle) or it's left wired to
              the detached old node. */}
          <ScrubberStrip key={slidesLayout} items={items} />
        </div>
      </Lightbox.Content>
    </Lightbox.Portal>
  );
}
