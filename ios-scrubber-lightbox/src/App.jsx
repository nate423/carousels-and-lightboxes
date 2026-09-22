import { Lightbox } from './lightbox/lightbox.jsx';

/**
 * Demo seed data from ramka's default preset
 * (https://ramka.dev/presets/default) — same photos, same captions.
 */
const trip = [
  {
    src: '/photos/preset-trip-a.jpg',
    thumb: '/photos/preset-trip-a-thumb.jpg',
    alt: 'Maya on the ridge',
    caption: 'Maya Chen',
    width: 1200,
    height: 1200,
  },
  {
    src: '/photos/preset-trip-b.jpg',
    thumb: '/photos/preset-trip-b-thumb.jpg',
    alt: 'Cliffside road at sunset',
    caption: 'Cliffside road at sunset',
    width: 1600,
    height: 1000,
  },
  {
    src: '/photos/preset-trip-c.jpg',
    thumb: '/photos/preset-trip-c-thumb.jpg',
    alt: 'Turquoise cove',
    caption: 'A turquoise cove',
    width: 1600,
    height: 1000,
  },
  {
    src: '/photos/preset-trip-d.jpg',
    thumb: '/photos/preset-trip-d-thumb.jpg',
    alt: 'Trail through pines',
    caption: 'Through the pines',
    width: 1200,
    height: 1500,
  },
  {
    src: '/photos/preset-trip-e.jpg',
    thumb: '/photos/preset-trip-e-thumb.jpg',
    alt: 'Camp under the stars',
    caption: 'Camp under the stars',
    width: 1600,
    height: 1000,
  },
  {
    src: '/photos/preset-trip-f.jpg',
    thumb: '/photos/preset-trip-f-thumb.jpg',
    alt: 'Morning coffee on the rocks',
    caption: 'Morning on the rocks',
    width: 1200,
    height: 1200,
  },
  {
    src: '/photos/preset-trip-g.jpg',
    thumb: '/photos/preset-trip-g-thumb.jpg',
    alt: 'Waterfall in the canyon',
    caption: 'Hidden waterfall',
    width: 1600,
    height: 1000,
  },
  {
    src: '/photos/preset-trip-h.jpg',
    thumb: '/photos/preset-trip-h-thumb.jpg',
    alt: 'Wildflowers on the hillside',
    caption: 'Wildflower meadow',
    width: 1200,
    height: 1500,
  },
  {
    src: '/photos/preset-trip-i.jpg',
    thumb: '/photos/preset-trip-i-thumb.jpg',
    alt: 'Kayaks on calm water',
    caption: 'Kayak at dawn',
    width: 1600,
    height: 1000,
  },
  {
    src: '/photos/preset-trip-j.jpg',
    thumb: '/photos/preset-trip-j-thumb.jpg',
    alt: 'Sunset over the lake',
    caption: 'Golden hour',
    width: 1200,
    height: 1200,
  },
  {
    src: '/photos/preset-trip-k.jpg',
    thumb: '/photos/preset-trip-k-thumb.jpg',
    alt: 'Boardwalk through the marsh',
    caption: 'Coastal marsh',
    width: 1600,
    height: 1000,
  },
  {
    src: '/photos/preset-trip-l.jpg',
    thumb: '/photos/preset-trip-l-thumb.jpg',
    alt: 'Fire lookout tower',
    caption: 'Summit lookout',
    width: 1200,
    height: 1500,
  },
];

/** First 4 tiles of `trip`; the 4th gets a "+N" overlay for the rest. */
function AlbumPlusN() {
  const shown = trip.slice(0, 4);
  const extra = trip.length - shown.length;

  return (
    <Lightbox.Root license="gpl" morphTo="closest" awaitImageDecode={false}>
      <div className="album-grid">
        {shown.map((item, i) => {
          const showOverlay = i === shown.length - 1 && extra > 0;
          return (
            <Lightbox.Trigger
              key={item.src}
              index={i}
              crossfade={showOverlay ? 'both' : undefined}
              className="album-tile"
            >
              {({ imageRef }) => (
                <>
                  <img ref={imageRef} width={item.width} height={item.height} src={item.thumb} alt={item.alt} />
                  {showOverlay && (
                    <span className="album-tile-overlay">
                      <span>+{extra}</span>
                    </span>
                  )}
                </>
              )}
            </Lightbox.Trigger>
          );
        })}
      </div>
      <Lightbox.Gallery items={trip} ariaLabel="Trip photos" />
    </Lightbox.Root>
  );
}

export default function App() {
  return (
    <main className="grid">
      <h1>Photos</h1>

      <h2>Album, +N overlay</h2>
      <AlbumPlusN />

      <h2>Full grid</h2>
      <Lightbox.Root license="gpl" awaitImageDecode={false}>
        <div className="grid-tiles">
          {trip.map((item, i) => (
            <Lightbox.Trigger key={item.src} index={i} className="grid-tile">
              {({ imageRef }) => (
                <img ref={imageRef} width={item.width} height={item.height} src={item.thumb} alt={item.alt} />
              )}
            </Lightbox.Trigger>
          ))}
        </div>
        <Lightbox.Gallery items={trip} ariaLabel="Trip photos" />
      </Lightbox.Root>
    </main>
  );
}
