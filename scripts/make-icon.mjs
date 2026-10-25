// Renders the app icons without any image libraries: three red, green and
// blue light waves, a third of a wavelength apart, blended like light inside a
// ring, supersampled, written as PNGs. It matches public/favicon.svg.
// icon-256.png is used by the Unraid template and the desktop app; the 512 px
// ones by the web app manifest. "Maskable" icons fill the whole square and
// keep the art inside the middle 80%, so Android can crop them to its own shape.
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

// The art is drawn on a 256-unit square.
const SS = 4;
const C = 128;
const DISC = 96; // the waves are clipped to this circle
const RING = 106; // the outline ring around it
const AMP = 40;
const LEN = 160; // wavelength
const HALF = 7; // half the wave's stroke width
const waves = [
  { shift: 0, c: [255, 42, 61] },
  { shift: LEN / 3, c: [34, 255, 102] },
  { shift: (2 * LEN) / 3, c: [42, 92, 255] },
];

// Approximate distance from a point to y = C - AMP * sin(...).
function waveDistance(px, py, w) {
  const k = (2 * Math.PI) / LEN;
  const t = k * (px - w.shift);
  const slope = AMP * k * Math.cos(t);
  return Math.abs(py - (C - AMP * Math.sin(t))) / Math.sqrt(1 + slope * slope);
}

function sample(px, py, maskable) {
  if (maskable) {
    px = C + (px - C) / 0.8;
    py = C + (py - C) / 0.8;
  } else {
    // rounded-square background
    const r = 56;
    const qx = Math.max(Math.abs(px - C) - (C - r), 0);
    const qy = Math.max(Math.abs(py - C) - (C - r), 0);
    if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];
  }
  const d = Math.hypot(px - C, py - C);
  if (Math.abs(d - RING) <= 5) return [42, 46, 57, 255];
  if (d > RING) return [16, 17, 22, 255];
  let col = [18, 20, 26];
  if (d > DISC) return [...col, 255];
  for (const w of waves) {
    const g = Math.exp(-(Math.max(0, waveDistance(px, py, w) - HALF) ** 2) / (2 * 8 ** 2)) * 0.45;
    col = col.map((v, i) => v + w.c[i] * g);
  }
  // Lit strokes combine like light (screen blend), so crossings go white.
  for (const w of waves) {
    if (waveDistance(px, py, w) <= HALF) col = col.map((v, i) => 255 - ((255 - Math.min(255, v)) * (255 - w.c[i])) / 255);
  }
  return [...col.map((v) => Math.min(255, v)), 255];
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
