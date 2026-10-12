import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withSaturation, rgbToHsv } from '../public/js/core/color.js';

test('withSaturation keeps hue and brightness', () => {
  assert.deepEqual(withSaturation({ r: 200, g: 0, b: 0 }, 0.5), { r: 200, g: 100, b: 100 });
  assert.deepEqual(withSaturation({ r: 200, g: 100, b: 100 }, 1), { r: 200, g: 0, b: 0 });
  assert.deepEqual(withSaturation({ r: 0, g: 128, b: 255 }, 0), { r: 255, g: 255, b: 255 });
  const { h, v } = rgbToHsv(withSaturation({ r: 0, g: 128, b: 255 }, 0.4));
  assert.ok(Math.abs(h - rgbToHsv({ r: 0, g: 128, b: 255 }).h) < 1);
  assert.equal(v, 255);
});

test('withSaturation gives greys the fallback hue and leaves off alone', () => {
  assert.deepEqual(withSaturation({ r: 120, g: 120, b: 120 }, 1, 240), { r: 0, g: 0, b: 120 });
  assert.deepEqual(withSaturation({ r: 0, g: 0, b: 0 }, 1, 240), { r: 0, g: 0, b: 0 });
});

test('withSaturation clamps to 0-1', () => {
  assert.deepEqual(withSaturation({ r: 200, g: 100, b: 100 }, 2), { r: 200, g: 0, b: 0 });
  assert.deepEqual(withSaturation({ r: 200, g: 100, b: 100 }, -1), { r: 200, g: 200, b: 200 });
});
