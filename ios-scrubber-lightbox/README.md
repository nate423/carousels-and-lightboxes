# iOS scrubber lightbox prototype

A separate, focused prototype: [ramka](https://ramka.dev)'s React lightbox
primitives, with its default `ThumbnailStrip` chrome swapped out for the
iOS Photos-style filmstrip from the vanilla carousel prototype in `../src`
(only the centered thumbnail grows, everything else stays a fixed size).

Everything specific to that swap lives in [`src/IosScrubber.jsx`](src/IosScrubber.jsx)
— read its header comment for how it's a drastically smaller version of
`../src/js/effects/ios-scrubber-css-effect.js`'s logic, and why fixing the
use case (always center-aligned, fixed-size thumbnails, exactly one thing to
link against) is what allows that.

## Running locally

```bash
npm install
npm run dev
```
