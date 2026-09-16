# Carousels and Lightboxes

Vanilla HTML/CSS/JS prototype for carousel and lightbox components.

## Structure

```
src/
  index.html
  css/
    main.css
  js/
    main.js
```

Everything currently lives in `src/` as a single static page. If this grows
into a React app and/or gains multi-page navigation, the plan is:

- `src/` becomes the build entry point for a Vite + React setup
- Each component (carousel, lightbox, etc.) gets its own file/folder under
  `js/` (or `src/components/` once React is introduced), so the vanilla
  version can be ported over piece by piece instead of rewritten wholesale
- Multi-page navigation would either stay as separate static HTML pages
  (simplest, no build step) or move to a router once React is in place

## Running locally

```bash
npx serve src
```
