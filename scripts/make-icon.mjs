// Renders the app icons without any image libraries: a neon ring split into
// red, green and blue arcs around a white "button" ring, supersampled, written
// as PNGs. It matches public/favicon.svg. icon-256.png is used by the Unraid
// template and the desktop app; the 512 px ones by the web app manifest.
// "Maskable" icons fill the whole square and keep the art inside the middle
// 80%, so Android can crop them to its own shape.
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

// The art is drawn on a 256-unit square.
const SS = 4;
const C = 128;
const RING = 80;
const HALF_ARC = 46; // degrees either side of each arc's centre
const arcs = [
  { at: -90, core: [255, 107, 127], glow: [255, 45, 74] },
  { at: 30, core: [108, 240, 164], glow: [34, 212, 110] },
  { at: 150, core: [110, 163, 255], glow: [47, 123, 255] },
];
const inner = { r: 34, core: [244, 245, 248], glow: [255, 255, 255] };

// Distance from a point to an arc with round ends.
function arcDistance(px, py, arc) {
  const ang = (Math.atan2(py - C, px - C) * 180) / Math.PI;
  const off = ((ang - arc.at + 540) % 360) - 180;
  if (Math.abs(off) <= HALF_ARC) return Math.abs(Math.hypot(px - C, py - C) - RING);
  const end = ((arc.at + Math.sign(off) * HALF_ARC) * Math.PI) / 180;
  return Math.hypot(px - (C + RING * Math.cos(end)), py - (C + RING * Math.sin(end)));
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
  const strokes = [
    ...arcs.map((a) => ({ d: arcDistance(px, py, a), w: 7, ...a })),
    { d: Math.abs(Math.hypot(px - C, py - C) - inner.r), w: 5.5, ...inner },
  ];
  let col = [16, 17, 22];
  for (const s of strokes) {
    const glow = Math.exp(-(Math.max(0, s.d - s.w) ** 2) / (2 * 9 ** 2)) * 0.6;
    col = col.map((v, i) => v + s.glow[i] * glow);
  }
  for (const s of strokes) if (s.d <= s.w) col = s.core;
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
