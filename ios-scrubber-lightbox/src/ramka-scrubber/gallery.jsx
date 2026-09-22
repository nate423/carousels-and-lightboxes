/**
 * Trimmed copy of Lightbox.Gallery (../lightbox/lightbox.jsx) for this
 * spike: bleed layout only (no snug/theater toggle - one fewer moving part
 * while the scrubber link is what's being proven out), and
 * GalleryThumbnailStrip swapped for our own ScrubberStrip. Everything else
 * - Slides/Item/Media/Zoom, the glass controls, the caption placard - is
 * unchanged from the default preset.
 */
import { Lightbox } from '../lightbox/lightbox.jsx';
import { ScrubberStrip } from './scrubber-strip.jsx';

function IconX() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.25} aria-hidden>
      <path d="M18 6 6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ScrubberGallery({ items, ariaLabel }) {
  return (
    <Lightbox.Portal>
      <Lightbox.Backdrop />
      <Lightbox.Content aria-label={ariaLabel}>
        <Lightbox.Slides aria-label="Full-size images" aria-roledescription="carousel" preload={2}>
          {items.map((item, i) => (
            <Lightbox.Slide key={item.id ?? i}>
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
          ))}
        </Lightbox.Slides>

        <div className="lb-top-right lb-chrome-gesture-hide">
          <div className="lb-control-group lb-control-md">
            <Lightbox.ZoomOut />
            <Lightbox.ZoomIn />
          </div>
          <Lightbox.Close className="lb-control lb-control-md" aria-label="Close">
            <IconX />
          </Lightbox.Close>
        </div>

        <div className="lb-bottom lb-chrome-gesture-hide">
          <div className="lb-caption-group">
            <Lightbox.Caption />
            <Lightbox.Counter>{({ current, total }) => `${current} of ${total}`}</Lightbox.Counter>
          </div>
          <ScrubberStrip items={items} />
        </div>
      </Lightbox.Content>
    </Lightbox.Portal>
  );
}
