# proto-v1 — frozen

A complete, runnable snapshot of the prototype as it stood before the split
into independent implementations. Open `index.html` and it works: the
comparison page, all four effect variants side by side, the alignment radios
and the contrast selects.

## Why it's kept

Two reasons, and the second is the one that matters.

The JS variant (`effects/js-effect.js` → `settle-effect.js` →
`looks/scale-fade-look.js`) is the **reference implementation** of the
scale-fade look. It computes the look arithmetically, item by item, every
frame, where the live tree declares it as `@keyframes` and hands it to the
browser. When a CSS look draws something wrong, this is the only thing that
can say what the right answer was. Git history can't do that - history isn't
runnable.

The comparison page itself is the second reason. Four variants of two looks,
switchable from markup, with live controls for alignment and contrast policy.
That rig is what made the differences between them legible in the first
place, and it's the A/B baseline for verifying the reduction: open this page
and the new one, same gesture on both.

`effects/origin-effect.js` survives only here. It was a finding - a native
variant that swaps `transform-origin` instead of translating, which produces
even gaps only when every item is the same size - not an implementation worth
carrying forward.

## Rules

- **Nothing here imports from outside this directory.** It has its own copy of
  `carousel-math.js` and everything else. That's the point: a shared kernel
  would rot this the first time the live math changed, and it would rot in the
  way that destroys its value - still running, quietly wrong.
- **Nothing here gets fixed.** A bug found in this code gets fixed in the live
  tree only. If it's wrong here, that's a fact about what the prototype did.
- **Exclude this directory** from any codemod, lint, or build that runs across
  `src/`.
