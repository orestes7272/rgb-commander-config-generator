// Frame generators. Each effect takes the current scheme as its starting point
// and returns new frames; nothing here touches the DOM.
//
// run(ctx, params) receives:
//   ctx.frames    all frames of the scheme ({ ms, pins })
//   ctx.index     index of the current frame
//   ctx.controls  resolved controls ({ id, x, y, pins })
//   ctx.selection Set of selected control ids (may be empty)
//   ctx.color     the colour currently in the picker
//   ctx.pinCount
// and returns { mode: 'insert' | 'replace', frames: [{ ms, pins }] }.

import { hsvToRgb, scaleColor, mixColor, clampByte } from './color.js';
import { getControlColor, setControlColor } from './project.js';
import { positions, loopColorAt, defaultStops, DIRECTIONS, SPACINGS, BLENDS } from './gradient.js';

const lit = (controls) => controls.filter((c) => c.pins);

function scopeOf(ctx, scope) {
  const controls = lit(ctx.controls);
  if (scope === 'selection' && ctx.selection?.size) return controls.filter((c) => ctx.selection.has(c.id));
  return controls;
}

function orderControls(controls, order) {
  const list = controls.slice();
  if (!list.length) return list;
  const cx = list.reduce((n, c) => n + c.x, 0) / list.length;
  const cy = list.reduce((n, c) => n + c.y, 0) / list.length;
  const firstPin = (c) => (c.pins.single ? c.pins.single : Math.min(c.pins.r, c.pins.g, c.pins.b));
  const sorters = {
    'left-right': (a, b) => a.x - b.x || a.y - b.y,
    'right-left': (a, b) => b.x - a.x || a.y - b.y,
    'top-bottom': (a, b) => a.y - b.y || a.x - b.x,
    'bottom-top': (a, b) => b.y - a.y || a.x - b.x,
    ring: (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx),
    led: (a, b) => firstPin(a) - firstPin(b),
  };
  return list.sort(sorters[order] || sorters['left-right']);
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const frame = (pins, ms) => ({ pins, ms: Math.round(ms) });

const ORDER_OPTIONS = [
  ['left-right', 'Left → right'],
  ['right-left', 'Right → left'],
  ['top-bottom', 'Top → bottom'],
  ['bottom-top', 'Bottom → top'],
  ['ring', 'Around the panel'],
  ['led', 'LED port order'],
];
const SCOPE_OPTIONS = [
  ['all', 'All buttons'],
  ['selection', 'Selected buttons only'],
];

export const EFFECTS = [
  {
    id: 'fade',
    name: 'Fade',
    blurb: 'Smooth transition from this frame to another.',
    params: [
      { id: 'target', label: 'Fade to', type: 'select', options: [['next', 'Next frame'], ['first', 'First frame (loop)'], ['color', 'Picker colour'], ['off', 'Off']], default: 'next' },
      { id: 'steps', label: 'In-between frames', type: 'range', min: 1, max: 40, default: 6 },
      { id: 'ms', label: 'Time per step', type: 'range', min: 0, max: 255, unit: 'ms', default: 30 },
    ],
    run(ctx, p) {
      const base = ctx.frames[ctx.index].pins;
      let target;
      let appendTarget = false;
      if (p.target === 'next' && ctx.frames[ctx.index + 1]) target = ctx.frames[ctx.index + 1].pins;
      else if (p.target === 'first' || p.target === 'next') target = ctx.frames[0].pins;
      else {
        target = base.slice();
        const rgb = p.target === 'color' ? ctx.color : { r: 0, g: 0, b: 0 };
        for (const c of lit(ctx.controls)) setControlColor(target, c.pins, rgb);
        appendTarget = true;
      }
      const frames = [];
      for (let i = 1; i <= p.steps; i++) {
        const t = i / (p.steps + 1);
        frames.push(frame(base.map((v, k) => clampByte(v + (target[k] - v) * t)), p.ms));
      }
      if (appendTarget) frames.push(frame(target.slice(), ctx.frames[ctx.index].ms));
      return { mode: 'insert', frames };
    },
  },
  {
    id: 'breathe',
    name: 'Breathe',
    blurb: 'Slow pulse of the current colours.',
    params: [
      { id: 'steps', label: 'Frames per breath', type: 'range', min: 4, max: 64, default: 16 },
      { id: 'low', label: 'Dimmest point', type: 'range', min: 0, max: 90, unit: '%', default: 10 },
      { id: 'ms', label: 'Time per frame', type: 'range', min: 0, max: 255, unit: 'ms', default: 40 },
      { id: 'scope', label: 'Applies to', type: 'select', options: SCOPE_OPTIONS, default: 'all' },
    ],
    run(ctx, p) {
      const base = ctx.frames[ctx.index].pins;
      const targets = scopeOf(ctx, p.scope);
      const low = p.low / 100;
      const frames = [];
      for (let i = 0; i < p.steps; i++) {
        const level = low + (1 - low) * (0.5 + 0.5 * Math.cos((2 * Math.PI * i) / p.steps));
        const pins = base.slice();
        for (const c of targets) setControlColor(pins, c.pins, scaleColor(getControlColor(base, c.pins), level));
        frames.push(frame(pins, p.ms));
      }
      return { mode: 'replace', frames };
    },
  },
  {
    id: 'chase',
    name: 'Chase',
    blurb: 'A lit head with a fading tail runs across the panel.',
    params: [
      { id: 'order', label: 'Direction', type: 'select', options: ORDER_OPTIONS, default: 'left-right' },
      { id: 'head', label: 'Head colour', type: 'select', options: [['scheme', "Each button's own colour"], ['color', 'Picker colour']], default: 'scheme' },
      { id: 'tail', label: 'Tail length', type: 'range', min: 0, max: 6, default: 2 },
      { id: 'background', label: 'Resting brightness', type: 'range', min: 0, max: 100, unit: '%', default: 15 },
      { id: 'ms', label: 'Time per step', type: 'range', min: 0, max: 255, unit: 'ms', default: 60 },
      { id: 'bounce', label: 'Bounce back', type: 'toggle', default: false },
    ],
    run(ctx, p) {
      const base = ctx.frames[ctx.index].pins;
      const order = orderControls(lit(ctx.controls), p.order);
      const n = order.length;
      if (!n) return { mode: 'replace', frames: [frame(base.slice(), p.ms)] };
      const steps = [...Array(n).keys()];
      if (p.bounce && n > 2) for (let i = n - 2; i > 0; i--) steps.push(i);
      const bg = p.background / 100;
      const frames = steps.map((head, s) => {
        const pins = base.slice();
        const forward = !p.bounce || s < n;
        order.forEach((c, j) => {
          const d = forward ? head - j : j - head;
          const level = d === 0 ? 1 : d > 0 && d <= p.tail ? 1 - d / (p.tail + 1) : 0;
          const own = getControlColor(base, c.pins);
          const rest = scaleColor(own, bg);
          const hot = p.head === 'color' ? ctx.color : own;
          setControlColor(pins, c.pins, level > 0 ? mixColor(rest, hot, level) : rest);
        });
        return frame(pins, p.ms);
      });
      return { mode: 'replace', frames };
    },
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    blurb: 'Colour wheel sweeping across the buttons.',
    params: [
      { id: 'direction', label: 'Direction', type: 'select', options: ORDER_OPTIONS.filter(([id]) => id !== 'led'), default: 'left-right' },
      { id: 'frames', label: 'Frames', type: 'range', min: 6, max: 72, default: 24 },
      { id: 'spread', label: 'Rainbows across the panel', type: 'range', min: 0.25, max: 4, step: 0.25, default: 1 },
      { id: 'brightness', label: 'Brightness', type: 'range', min: 5, max: 100, unit: '%', default: 100 },
      { id: 'saturation', label: 'Saturation', type: 'range', min: 0, max: 100, unit: '%', default: 100 },
      { id: 'ms', label: 'Time per frame', type: 'range', min: 0, max: 255, unit: 'ms', default: 50 },
    ],
    run(ctx, p) {
      const base = ctx.frames[ctx.index].pins;
      const controls = lit(ctx.controls);
      const pos = positions(controls, p.direction);
      const v = Math.round((p.brightness / 100) * 255);
      const frames = [];
      for (let i = 0; i < p.frames; i++) {
        const pins = base.slice();
        for (const c of controls) {
          // Minus: the colours travel in the chosen direction as the frames advance.
          const h = 360 * (pos.get(c.id) * p.spread - i / p.frames);
          setControlColor(pins, c.pins, hsvToRgb({ h, s: p.saturation / 100, v }));
        }
        frames.push(frame(pins, p.ms));
      }
      return { mode: 'replace', frames };
    },
  },
  {
    id: 'gradient',
    name: 'Gradient',
    blurb: 'Your own colours flowing across the buttons.',
    params: [
      { id: 'colors', label: 'Colours', type: 'colors', min: 2, max: 4, default: null },
      { id: 'direction', label: 'Direction', type: 'select', options: DIRECTIONS, default: 'left-right' },
      { id: 'blend', label: 'Blend', type: 'select', options: BLENDS, default: 'rgb' },
      { id: 'spacing', label: 'Spacing', type: 'select', options: SPACINGS, default: 'even' },
      { id: 'frames', label: 'Frames', type: 'range', min: 4, max: 72, default: 24 },
      { id: 'spread', label: 'Gradients across the panel (0 = all together)', type: 'range', min: 0, max: 4, step: 0.25, default: 1 },
      { id: 'ms', label: 'Time per frame', type: 'range', min: 0, max: 255, unit: 'ms', default: 60 },
      { id: 'scope', label: 'Applies to', type: 'select', options: SCOPE_OPTIONS, default: 'all' },
    ],
    run(ctx, p) {
      const base = ctx.frames[ctx.index].pins;
      const stops = p.colors?.length >= 2 ? p.colors : defaultStops(ctx.color, base, ctx.controls);
      const controls = scopeOf(ctx, p.scope);
      const pos = positions(controls, p.direction, p.spacing);
      const frames = [];
      for (let i = 0; i < p.frames; i++) {
        const pins = base.slice();
        // The colours form a loop (last back to first), so the animation repeats seamlessly.
        for (const c of controls) setControlColor(pins, c.pins, loopColorAt(stops, pos.get(c.id) * p.spread - i / p.frames, p.blend));
        frames.push(frame(pins, p.ms));
      }
      return { mode: 'replace', frames };
    },
  },
  {
    id: 'blink',
    name: 'Blink',
    blurb: 'Flash the scheme, or just the selected buttons, on and off.',
    params: [
      { id: 'on', label: 'On for', type: 'range', min: 20, max: 2000, step: 10, unit: 'ms', default: 400 },
      { id: 'off', label: 'Off for', type: 'range', min: 20, max: 2000, step: 10, unit: 'ms', default: 400 },
      { id: 'level', label: 'Brightness when off', type: 'range', min: 0, max: 90, unit: '%', default: 0 },
      { id: 'scope', label: 'Applies to', type: 'select', options: SCOPE_OPTIONS, default: 'all' },
    ],
    run(ctx, p) {
      const base = ctx.frames[ctx.index].pins;
      const dim = base.slice();
      for (const c of scopeOf(ctx, p.scope)) setControlColor(dim, c.pins, scaleColor(getControlColor(base, c.pins), p.level / 100));
      return { mode: 'replace', frames: [frame(base.slice(), p.on), frame(dim, p.off)] };
    },
  },
  {
    id: 'sparkle',
    name: 'Sparkle',
    blurb: 'Random buttons twinkle over the scheme.',
    params: [
      { id: 'frames', label: 'Frames', type: 'range', min: 4, max: 60, default: 16 },
      { id: 'density', label: 'Buttons lit per frame', type: 'range', min: 5, max: 80, unit: '%', default: 20 },
      { id: 'color', label: 'Sparkle colour', type: 'select', options: [['white', 'White'], ['color', 'Picker colour']], default: 'white' },
      { id: 'ms', label: 'Time per frame', type: 'range', min: 0, max: 255, unit: 'ms', default: 80 },
      { id: 'scope', label: 'Applies to', type: 'select', options: SCOPE_OPTIONS, default: 'all' },
      { id: 'seed', label: 'Pattern', type: 'seed', default: 1 },
    ],
    run(ctx, p) {
      const base = ctx.frames[ctx.index].pins;
      const targets = scopeOf(ctx, p.scope);
      const rand = mulberry32(p.seed * 7919);
      const sparkle = p.color === 'color' ? ctx.color : { r: 255, g: 255, b: 255 };
      const count = Math.max(1, Math.round((targets.length * p.density) / 100));
      const frames = [];
      for (let i = 0; i < p.frames; i++) {
        const pins = base.slice();
        const pool = targets.slice();
        for (let k = 0; k < count && pool.length; k++) {
          const c = pool.splice(Math.floor(rand() * pool.length), 1)[0];
          setControlColor(pins, c.pins, sparkle);
        }
        frames.push(frame(pins, p.ms));
      }
      return { mode: 'replace', frames };
    },
  },
];

export function defaultParams(effect) {
  return Object.fromEntries(effect.params.map((p) => [p.id, p.default]));
}

export function runEffect(id, ctx, params) {
  const effect = EFFECTS.find((e) => e.id === id);
  if (!effect) throw new Error(`Unknown effect ${id}`);
  return effect.run(ctx, { ...defaultParams(effect), ...params });
}

// ---------------------------------------------------------------------------
// Starting points for new schemes

export const STARTERS = [
  { id: 'blank', name: 'Blank', blurb: 'Everything off.' },
  { id: 'solid', name: 'Solid colour', blurb: 'Every button in the picker colour.' },
  { id: 'channel-test', name: 'Wiring test: all red', blurb: 'Buttons that show blue or green have their channel order wrong in the layout.' },
  { id: 'port-walk', name: 'Wiring test: port walk', blurb: 'Lights LED ports one at a time, 1 to 32, so you can check which button is which.' },
];

export function buildStarter(id, { controls, pinCount, portCount, portPins, color }) {
  const blank = () => new Array(pinCount).fill(0);
  if (id === 'solid' || id === 'channel-test') {
    const pins = blank();
    const rgb = id === 'solid' ? color : { r: 255, g: 0, b: 0 };
    for (const c of lit(controls)) setControlColor(pins, c.pins, rgb);
    return [frame(pins, 200)];
  }
  if (id === 'port-walk') {
    const frames = [];
    for (let port = 1; port <= portCount; port++) {
      const pins = blank();
      const p = portPins(port);
      pins[p.r - 1] = 255;
      pins[p.g - 1] = 255;
      pins[p.b - 1] = 255;
      frames.push(frame(pins, 1000));
    }
    return frames;
  }
  return [frame(blank(), 200)];
}
