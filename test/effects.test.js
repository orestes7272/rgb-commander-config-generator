import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EFFECTS, runEffect, defaultParams, buildStarter } from '../public/js/core/effects.js';
import { BOARDS } from '../public/js/core/boards.js';
import { buildTemplate } from '../public/js/core/layouts.js';
import { resolveControls, setControlColor, getControlColor } from '../public/js/core/project.js';
import { MAX_FRAME_DELAY } from '../public/js/core/rgba.js';

const board = BOARDS.ultimateio;
const controls = resolveControls(buildTemplate('two-player-6'));

function scheme() {
  const a = new Array(96).fill(0);
  const b = new Array(96).fill(0);
  for (const c of controls) {
    if (!c.pins) continue;
    setControlColor(a, c.pins, { r: 0, g: 0, b: 64 });
    setControlColor(b, c.pins, { r: 64, g: 0, b: 0 });
  }
  return [
    { ms: 200, pins: a },
    { ms: 200, pins: b },
  ];
}

const ctx = () => ({ frames: scheme(), index: 0, controls, selection: new Set(), color: { r: 0, g: 255, b: 0 }, pinCount: 96 });

for (const effect of EFFECTS) {
  test(`${effect.id} produces valid frames`, () => {
    const result = runEffect(effect.id, ctx(), defaultParams(effect));
    assert.ok(['insert', 'replace'].includes(result.mode));
    assert.ok(result.frames.length > 0);
    for (const f of result.frames) {
      assert.equal(f.pins.length, 96);
      assert.ok(f.pins.every((v) => Number.isInteger(v) && v >= 0 && v <= 255));
      assert.ok(Number.isInteger(f.ms) && f.ms >= 0);
    }
  });
}

test('fade interpolates between frames', () => {
  const result = runEffect('fade', ctx(), { target: 'next', steps: 3, ms: 30 });
  assert.equal(result.mode, 'insert');
  assert.equal(result.frames.length, 3);
  const p1 = controls.find((c) => c.name === 'P1_BUTTON1').pins;
  assert.deepEqual(getControlColor(result.frames[1].pins, p1), { r: 32, g: 0, b: 32 });
  assert.ok(result.frames.every((f) => f.ms === 30 && f.ms <= MAX_FRAME_DELAY));
});

test('breathe starts at full brightness and dips to the low point', () => {
  const result = runEffect('breathe', ctx(), { steps: 8, low: 0, ms: 40, scope: 'all' });
  const p1 = controls.find((c) => c.name === 'P1_BUTTON1').pins;
  assert.deepEqual(getControlColor(result.frames[0].pins, p1), { r: 0, g: 0, b: 64 });
  assert.deepEqual(getControlColor(result.frames[4].pins, p1), { r: 0, g: 0, b: 0 });
});

test('blink can be limited to the selection', () => {
  const c = ctx();
  const start = controls.find((x) => x.name === 'P1_START');
  c.selection = new Set([start.id]);
  const result = runEffect('blink', c, { on: 300, off: 300, level: 0, scope: 'selection' });
  const b1 = controls.find((x) => x.name === 'P1_BUTTON1').pins;
  assert.deepEqual(getControlColor(result.frames[1].pins, start.pins), { r: 0, g: 0, b: 0 });
  assert.deepEqual(getControlColor(result.frames[1].pins, b1), { r: 0, g: 0, b: 64 });
});

test('port walk lights one port per frame', () => {
  const frames = buildStarter('port-walk', { controls, pinCount: 96, portCount: 32, portPins: (p) => board.portPins(p), color: null });
  assert.equal(frames.length, 32);
  frames.forEach((f, i) => {
    const lit = f.pins.map((v, pin) => (v ? pin + 1 : 0)).filter(Boolean);
    assert.deepEqual(lit, [i * 3 + 1, i * 3 + 2, i * 3 + 3]);
  });
});
