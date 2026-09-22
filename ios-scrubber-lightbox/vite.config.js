import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
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
        archiveProtoV1: resolve(__dirname, "archive/proto-v1/index.html"),
        ramka: resolve(__dirname, "ramka/index.html")
      }
    }
  }
});
