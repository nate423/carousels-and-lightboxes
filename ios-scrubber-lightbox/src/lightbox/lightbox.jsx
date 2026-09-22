/**
 * Default lightbox, plain-CSS variant — from ramka's default preset
 * (https://ramka.dev/presets/default), copied in with lightbox.css.
 *
 * Re-exports ramka Lightbox primitives with this skin attached, plus composed
 * `Lightbox.Gallery` (bleed or snug slides, glass controls, desktop thumbnail strip).
 *
 * Package boundary: only the styled primitives + Gallery. Trigger layouts,
 * album grids, user cards, and other app UI belong in the consuming app.
 */

import * as React from 'react';
import * as RamkaLightbox from '@ramka/react/lightbox';

import './lightbox.css';

function cx(...parts) {
  return parts.filter(Boolean).join(' ');
}

/* ── Icons (inline — no lucide dependency for copy-paste) ───────────────── */

function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconZoomIn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3M11 8v6M8 11h6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconZoomOut() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3M8 11h6" strokeLinecap="round" strokeLinejoin="round" />
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
 * and visits. Guarded reads/writes: localStorage throws in some private modes,
 * and `window` doesn't exist during SSR (the portal renders nothing while
 * closed, so the pre-hydration value is never visible anyway).
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

/* ── Styled primitives (design-system re-exports) ───────────────────────── */

function Root(props) {
  return <RamkaLightbox.Root {...props} />;
}

function Trigger({ className, ...props }) {
  return <RamkaLightbox.Trigger className={cx('lb-trigger', className)} {...props} />;
}

function Portal({ className, ...props }) {
  return <RamkaLightbox.Portal className={cx('lb-portal', className)} {...props} />;
}

function Backdrop({ className, ...props }) {
  return <RamkaLightbox.Backdrop className={cx('lb-backdrop', className)} {...props} />;
}

function Content({ className, ...props }) {
  return <RamkaLightbox.Content className={cx('lb-content', className)} {...props} />;
}

function Close({ className, children, ...props }) {
  return (
    <RamkaLightbox.Close className={cx('lb-control', className)} aria-label="Close" {...props}>
      {children ?? <IconX />}
    </RamkaLightbox.Close>
  );
}

function Slides({ className, ...props }) {
  return <RamkaLightbox.Slides className={cx('lb-slides', className)} {...props} />;
}

function Slide({ className, ...props }) {
  return <RamkaLightbox.Slide className={cx('lb-slide', className)} {...props} />;
}

function Item(props) {
  return <RamkaLightbox.Item {...props} />;
}

function Media({ className, ...props }) {
  return <RamkaLightbox.Media className={cx('lb-media', className)} {...props} />;
}

function Zoom(props) {
  return <RamkaLightbox.Zoom {...props} />;
}

function ZoomIn({ className, children, ...props }) {
  return (
    <RamkaLightbox.ZoomIn className={cx('lb-control', 'lb-control-md', className)} aria-label="Zoom in" {...props}>
      {children ?? <IconZoomIn />}
    </RamkaLightbox.ZoomIn>
  );
}

function ZoomOut({ className, children, ...props }) {
  return (
    <RamkaLightbox.ZoomOut className={cx('lb-control', 'lb-control-md', className)} aria-label="Zoom out" {...props}>
      {children ?? <IconZoomOut />}
    </RamkaLightbox.ZoomOut>
  );
}

function Counter({ className, ...props }) {
  return <RamkaLightbox.Counter className={cx('lb-counter', className)} {...props} />;
}

function Caption({ className, ...props }) {
  return <RamkaLightbox.Caption className={cx('lb-caption', className)} {...props} />;
}

function ThumbnailStrip({ className, ...props }) {
  return <RamkaLightbox.ThumbnailStrip className={cx('lb-thumbnail-strip', className)} {...props} />;
}

function ThumbnailStripTrack(props) {
  return <RamkaLightbox.ThumbnailStripTrack {...props} />;
}

function Thumbnail(props) {
  return <RamkaLightbox.Thumbnail {...props} />;
}

function Previous(props) {
  return <RamkaLightbox.Previous {...props} />;
}

function Next(props) {
  return <RamkaLightbox.Next {...props} />;
}

function ThumbnailGroup(props) {
  return <RamkaLightbox.ThumbnailGroup {...props} />;
}

/* ── Composed Gallery (product chrome) ──────────────────────────────────── */

function GalleryThumbnailStrip({ items }) {
  if (items.length <= 1) return null;

  return (
    <ThumbnailStrip className="lb-thumbnail-strip-desktop">
      <ThumbnailStripTrack aria-label="Photo thumbnails">
        {items.map((item, i) => (
          <Thumbnail key={item.id ?? i} index={i}>
            <img src={item.thumb} alt={item.alt} draggable={false} />
          </Thumbnail>
        ))}
      </ThumbnailStripTrack>
      <span className="lb-thumbnail-strip-indicator" aria-hidden />
    </ThumbnailStrip>
  );
}

