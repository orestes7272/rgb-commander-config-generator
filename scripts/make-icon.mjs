// Renders public/icon-256.png (used by the Unraid template) without any image
// libraries: four glowing arcade buttons, supersampled, written as a PNG.
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const SIZE = 256;
const SS = 4;
const buttons = [
  { x: 72, y: 96, c: [255, 45, 85] },
  { x: 160, y: 80, c: [47, 123, 255] },
  { x: 96, y: 180, c: [255, 196, 0] },
  { x: 184, y: 168, c: [46, 224, 122] },
];
const R = 34;

function sample(px, py) {
  // rounded-square background
  const r = 56;
  const qx = Math.max(Math.abs(px - 128) - (128 - r), 0);
  const qy = Math.max(Math.abs(py - 128) - (128 - r), 0);
  if (Math.hypot(qx, qy) > r) return [0, 0, 0, 0];
  let col = [16, 17, 22];
  for (const b of buttons) {
    const d = Math.hypot(px - b.x, py - b.y);
    if (d > R) {
      const glow = Math.exp(-((d - R) ** 2) / (2 * 14 ** 2)) * 0.55;
      col = col.map((v, i) => v + b.c[i] * glow);
    }
  }
  for (const b of buttons) {
    const d = Math.hypot(px - b.x, py - b.y);
    if (d <= R + 5 && d > R) col = [10, 11, 14];
    if (d <= R) {
      const hl = Math.max(0, 1 - Math.hypot(px - (b.x - R * 0.3), py - (b.y - R * 0.35)) / (R * 0.75));
      const edge = Math.max(0, (d / R - 0.6) / 0.4) * 0.35;
      col = b.c.map((v) => v * (1 - edge) + 255 * hl * 0.55);
    }
  }
  return [...col.map((v) => Math.min(255, v)), 255];
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const acc = [0, 0, 0, 0];
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const s = sample(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS);
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

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
const out = new URL('../public/icon-256.png', import.meta.url);
writeFileSync(out, png);
console.log(`wrote ${out.pathname} (${png.length} bytes)`);
