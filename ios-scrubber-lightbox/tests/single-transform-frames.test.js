import test from 'node:test';
import assert from 'node:assert/strict';
import { singleTransformFrames } from '../shared/effects/helpers/single-transform-frames.js';
import { computeAnimationRanges, computeCurrentProgress, computeEdgeAnchors } from '../shared/carousel-math.js';
import { computeGapCompensatedFrame } from '../shared/effects/helpers/gap-compensation.js';

const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test('combined transforms preserve the old two-timeline curves, including clamped ranges and end regions', () => {
  for (const sizes of [[100], [80, 340, 120, 600, 95], Array.from({ length: 30 }, (_, i) => 60 + (i * 97) % 400)]) {
    for (const width of [320, 768, 1440]) {
      let left = width / 2 - sizes[0] / 2;
      const anchors = sizes.map(size => {
        const anchor = left + size / 2;
        left += size + 10;
        return anchor;
      });
      const { before, after } = computeEdgeAnchors(anchors, sizes);
      const ranges = computeAnimationRanges(anchors, sizes, width);
      for (const scale of [0.6, 0.8, 1]) {
        const result = singleTransformFrames(anchors, sizes, width, scale, 0.4);
        for (let step = 0; step <= 200; step++) {
          const percent = step / 2;
          const position = result.start + percent / 100 * (result.end - result.start);
          const oldFrame = computeGapCompensatedFrame(
            anchors, sizes, scale, computeCurrentProgress([before, ...anchors, after], position) - 1
          );
          result.frames.forEach((frames, i) => {
            let j = 0;
            while (j < frames.length - 2 && frames[j + 1].percent < percent) j++;
            const a = frames[j], b = frames[j + 1];
            const t = (percent - a.percent) / (b.percent - a.percent);
            const value = key => a[key] + t * (b[key] - a[key]);
            // Evaluate the original cover-range animation independently.
            const cover = 0.5 + (position - anchors[i]) / (width + sizes[i]);
            const range = ranges[i];
            const progress = Math.max(0, Math.min(1, cover <= 0.5
              ? (cover - range.start) / (0.5 - range.start)
              : (range.end - cover) / (range.end - 0.5)));
            close(value('translate'), oldFrame.translations[i]);
            close(value('scale'), scale + (1 - scale) * progress);
            close(value('opacity'), 0.4 + 0.6 * progress);
          });
        }
      }
    }
  }
});

test('empty carousels generate no frames', () => {
  assert.deepEqual(singleTransformFrames([], [], 320, 0.8, 0.5), { start: 0, end: 0, frames: [] });
});
