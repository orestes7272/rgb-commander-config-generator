import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blend, colorAt, loopColorAt, positions, applyGradient, defaultStops } from '../public/js/core/gradient.js';
import { runEffect } from '../public/js/core/effects.js';
import { buildTemplate } from '../public/js/core/layouts.js';
import { resolveControls, getControlColor, setControlColor } from '../public/js/core/project.js';
import { rgbToHsv } from '../public/js/core/color.js';

const RED = { r: 255, g: 0, b: 0 };
const GREEN = { r: 0, g: 255, b: 0 };
const BLUE = { r: 0, g: 0, b: 255 };
const controls = resolveControls(buildTemplate('two-player-6'));
const lit = controls.filter((c) => c.pins);
const byName = (name) => controls.find((c) => c.name === name);

test('smooth blend mixes the LED values', () => {
  assert.deepEqual(blend(RED, BLUE, 0), RED);
  assert.deepEqual(blend(RED, BLUE, 1), BLUE);
  assert.deepEqual(blend(RED, BLUE, 0.5), { r: 128, g: 0, b: 128 });
});

test('vivid blend goes the short way round the colour wheel at full strength', () => {
  const mid = blend(RED, BLUE, 0.5, 'hue');
  assert.equal(Math.round(rgbToHsv(mid).h), 300, 'red→blue passes through magenta');
  assert.equal(Math.max(mid.r, mid.g, mid.b), 255, 'stays bright instead of dipping to half');
  assert.deepEqual(blend({ r: 0, g: 0, b: 0 }, BLUE, 0.5, 'hue'), { r: 0, g: 0, b: 128 }, 'off has no hue, so it borrows blue');
});

test('colours are spread evenly along the stops', () => {
  const stops = [RED, GREEN, BLUE];
  assert.deepEqual(colorAt(stops, 0), RED);
  assert.deepEqual(colorAt(stops, 0.5), GREEN);
  assert.deepEqual(colorAt(stops, 1), BLUE);
  assert.deepEqual(colorAt(stops, 0.25), { r: 128, g: 128, b: 0 });
  assert.deepEqual(colorAt(stops, -1), RED, 'clamped');
  assert.deepEqual(colorAt(stops, 2), BLUE, 'clamped');
});

test('loops wrap from the last colour back to the first', () => {
  const stops = [RED, BLUE];
  assert.deepEqual(loopColorAt(stops, 0), RED);
  assert.deepEqual(loopColorAt(stops, 0.5), BLUE);
  assert.deepEqual(loopColorAt(stops, 1), RED);
  assert.deepEqual(loopColorAt(stops, -0.5), BLUE);
  assert.deepEqual(loopColorAt(stops, 0.75), { r: 128, g: 0, b: 128 });
});

test('even spacing gives every column of buttons its own step', () => {
  const even = positions(lit, 'left-right', 'even');
  const distance = positions(lit, 'left-right', 'distance');
  const sorted = [...even.values()].sort((a, b) => a - b);
  assert.equal(sorted[0], 0);
  assert.equal(sorted.at(-1), 1);
  // With two clusters far apart, distance spacing leaves an empty middle; even spacing doesn't.
  const gap = (map) => Math.max(...[...map.values()].sort((a, b) => a - b).map((v, i, a) => (i ? v - a[i - 1] : 0)));
  assert.ok(gap(distance) > 0.3);
  assert.ok(gap(even) < 0.1);
  const flipped = positions(lit, 'right-left', 'even');
  for (const c of lit) assert.equal(flipped.get(c.id), 1 - even.get(c.id));
});

test('a gradient runs from the leftmost to the rightmost button', () => {
  const pins = new Array(96).fill(0);
  applyGradient(pins, controls, { stops: [RED, GREEN, BLUE], direction: 'left-right', spacing: 'even' });
  const leftmost = lit.reduce((a, b) => (b.x < a.x ? b : a));
  const rightmost = lit.reduce((a, b) => (b.x > a.x ? b : a));
  assert.deepEqual(getControlColor(pins, leftmost.pins), RED);
  assert.deepEqual(getControlColor(pins, rightmost.pins), BLUE);
  // The P2 cluster sits on the BGR header; it still reads back as the right colours.
  assert.ok(getControlColor(pins, byName('P2_BUTTON6').pins).b > 128);
});

