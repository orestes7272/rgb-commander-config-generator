import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BOARDS, resolveWiring, portPinsWithOrder } from '../public/js/core/boards.js';
import { buildTemplate, TEMPLATES, sanitizeLayout } from '../public/js/core/layouts.js';
import {
  projectFromRgba,
  resolveControls,
  getControlColor,
  setControlColor,
  exportFrames,
  projectToRgba,
  sanitizeProject,
  createProject,
  newFrame,
  frameColors,
} from '../public/js/core/project.js';
import { parseRgba } from '../public/js/core/rgba.js';
import { ledboardSnippet, coloursSnippet } from '../public/js/core/snippets.js';

const uio = BOARDS.ultimateio;
const sample = readFileSync(new URL('./fixtures/custom_mike_blue.rgba', import.meta.url), 'utf8');

test('Ultimate I/O ports: RGB on pins 1-48, BGR on 49-96', () => {
  assert.deepEqual(uio.portPins(1), { r: 1, g: 2, b: 3 });
  assert.deepEqual(uio.portPins(16), { r: 46, g: 47, b: 48 });
  assert.deepEqual(uio.portPins(17), { r: 51, g: 50, b: 49 });
  // RGBcommander's own example: <control name="P1_BUTTON1" pin="81,80,79"/>
  assert.deepEqual(uio.portPins(27), { r: 81, g: 80, b: 79 });
  assert.deepEqual(portPinsWithOrder(uio, 17, 'rgb'), { r: 49, g: 50, b: 51 });
  assert.deepEqual(portPinsWithOrder(uio, 2, 'grb'), { g: 4, r: 5, b: 6 });
});

test('resolves every wiring mode', () => {
  assert.deepEqual(resolveWiring({ mode: 'port', port: 17, order: 'auto' }, uio), { r: 51, g: 50, b: 49 });
  assert.deepEqual(resolveWiring({ mode: 'pins', r: 5, g: 9, b: 90 }, uio), { r: 5, g: 9, b: 90 });
  assert.deepEqual(resolveWiring({ mode: 'single', pin: 87, tint: '#ff0000' }, uio), { single: 87, tint: '#ff0000' });
  assert.equal(resolveWiring({ mode: 'none' }, uio), null);
  assert.equal(resolveWiring({ mode: 'port', port: 33 }, uio), null);
  assert.equal(resolveWiring({ mode: 'pins', r: 0, g: 1, b: 2 }, uio), null);
});

test('the sample decodes to blue with purple accents on both headers', () => {
  const { project } = projectFromRgba(sample, { fileName: 'custom_mike_blue' });
  const byPort = Object.fromEntries(resolveControls(buildTemplate('led-grid')).map((c) => [c.label, getControlColor(project.frames[0].pins, c.pins)]));
  const blue = { r: 0, g: 0, b: 64 };
  const purple = { r: 16, g: 0, b: 48 };
  for (const port of [1, 2, 3, 7, 16, 17, 19, 23, 32]) assert.deepEqual(byPort[port], blue, `port ${port}`);
  for (const port of [4, 5, 6, 15, 20, 21, 22]) assert.deepEqual(byPort[port], purple, `port ${port}`);
});

test('setting a colour on a BGR port writes the pins reversed', () => {
  const pins = new Array(96).fill(0);
  setControlColor(pins, uio.portPins(17), { r: 0, g: 0, b: 64 });
  assert.deepEqual(pins.slice(48, 51), [64, 0, 0]);
  setControlColor(pins, uio.portPins(1), { r: 10, g: 20, b: 30 });
  assert.deepEqual(pins.slice(0, 3), [10, 20, 30]);
});

test('single-colour LEDs use the brightest channel', () => {
  const pins = new Array(96).fill(0);
  const single = { single: 87, tint: '#ff0000' };
  setControlColor(pins, single, { r: 10, g: 200, b: 30 });
  assert.equal(pins[86], 200);
  assert.deepEqual(getControlColor(pins, single), { r: 200, g: 0, b: 0, level: 200 });
});

