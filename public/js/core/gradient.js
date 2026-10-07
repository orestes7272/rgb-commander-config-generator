// Colour gradients across the panel, shared by the Gradient tool and the
// animated Gradient effect.

import { rgbToHsv, hsvToRgb, mixColor, isOff, sameColor } from './color.js';
import { setControlColor, frameColors } from './project.js';

export const DIRECTIONS = [
  ['left-right', 'Left → right'],
  ['right-left', 'Right → left'],
  ['top-bottom', 'Top → bottom'],
  ['bottom-top', 'Bottom → top'],
  ['ring', 'Around the panel'],
];

export const SPACINGS = [
  ['even', 'Evenly, button by button'],
  ['distance', 'By distance on the panel'],
];

export const BLENDS = [
  ['rgb', 'Smooth mix'],
  ['hue', 'Vivid (around the colour wheel)'],
];

/**
 * Where each control sits along a direction, 0..1.
 * 'even' gives every column of buttons its own step, so a 3-colour gradient
 * doesn't put the middle colour in an empty gap between two clusters.
 */
export function positions(controls, direction = 'left-right', spacing = 'distance') {
  const out = new Map();
  if (!controls.length) return out;
  if (direction === 'ring') {
    const cx = controls.reduce((n, c) => n + c.x, 0) / controls.length;
    const cy = controls.reduce((n, c) => n + c.y, 0) / controls.length;
    for (const c of controls) out.set(c.id, (Math.atan2(c.y - cy, c.x - cx) / (2 * Math.PI) + 1) % 1);
    return out;
  }
  const axis = direction === 'top-bottom' || direction === 'bottom-top' ? 'y' : 'x';
  const flip = direction === 'right-left' || direction === 'bottom-top';
  const values = controls.map((c) => c[axis]);
  let place;
  if (spacing === 'even') {
    const steps = [...new Set(values)].sort((a, b) => a - b);
    place = (v) => (steps.length > 1 ? steps.indexOf(v) / (steps.length - 1) : 0);
  } else {
    const min = Math.min(...values);
    const span = Math.max(...values) - min || 1;
    place = (v) => (v - min) / span;
  }
  for (const c of controls) out.set(c.id, flip ? 1 - place(c[axis]) : place(c[axis]));
  return out;
}

/**
 * A colour between a and b. 'hue' travels the short way around the colour
 * wheel, so red→blue passes through magenta rather than a dim purple.
 */
export function blend(a, b, t, mode = 'rgb') {
  if (mode !== 'hue') return mixColor(a, b, t);
  const A = rgbToHsv(a);
  const B = rgbToHsv(b);
  // Greys and off have no hue of their own: borrow the other colour's. Off has
  // no saturation either, so off→blue darkens blue instead of greying it.
  const ha = A.s ? A.h : B.h;
  const hb = B.s ? B.h : A.h;
  const sa = A.v ? A.s : B.s;
  const sb = B.v ? B.s : A.s;
  let d = hb - ha;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return hsvToRgb({ h: ha + d * t, s: sa + (sb - sa) * t, v: A.v + (B.v - A.v) * t });
}

/** Colour at t (0..1) with the stops spread evenly from first to last. */
export function colorAt(stops, t, mode = 'rgb') {
  if (stops.length === 1) return { ...stops[0] };
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x));
  return blend(stops[i], stops[i + 1], x - i, mode);
}

/** Colour at t on a loop where the last stop blends back into the first. */
export function loopColorAt(stops, t, mode = 'rgb') {
  const n = stops.length;
  if (n === 1) return { ...stops[0] };
  const x = (((t % 1) + 1) % 1) * n;
  const i = Math.floor(x) % n;
  return blend(stops[i], stops[(i + 1) % n], x - Math.floor(x), mode);
}

/** Paint a gradient onto a frame's pins (mutates them). */
export function applyGradient(framePins, controls, { stops, direction = 'left-right', spacing = 'even', blend: mode = 'rgb' }) {
  const lit = controls.filter((c) => c.pins);
  const pos = positions(lit, direction, spacing);
  // Around the panel the ends meet, so loop back to the first colour.
  const at = direction === 'ring' ? loopColorAt : colorAt;
  for (const c of lit) setControlColor(framePins, c.pins, at(stops, pos.get(c.id), mode));
}

/**
 * Sensible starting colours, taken from the scheme: its two most used colours,
 * or its colour plus the brush, or failing those the brush hue turned a third
 * of the way round the wheel.
 */
export function defaultStops(color, framePins, controls) {
  const plain = ({ r, g, b }) => ({ r, g, b });
  const used = framePins ? frameColors(framePins, controls).map((c) => plain(c.rgb)).filter((rgb) => !isOff(rgb)) : [];
  if (used.length >= 2) return used.slice(0, 2);
  const brush = isOff(color) ? { r: 0, g: 0, b: 255 } : plain(color);
  const first = used[0] || brush;
  if (!sameColor(first, brush)) return [first, brush];
  const hsv = rgbToHsv(first);
  return [first, hsvToRgb({ h: hsv.h + 120, s: hsv.s || 1, v: hsv.v || 255 })];
}
