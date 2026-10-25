// Renders the app icons without any image libraries: the Neon Ring mark (red,
// green and blue LED arcs around a lit button, each with a soft glow) on the
// app tile, supersampled, written as PNGs. It matches public/favicon.svg.
// icon-256.png is used by the Unraid template and the desktop app; the 512 px
// ones by the web app manifest. "Maskable" icons fill the whole square and
// keep the art inside the middle 80%, so Android can crop them to its own shape.
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

// The tile is drawn on a 256-unit square (4x the favicon's 64-unit viewBox).
// The mark uses logo.svg's 200-unit viewBox, placed at 16,16 and scaled to 224.
const SS = 4;
const C = 128;
const SCALE = 224 / 200;
const TILE = [20, 22, 28];
const BORDER = [37, 41, 51];
const SIGMA = 6; // the glow's blur, in mark units
const SPAN = 122.2 / 70;
// Arcs start at their rotation and run clockwise (y down), with round caps.
const arcs = [
  { from: -140, glow: [255, 45, 74], core: [255, 107, 127] },
  { from: -20, glow: [34, 212, 110], core: [108, 240, 164] },
  { from: 100, glow: [47, 123, 255], core: [110, 163, 255] },
];

// Abramowitz & Stegun 7.1.26, plenty for a glow.
function erf(x) {
  const s = Math.sign(x);
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return s * y;
}

// How much of a stroke of half-width w, blurred, covers a point d from its centre line.
const blurred = (d, w) => 0.5 * (erf((w - d) / (SIGMA * Math.SQRT2)) + erf((w + d) / (SIGMA * Math.SQRT2)));

// Distance from a point (mark units, centred) to an arc of the r=70 ring.
function arcDistance(x, y, arc) {
  const from = (arc.from * Math.PI) / 180;
  const a = (((Math.atan2(y, x) - from) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  if (a <= SPAN) return Math.abs(Math.hypot(x, y) - 70);
  let best = Infinity;
  for (const e of [from, from + SPAN]) best = Math.min(best, Math.hypot(x - 70 * Math.cos(e), y - 70 * Math.sin(e)));
  return best;
}

function sample(px, py, maskable) {
  if (!maskable) {
    // rounded-square tile with a 1px (4-unit) border
    const r = 64;
    const qx = Math.max(Math.abs(px - C) - (C - r), 0);
    const qy = Math.max(Math.abs(py - C) - (C - r), 0);
    const e = Math.hypot(qx, qy);
    if (e > r) return [0, 0, 0, 0];
    if (e > r - 4 || Math.max(Math.abs(px - C), Math.abs(py - C)) > C - 4) return [...BORDER, 255];
  }
  const x = (px - C) / SCALE;
  const y = (py - C) / SCALE;
  const ring = Math.abs(Math.hypot(x, y) - 30);

  // The blurred layer: the shapes don't overlap, so their blurred colours just add up.
  let col = [...TILE];
  let alpha = 0;
  const glow = [0, 0, 0];
  for (const arc of arcs) {
    const a = blurred(arcDistance(x, y, arc), 8);
    alpha += a;
    for (let i = 0; i < 3; i++) glow[i] += arc.glow[i] * a;
  }
  const a = blurred(ring, 5) * 0.6;
  alpha += a;
  for (let i = 0; i < 3; i++) glow[i] += 255 * a;
  col = col.map((v, i) => v * (1 - Math.min(1, alpha)) + glow[i]);

  // The sharp strokes on top.
  for (const arc of arcs) if (arcDistance(x, y, arc) <= 4.5) col = [...arc.core];
  if (ring <= 3) col = [244, 245, 248];
  return [...col.map((v) => Math.min(255, Math.max(0, v))), 255];
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

function render(SIZE, maskable) {
  const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 4 + 1)] = 0;
    for (let x = 0; x < SIZE; x++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const s = sample(((x + (sx + 0.5) / SS) * 256) / SIZE, ((y + (sy + 0.5) / SS) * 256) / SIZE, maskable);
          acc[0] += s[0] * s[3];
          acc[1] += s[1] * s[3];
          acc[2] += s[2] * s[3];
          acc[3] += s[3];
        }
      }
      const o = y * (SIZE * 4 + 1) + 1 + x * 4;
      const a = acc[3];
      raw[o] = a ? Math.round(acc[0] / a) : 0;
      raw[o + 1] = a ? Math.round(acc[1] / a) : 0;
      raw[o + 2] = a ? Math.round(acc[2] / a) : 0;
      raw[o + 3] = Math.round(a / (SS * SS));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const [name, size, maskable] of [
  ['icon-256.png', 256, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
]) {
  const png = render(size, maskable);
  const out = new URL(`../public/${name}`, import.meta.url);
  writeFileSync(out, png);
  console.log(`wrote ${out.pathname} (${png.length} bytes)`);
}