test('re-exporting an imported file gives the canonical layout with the same data', () => {
  const { project } = projectFromRgba(sample, { fileName: 'custom_mike_blue' });
  const text = projectToRgba(project);
  assert.match(text, /^<anim>\r\n\t<frm dec="0,0,64,0,0,64,0,0,64,16,0,48/);
  assert.deepEqual(parseRgba(text).frames, parseRgba(sample).frames);
});

test('long frames are split on export', () => {
  const project = createProject({ frames: [newFrame(96, 1000), newFrame(96, 40)] });
  assert.deepEqual(
    exportFrames(project).map((f) => f.delay),
    [250, 250, 250, 250, 40],
  );
});

test('32-value stock-style frames are expanded across all 96 pins', () => {
  const values = Array.from({ length: 32 }, (_, i) => i);
  const { project, warnings } = projectFromRgba(`<anim><frm dec="${values.join(',')}"/><tms dec="20"/></anim>`);
  assert.equal(project.frames[0].pins.length, 96);
  assert.equal(project.frames[0].pins[32], 0);
  assert.equal(project.frames[0].pins[95], 31);
  assert.match(warnings.join(' '), /repeated across all 96 pins/);
});

test('sanitizeProject rejects bad input', () => {
  const good = { name: 'x', fileName: 'custom_x', board: 'ultimateio', frames: [{ ms: 100, pins: new Array(96).fill(0) }] };
  assert.equal(sanitizeProject(good).frames.length, 1);
  assert.throws(() => sanitizeProject({ ...good, fileName: '../x' }));
  assert.throws(() => sanitizeProject({ ...good, frames: [] }));
  assert.throws(() => sanitizeProject({ ...good, frames: [{ ms: 100, pins: new Array(95).fill(0) }] }));
  assert.throws(() => sanitizeProject({ ...good, frames: [{ ms: 100, pins: new Array(96).fill(256) }] }));
  assert.throws(() => sanitizeProject({ ...good, frames: [{ ms: -1, pins: new Array(96).fill(0) }] }));
});

test('every template is a valid layout with unique ports', () => {
  for (const t of TEMPLATES) {
    const layout = sanitizeLayout(t.build());
    const ports = layout.controls.filter((c) => c.wiring.mode === 'port').map((c) => c.wiring.port);
    assert.equal(new Set(ports).size, ports.length, `${t.id} reuses a port`);
    for (const c of layout.controls) {
      assert.ok(c.x >= 0 && c.x <= layout.width, `${t.id} ${c.name} x inside panel`);
      assert.ok(c.y >= 0 && c.y <= layout.height, `${t.id} ${c.name} y inside panel`);
    }
  }
});

test('ledboard snippet uses R,G,B pin order, reversed on the BGR header', () => {
  const { xml, warnings } = ledboardSnippet(buildTemplate('two-player-6'));
  assert.match(xml, /<ledboard name="ULTIMATEIO_1" hwthrottle="417">/);
  assert.match(xml, /<control name="P1_BUTTON1" pin="1,2,3"\/>/);
  assert.match(xml, /<control name="P2_BUTTON1" pin="51,50,49"\/>/);
  assert.deepEqual(warnings, []);
});

test('colour snippet reuses stock colour names and invents the rest', () => {
  const layout = buildTemplate('two-player-6');
  const controls = resolveControls(layout);
  const pins = new Array(96).fill(0);
  for (const c of controls) if (c.pins) setControlColor(pins, c.pins, c.name.startsWith('P1') ? { r: 255, g: 0, b: 0 } : { r: 0, g: 0, b: 64 });
  const { colours, rom } = coloursSnippet(layout, pins, 'custom_mike_blue');
  assert.match(colours, /<colour name="MikeBlue1" rgb="0,0,64"\/>/);
  assert.doesNotMatch(colours, /255,0,0/);
  assert.match(rom, /<control name="P1_BUTTON1" colour="Red"\/>/);
  assert.match(rom, /<control name="P2_BUTTON1" colour="MikeBlue1"\/>/);
  assert.equal(frameColors(pins, controls).length, 2);
});
