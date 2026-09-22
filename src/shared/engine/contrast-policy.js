// Which motion states, if any, a carousel drops its contrast in - the
// four-way choice spelled as the two independent bits it actually is.
// "Contrast" here means whatever a look does to distinguish the current item
// from the rest; this module has no opinion on what that is, only on when it
// should be showing. Dropping it while leading is the iOS filmstrip's
// behavior: the thumbnails flatten out under your finger and the one you
// land on grows once you let go.
const CONTRAST_REMOVAL = {
  never: { leading: false, following: false },
  leading: { leading: true, following: false },
  following: { leading: false, following: true },
  always: { leading: true, following: true }
};

// Published as an attribute rather than handed to the effect, so that a
// look written entirely in CSS needs no JS of its own to honour the
// policy - it just declares what data-contrast="off" means for it. This
// module decides *when*; the look decides *what*.
//
// There is no separate "settle" step and nothing to re-expand on. Coming to
// rest is idle, and idle is not a state any policy removes contrast in, so
// the attribute goes back on its own. The easing on the way back is the
// look's business too - a CSS transition on whatever it derives from this.
export function createContrastPolicy(wrapper, initialMode) {
  let mode = initialMode in CONTRAST_REMOVAL ? initialMode : "never";
  let removal = CONTRAST_REMOVAL[mode];

  // Whether this carousel's contrast can ever change. A look may be able to
  // draw itself more cheaply when it cannot - see effects/scale-fade-effect.js,
  // which can
  // hand its whole look to the compositor in that case and cannot when a
  // multiplier has to be applied to it every frame.
  function usesContrast() {
    return mode !== "never";
  }

  // Reads the current motion state and writes data-contrast accordingly.
  // Returns whether it actually changed: this runs on every scroll event,
  // and rewriting an unchanged attribute still invalidates style for the
  // whole subtree.
  function update(motionState) {
    const removed = motionState !== "idle" && removal[motionState];
    const next = removed ? "off" : "on";
    if (wrapper.dataset.contrast === next) return false;
    wrapper.dataset.contrast = next;
    return true;
  }

  // Changes the policy live (e.g. from a debug control). Returns whether
  // usesContrast() actually flipped, since crossing between "never" and
  // anything else can change how a look draws itself, not just what it
  // draws, which is the caller's cue to rebuild the effect rather than
  // merely re-render it.
  function setMode(nextMode) {
    const next = nextMode in CONTRAST_REMOVAL ? nextMode : "never";
    const usedContrastBefore = usesContrast();
    mode = next;
    removal = CONTRAST_REMOVAL[next];
    return { usesContrastChanged: usesContrast() !== usedContrastBefore };
  }

  return { usesContrast, update, setMode };
}
