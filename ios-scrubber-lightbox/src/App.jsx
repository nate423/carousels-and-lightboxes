import { useState } from "react";
import * as Lightbox from "@ramka/react/lightbox";
import { IosScrubber } from "./IosScrubber.jsx";
import { makePhotos } from "./photos.js";

const photos = makePhotos(18);

export default function App() {
  const [activeIndex, setActiveIndex] = useState(0);
  // Found once Slides mounts (see the `display: contents` wrapper below) -
  // IosScrubber needs the real scroll element to link against, not just an
  // index number.
  const [slidesEl, setSlidesEl] = useState(null);

  return (
    <Lightbox.Root
      license="gpl"
      value={activeIndex}
      onValueChange={setActiveIndex}
      loop
      awaitImageDecode={false}
      scrollTriggerIntoView={{ type: "onOpenComplete", behavior: "instant" }}
    >
      <main className="grid">
        <h1>Photos</h1>
        <div className="grid-tiles">
          {photos.map((photo, i) => (
            <Lightbox.Trigger key={photo.id} index={i} id={`trigger-${photo.id}`} className="grid-tile">
              {({ imageRef }) => <img ref={imageRef} src={photo.thumbSrc} width={240} height={180} alt={photo.alt} />}
            </Lightbox.Trigger>
          ))}
        </div>
      </main>

      <Lightbox.Portal>
        <Lightbox.Backdrop className="lightbox-backdrop" />
        <Lightbox.Content className="lightbox-content" aria-label="Photo viewer">
          {/* display: contents keeps this div invisible to layout - it exists
              only so we can grab a ref to the real Slides scroll element
              once it mounts, and hand it to IosScrubber to link against. */}
          <div style={{ display: "contents" }} ref={(el) => setSlidesEl(el?.querySelector("[data-ramka-slides]") ?? null)}>
            <Lightbox.Slides className="lightbox-slides" preload={1}>
              {photos.map((photo, i) => (
                <Lightbox.Slide key={photo.id} className="lightbox-slide">
                  <Lightbox.Item index={i} caption={photo.alt} aria-roledescription="slide" aria-label={`${i + 1} of ${photos.length}`}>
                    <Lightbox.Zoom>
                      <Lightbox.Media width={photo.width} height={photo.height}>
                        <img width={photo.width} height={photo.height} src={photo.src} alt={photo.alt} loading="eager" draggable={false} />
                      </Lightbox.Media>
                    </Lightbox.Zoom>
                  </Lightbox.Item>
                </Lightbox.Slide>
              ))}
            </Lightbox.Slides>

            <Lightbox.Close className="lightbox-close" aria-label="Close">
              ✕
            </Lightbox.Close>
            <Lightbox.Counter className="lightbox-counter" />
            <Lightbox.Previous className="lightbox-prev" aria-label="Previous">
              ‹
            </Lightbox.Previous>
            <Lightbox.Next className="lightbox-next" aria-label="Next">
              ›
            </Lightbox.Next>
            <Lightbox.Caption className="lightbox-caption" />

            {/* The one swap this prototype exists to make: ramka's own
                ThumbnailStrip (uniform-size thumbnails, centers the active
                one) replaced by the iOS Photos look (fixed-size thumbnails,
                only the centered one grows) - everything else in this file
                is the stock composition from ramka's docs. */}
            {slidesEl && (
              <IosScrubber photos={photos} activeIndex={activeIndex} slidesEl={slidesEl} className="ios-scrubber" />
            )}
          </div>
        </Lightbox.Content>
      </Lightbox.Portal>
    </Lightbox.Root>
  );
}