/**
 * Default product chrome — Portal → Backdrop + Content → Slides/Zoom + glass
 * controls / caption + counter placard / desktop ThumbnailStrip. Supports bleed (full-width)
 * and snug (aspect-sized cards) via the top-right layout toggle or `slidesLayout`.
 */
function Gallery({ items, ariaLabel, slidesLayout: slidesLayoutProp, onSlidesLayoutChange }) {
  const [slidesLayoutInternal, setSlidesLayoutInternal] = React.useState(
    () => readStoredSlidesLayout() ?? 'snug',
  );
  const slidesLayout = slidesLayoutProp ?? slidesLayoutInternal;
  const snug = slidesLayout === 'snug';
  // Single item → no thumbnail strip → solo layout (tighter, centered bottom band).
  const solo = items.length <= 1;

  const setSlidesLayout = React.useCallback(
    (next) => {
      storeSlidesLayout(next);
      onSlidesLayoutChange?.(next);
      if (slidesLayoutProp === undefined) {
        setSlidesLayoutInternal(next);
      }
    },
    [onSlidesLayoutChange, slidesLayoutProp],
  );

  const toggleSlidesLayout = React.useCallback(() => {
    setSlidesLayout(slidesLayout === 'snug' ? 'bleed' : 'snug');
  }, [setSlidesLayout, slidesLayout]);

  const snugEdgeRatios =
    snug && items.length > 0
      ? {
          start: itemAspectRatio(items[0]),
          end: itemAspectRatio(items[items.length - 1]),
        }
      : null;

  return (
    <Portal>
      <Backdrop />
      <Content aria-label={ariaLabel} className={cx(snug && 'lb-content-snug', solo && 'lb-content-solo') || undefined}>
        <Slides
          key={slidesLayout}
          aria-label="Full-size images"
          // The library ships no copy, so the words announcing the carousel and
          // its slides live here, next to the rest of your UI strings.
          aria-roledescription="carousel"
          preload={2}
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
              <Slide
                key={item.id ?? i}
                className={snug ? 'lb-slide-snug' : undefined}
                style={snug ? { '--lb-snug-ratio': ratio } : undefined}
              >
                <Item
                  index={i}
                  caption={item.caption ?? item.alt}
                  aria-roledescription="slide"
                  // With the strip the item is a `tabpanel` its thumbnail tab
                  // already names, so only the solo shape needs a name here.
                  {...(solo ? { 'aria-label': `${i + 1} of ${items.length}` } : {})}
                >
                  <Zoom maxZoom={6}>
                    <Media width={item.width} height={item.height}>
                      <img
                        width={item.width}
                        height={item.height}
                        src={item.src}
                        alt={item.alt}
                        loading="eager"
                        draggable={false}
                      />
                    </Media>
                  </Zoom>
                </Item>
              </Slide>
            );
          })}
        </Slides>

        <div className={cx('lb-top-right', 'lb-chrome-gesture-hide')}>
          {/* Layout toggle. User copy: "theater" = bleed (one wide slide),
              "peek" = snug (card with neighbours peeking). The icon is a
              miniature of the CURRENT layout; the label names the TARGET. */}
          <button
            type="button"
            className={cx('lb-control', 'lb-control-md', 'lb-control-layout')}
            aria-pressed={snug}
            aria-label={snug ? 'Switch to theater layout' : 'Switch to peek layout'}
            onClick={toggleSlidesLayout}
          >
            {snug ? <IconLayoutSnug /> : <IconLayoutBleed />}
          </button>
          {/* Zoom −/+ share one capsule with a hairline divider. */}
          <div className={cx('lb-control-group', 'lb-control-md')}>
            <ZoomOut />
            <ZoomIn />
          </div>
          <Close />
        </div>

        <div className={cx('lb-bottom', 'lb-chrome-gesture-hide', solo && 'lb-bottom-solo')}>
          {/*
            Caption under the media, placard-style. The counter is visible on
            mobile where there's no strip to show position; on md+ the strip
            covers that, so the counter collapses to sr-only and keeps only
            its aria-live announcement role.
          */}
          <div className="lb-caption-group">
            <Caption />
            {/* "1 of 1" is noise — skip the counter for single-item galleries. */}
            {solo ? null : <Counter>{({ current, total }) => `${current} of ${total}`}</Counter>}
          </div>
          <GalleryThumbnailStrip items={items} />
        </div>
      </Content>
    </Portal>
  );
}

/**
 * Styled Lightbox namespace — drop-in replacement for `import * as Lightbox from '@ramka/react/lightbox'`
 * with this preset's styles and composed Gallery.
 */
export const Lightbox = {
  Root,
  Trigger,
  Portal,
  Backdrop,
  Content,
  Close,
  Slides,
  Slide,
  Item,
  Media,
  Zoom,
  ZoomIn,
  ZoomOut,
  Counter,
  Caption,
  ThumbnailStrip,
  ThumbnailStripTrack,
  Thumbnail,
  ThumbnailGroup,
  Previous,
  Next,
  Gallery,
};
