// Colour helpers.
//
// LED values are PWM duty cycles: light output is linear in the value, so an
// LED at 64/255 emits a quarter of its full light. Screens expect gamma-encoded
// sRGB, where rgb(0,0,64) is almost black. ledToScreen() converts duty cycles to
// the sRGB colour that emits the same relative light, which is much closer to
// what the button looks like in the cabinet.

export const clampByte = (v) => Math.max(0, Math.min(255, Math.round(Number(v) || 0)));

export const OFF = Object.freeze({ r: 0, g: 0, b: 0 });

export function sameColor(a, b) {
  return a.r === b.r && a.g === b.g && a.b === b.b;
}

export function rgbToHsv({ r, g, b }) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

/** h: 0-360, s: 0-1, v: 0-255 (the brightest channel). */
export function hsvToRgb({ h, s, v }) {
  h = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return { r: clampByte(r + m), g: clampByte(g + m), b: clampByte(b + m) };
}

/** Keep a colour's hue and saturation but give it a new brightness (0-255). */
export function withBrightness(rgb, v) {
  const max = Math.max(rgb.r, rgb.g, rgb.b);
  v = clampByte(v);
  if (!max) return { r: v, g: v, b: v };
  const k = v / max;
  return { r: clampByte(rgb.r * k), g: clampByte(rgb.g * k), b: clampByte(rgb.b * k) };
}

export function scaleColor(rgb, factor) {
  return { r: clampByte(rgb.r * factor), g: clampByte(rgb.g * factor), b: clampByte(rgb.b * factor) };
}

export function mixColor(a, b, t) {
  return {
    r: clampByte(a.r + (b.r - a.r) * t),
    g: clampByte(a.g + (b.g - a.g) * t),
    b: clampByte(a.b + (b.b - a.b) * t),
  };
}

export function toHex({ r, g, b }) {
  return '#' + [r, g, b].map((v) => clampByte(v).toString(16).padStart(2, '0')).join('');
}

export function parseHex(str) {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(str || '').trim());
  if (!m) return null;
  let hex = m[1];
  if (hex.length === 3) hex = [...hex].map((c) => c + c).join('');
  const n = parseInt(hex, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** "0,0,64" style, as used in rgbcmdd.xml. */
export const toTriplet = ({ r, g, b }) => `${r},${g},${b}`;

const SRGB = Array.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  const e = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(e * 255);
});

/** Screen colour for an LED value. mode 'raw' skips the light-output conversion. */
export function ledToScreen(rgb, mode = 'led') {
  if (mode === 'raw') return { r: rgb.r, g: rgb.g, b: rgb.b };
  return { r: SRGB[rgb.r], g: SRGB[rgb.g], b: SRGB[rgb.b] };
}

export const cssRgb = ({ r, g, b }) => `rgb(${r} ${g} ${b})`;

/** Relative luminance of a screen colour (for picking readable text). */
export function luminance({ r, g, b }) {
  const lin = (c) => {
    c /= 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export const isOff = ({ r, g, b }) => r === 0 && g === 0 && b === 0;

// Full-brightness LED hues. RGB LEDs have a strong green die, so the warm hues
// use less green than their on-screen equivalents would.
export const LED_PALETTE = [
  { name: 'Red', r: 255, g: 0, b: 0 },
  { name: 'Orange', r: 255, g: 60, b: 0 },
  { name: 'Amber', r: 255, g: 120, b: 0 },
  { name: 'Yellow', r: 255, g: 190, b: 0 },
  { name: 'Lime', r: 120, g: 255, b: 0 },
  { name: 'Green', r: 0, g: 255, b: 0 },
  { name: 'Spring', r: 0, g: 255, b: 100 },
  { name: 'Cyan', r: 0, g: 255, b: 255 },
  { name: 'Azure', r: 0, g: 120, b: 255 },
  { name: 'Blue', r: 0, g: 0, b: 255 },
  { name: 'Indigo', r: 70, g: 0, b: 255 },
  { name: 'Purple', r: 130, g: 0, b: 255 },
  { name: 'Violet', r: 200, g: 0, b: 255 },
  { name: 'Magenta', r: 255, g: 0, b: 255 },
  { name: 'Hot pink', r: 255, g: 0, b: 110 },
  { name: 'Rose', r: 255, g: 40, b: 60 },
  { name: 'White', r: 255, g: 255, b: 255 },
  { name: 'Warm white', r: 255, g: 150, b: 60 },
];

/** A human name for a colour: the nearest palette hue plus brightness. */
export function describeColor(rgb) {
  if (isOff(rgb)) return 'Off';
  const { h, s, v } = rgbToHsv(rgb);
  const pct = Math.round((v / 255) * 100);
  let name;
  if (s < 0.15) name = 'White';
  else {
    let best = null;
    for (const p of LED_PALETTE) {
      const ph = rgbToHsv(p);
      if (ph.s < 0.5) continue;
      const d = Math.min(Math.abs(ph.h - h), 360 - Math.abs(ph.h - h));
      if (!best || d < best.d) best = { d, name: p.name };
    }
    name = best.name;
    if (s < 0.6) name = 'Pale ' + name.toLowerCase();
  }
  return pct >= 100 ? name : `${name} ${pct}%`;
}
