// The iOS Photos scrubber's look (looks/ios-box-look.js) wrapped in the
// generic flatten-while-dragging/settle-on-release behavior (settle-effect.js)
// - see those two files for what each half owns. This composition is what
// navigators/ios-thumbnail-scrubber.js actually wires up as its effect.
import { settleEffect } from "./settle-effect.js";
import { iosBoxLook } from "./looks/ios-box-look.js";

export const iosScrubberEffect = settleEffect(iosBoxLook);
