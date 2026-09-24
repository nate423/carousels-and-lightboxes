import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The scroll-timeline polyfill and what loads it: classic scripts, which
// Vite leaves alone rather than bundling, and whose paths it never sees
// anyway where one is written into the document from a JS string. So none
// of them reach the build unless they're copied there.
const scrollTimelineScripts = [
  "shared/scroll-timeline-loader.js",
  "shared/vendor/scroll-timeline.js",
  "archive/proto-v1/js/vendor/scroll-timeline.js"
];

// Copied into the build at the same paths, which is where the pages'
// relative paths to them point.
function copyScrollTimelineScripts() {
  return {
    name: "copy-scroll-timeline-scripts",
    apply: "build",
    generateBundle() {
      for (const fileName of scrollTimelineScripts) {
        this.emitFile({ type: "asset", fileName, source: readFileSync(resolve(__dirname, fileName)) });
      }
    }
  };
}

export default defineConfig(({ command }) => ({
  base: command === "build" ? "/carousels-and-lightboxes/" : "/",
  plugins: [react(), copyScrollTimelineScripts()],
  server: {
    // Listen on the LAN too, so a phone on the same wifi can open the dev
    // server at this Mac's IP address.
    host: true,
    port: 56576,
    strictPort: true
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        scaleFade: resolve(__dirname, "scale-fade/index.html"),
        filmstrip: resolve(__dirname, "filmstrip/index.html"),
        iosScrubber: resolve(__dirname, "ios-scrubber/index.html"),
        compare: resolve(__dirname, "compare/index.html"),
        archiveProtoV1: resolve(__dirname, "archive/proto-v1/index.html"),
        ramka: resolve(__dirname, "ramka/index.html"),
        ramkaScrubber: resolve(__dirname, "ramka-scrubber/index.html")
      }
    }
  }
}));