test('a gradient can be limited to some buttons', () => {
  const pins = new Array(96).fill(0);
  const row = ['P1_BUTTON1', 'P1_BUTTON2', 'P1_BUTTON3'].map(byName);
  applyGradient(pins, row, { stops: [RED, BLUE] });
  assert.deepEqual(getControlColor(pins, row[0].pins), RED);
  assert.deepEqual(getControlColor(pins, row[2].pins), BLUE);
  assert.deepEqual(getControlColor(pins, byName('P2_BUTTON1').pins), { r: 0, g: 0, b: 0 }, 'other buttons untouched');
});

test('default colours come from the scheme, then the brush', () => {
  const pins = new Array(96).fill(0);
  for (const c of lit) setControlColor(pins, c.pins, { r: 0, g: 0, b: 64 });
  assert.deepEqual(defaultStops(RED, pins, controls), [{ r: 0, g: 0, b: 64 }, RED], 'one scheme colour plus the brush');
  setControlColor(pins, byName('P1_BUTTON4').pins, { r: 16, g: 0, b: 48 });
  assert.deepEqual(defaultStops(RED, pins, controls), [{ r: 0, g: 0, b: 64 }, { r: 16, g: 0, b: 48 }], 'the two most used scheme colours');
  const [first, second] = defaultStops({ r: 64, g: 0, b: 0 }, null, controls);
  assert.deepEqual(first, { r: 64, g: 0, b: 0 });
  assert.equal(Math.round(rgbToHsv(second).h), 120, 'otherwise the brush hue turned a third of the way round');
  assert.equal(Math.max(second.r, second.g, second.b), 64, 'at the same brightness');
});

test('the animated gradient flows in the chosen direction and loops seamlessly', () => {
  const ctx = { frames: [{ ms: 100, pins: new Array(96).fill(0) }], index: 0, controls, selection: new Set(), color: RED, pinCount: 96 };
  const { mode, frames } = runEffect('gradient', ctx, { colors: [RED, BLUE], frames: 8, spread: 1, direction: 'left-right' });
  assert.equal(mode, 'replace');
  assert.equal(frames.length, 8);
  // Seamless: going from the last frame back to the first is no bigger a step than any other.
  const dist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
  const at = (f, c) => getControlColor(frames[f].pins, c.pins);
  const probe = lit[0];
  const steps = frames.map((_, f) => dist(at(f, probe), at((f + 1) % frames.length, probe)));
  assert.ok(steps.at(-1) <= Math.max(...steps.slice(0, -1)), `no jump where the loop restarts: ${steps}`);

  // Direction: the colour the leftmost button shows now is further right a frame later.
  const three = runEffect('gradient', ctx, { colors: [RED, GREEN, BLUE], frames: 8, spread: 1, direction: 'left-right', spacing: 'even' }).frames;
  const order = lit.slice().sort((a, b) => a.x - b.x);
  const was = getControlColor(three[0].pins, order[0].pins);
  const next = order.reduce((best, c) => (dist(getControlColor(three[1].pins, c.pins), was) < dist(getControlColor(three[1].pins, best.pins), was) ? c : best));
  assert.ok(next.x > order[0].x, 'the colour moved right');

  const together = runEffect('gradient', ctx, { colors: [RED, BLUE], frames: 4, spread: 0 });
  for (const f of together.frames) {
    const colours = new Set(lit.map((c) => JSON.stringify(getControlColor(f.pins, c.pins))));
    assert.equal(colours.size, 1, 'spread 0: every button shows the same colour');
  }
  assert.deepEqual(getControlColor(together.frames[0].pins, lit[0].pins), RED);
  assert.deepEqual(getControlColor(together.frames[2].pins, lit[0].pins), BLUE);
});

test('rainbow motion follows its direction', () => {
  const ctx = { frames: [{ ms: 100, pins: new Array(96).fill(0) }], index: 0, controls, selection: new Set(), color: RED, pinCount: 96 };
  const { frames } = runEffect('rainbow', ctx, { frames: 12, spread: 1, direction: 'left-right', brightness: 100, saturation: 100 });
  const order = lit.slice().sort((a, b) => a.x - b.x);
  const hue = (f, c) => rgbToHsv(getControlColor(frames[f].pins, c.pins)).h;
  // A hue that sits further left in one frame shows up further right in the next.
  const left = order[0];
  const target = hue(0, left);
  const later = order.find((c) => Math.abs(((hue(1, c) - target + 540) % 360) - 180) < 12);
  assert.ok(later && later.x > left.x, 'the colour moved right');
});
