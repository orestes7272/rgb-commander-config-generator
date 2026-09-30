import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseRgba,
  serializeRgba,
  splitDelay,
  expandToPins,
  validateFileName,
  suggestFileName,
  contentHash,
  RgbaError,
} from '../public/js/core/rgba.js';

const sample = readFileSync(new URL('./fixtures/custom_mike_blue.rgba', import.meta.url), 'utf8');

test('parses a hand-formatted file with line breaks inside dec=""', () => {
  const { frames, warnings } = parseRgba(sample);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].values.length, 96);
  assert.equal(frames[0].delay, 200);
  assert.deepEqual(frames[0].values.slice(0, 12), [0, 0, 64, 0, 0, 64, 0, 0, 64, 16, 0, 48]);
  assert.deepEqual(frames[0].values.slice(48, 51), [64, 0, 0]);
  assert.deepEqual(warnings, []);
});

test('serializes in the layout of the stock RGBcommander files', () => {
  const text = serializeRgba([
    { values: [1, 2, 3], delay: 20 },
    { values: [4, 5, 6], delay: 255 },
  ]);
  assert.equal(text, '<anim>\r\n\t<frm dec="1,2,3"/>\r\n\t<frm dec="4,5,6"/>\r\n\t<tms dec="20,255"/>\r\n</anim>\r\n');
  assert.equal(serializeRgba([{ values: [0], delay: 0 }], { eol: '\n' }), '<anim>\n\t<frm dec="0"/>\n\t<tms dec="0"/>\n</anim>\n');
});

test('round-trips', () => {
  const frames = [
    { values: Array.from({ length: 96 }, (_, i) => (i * 7) % 256), delay: 33 },
    { values: new Array(96).fill(255), delay: 0 },
  ];
  assert.deepEqual(parseRgba(serializeRgba(frames)).frames, frames);
});

test('refuses to write values RGBcommander would wrap', () => {
  assert.throws(() => serializeRgba([{ values: [256], delay: 10 }]), RgbaError);
  assert.throws(() => serializeRgba([{ values: [1], delay: 300 }]), RgbaError);
  assert.throws(() => serializeRgba([{ values: [1.5], delay: 10 }]), RgbaError);
  assert.throws(() => serializeRgba([]), RgbaError);
});

test('wraps out-of-range values on import the way the daemon does', () => {
  const { frames, warnings } = parseRgba('<anim><frm dec="300,-1,5"/><tms dec="256"/></anim>');
  assert.deepEqual(frames[0].values, [44, 255, 5]);
  assert.equal(frames[0].delay, 0);
  assert.equal(warnings.length, 2);
});

test('fills in missing delays and ignores comments', () => {
  const { frames, warnings } = parseRgba('<!-- x --><anim><frm dec="1"/><frm dec="2"/><frm dec="3"/><tms dec="40"/></anim>');
  assert.deepEqual(
    frames.map((f) => f.delay),
    [40, 40, 40],
  );
  assert.match(warnings[0], /Only 1 delay/);
});

test('rejects files RGBcommander cannot read', () => {
  assert.throws(() => parseRgba(''), RgbaError);
  assert.throws(() => parseRgba('<foo/>'), /no <anim>/);
  assert.throws(() => parseRgba('<anim><tms dec="1"/></anim>'), /no <frm>/);
  assert.throws(() => parseRgba('<anim><frm dec="1,x"/><tms dec="1"/></anim>'), /not a whole number/);
  assert.throws(() => parseRgba('<anim><frm hex="ff"/><tms dec="1"/></anim>'), /only reads dec/);
});

test('splits long holds into byte-sized delays', () => {
  assert.deepEqual(splitDelay(200), [200]);
  assert.deepEqual(splitDelay(255), [255]);
  assert.deepEqual(splitDelay(256), [128, 128]);
  assert.deepEqual(splitDelay(1000), [250, 250, 250, 250]);
  assert.deepEqual(splitDelay(1001), [251, 250, 250, 250]);
  assert.deepEqual(splitDelay(0), [0]);
});

test('repeats short frames across all pins', () => {
  assert.deepEqual(expandToPins([1, 2, 3, 4], 10), [1, 2, 3, 4, 1, 2, 3, 4, 1, 2]);
});

test('validates file names', () => {
  assert.equal(validateFileName('custom_mike_blue'), null);
  assert.equal(validateFileName('Pattern01_32'), null);
  for (const bad of ['', '.hidden', '._x', 'has space', 'x.rgba', 'RANDOM', 'OFF', 'a/b', '../x', '_leading']) {
    assert.ok(validateFileName(bad), `${bad} should be rejected`);
  }
});

test('suggests file names from display names', () => {
  assert.equal(suggestFileName('Mike blue', 'custom_'), 'custom_mike_blue');
  assert.equal(suggestFileName('  Ryu vs. Ken!! ', ''), 'ryu_vs_ken');
  assert.equal(suggestFileName('', 'custom_'), 'custom_scheme');
  assert.equal(validateFileName(suggestFileName('Über Cool', '_')), null);
});

test('content hash ignores formatting', () => {
  const { frames } = parseRgba(sample);
  const reformatted = parseRgba(serializeRgba(frames, { eol: '\n' })).frames;
  assert.equal(contentHash(frames, 96), contentHash(reformatted, 96));
  assert.notEqual(contentHash(frames, 96), contentHash([{ ...frames[0], delay: 201 }], 96));
});
