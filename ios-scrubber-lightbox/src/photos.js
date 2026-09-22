// Self-contained placeholder "photos" so this prototype has no network
// dependency - just enough of a distinct image per index (color + numeral)
// to see the scrubber and the morph working against real <img> elements.
function svgDataUri(width, height, hue, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="hsl(${hue} 55% 45%)" />
    <text x="50%" y="50%" font-family="system-ui, sans-serif" font-size="${Math.round(height / 4)}"
      fill="hsl(${hue} 55% 90%)" text-anchor="middle" dominant-baseline="central">${label}</text>
  </svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function makePhotos(count) {
  return Array.from({ length: count }, (_, i) => {
    const hue = Math.round((i / count) * 360);
    return {
      id: i,
      width: 1200,
      height: 900,
      src: svgDataUri(1200, 900, hue, i + 1),
      thumbSrc: svgDataUri(240, 180, hue, i + 1),
      alt: `Photo ${i + 1}`
    };
  });
}
