// The scale+fade look (looks/scale-fade-look.js) wrapped in the generic
// contrast/settle behavior (settle-effect.js) - see those two files for
// what each half owns. This is what a data-effect="js" wrapper actually
// runs, and what the thumbnail scrubbers fall back to on browsers without
// scroll-driven animations (see main.js).
import { settleEffect } from "./settle-effect.js";
import { scaleFadeLook } from "./looks/scale-fade-look.js";

export const jsEffect = settleEffect(scaleFadeLook);
