// Control panel layouts. Coordinates and sizes are millimetres, so a layout can
// be measured straight off the real panel.

import { BOARDS, DEFAULT_BOARD, getBoard, CHANNEL_ORDERS } from './boards.js';

export const CONTROL_KINDS = {
  button: { label: 'Button', hint: '30 mm', r: 15 },
  small: { label: 'Small button', hint: '24 mm', r: 12 },
  large: { label: 'Big button', hint: '60 mm', r: 30 },
  stick: { label: 'Joystick', hint: 'ball top', r: 17 },
  trackball: { label: 'Trackball', hint: '3 inch', r: 34 },
  spinner: { label: 'Spinner', hint: 'knob', r: 20 },
  led: { label: 'LED', hint: '5 mm', r: 6 },
};

export const LAYOUT_LIMITS = { minSize: 100, maxSize: 3000, maxControls: 256 };

export function radiusOf(control) {
  return control.r || CONTROL_KINDS[control.kind]?.r || 15;
}

/** Names RGBcommander understands in <control name="…"/> (see the rgbcmdd.xml docs). */
export const RGBCMD_NAME_RE = /^(P[1-8]_[A-Z0-9_-]+|ALWAYS_(ON|OFF)[A-Z0-9_-]*)$/;

export function standardControlNames() {
  const names = [];
  for (let p = 1; p <= 4; p++) {
    for (let b = 1; b <= 10; b++) names.push(`P${p}_BUTTON${b}`);
    names.push(`P${p}_START`, `P${p}_COIN`, `P${p}_JOYSTICK`, `P${p}_TRACKBALL`, `P${p}_SPINNER`);
  }
  names.push('ALWAYS_ON_SAVE_GAME', 'ALWAYS_ON_LOAD_GAME', 'ALWAYS_ON_4-8WAY', 'ALWAYS_ON_SWITCH', 'ALWAYS_ON_EXIT', 'ALWAYS_ON_HOTKEY');
  return names;
}

/** P1_BUTTON3 <-> P2_BUTTON3 */
export function mirrorName(name) {
  const m = /^P([12])_(.+)$/.exec(name || '');
  if (!m) return null;
  return `P${m[1] === '1' ? 2 : 1}_${m[2]}`;
}

export function playerOf(name) {
  const m = /^P(\d)_/.exec(name || '');
  return m ? Number(m[1]) : null;
}

let idCounter = 0;
export function controlId() {
  idCounter = (idCounter + 1) % 1e6;
  return 'c' + Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 6) + idCounter.toString(36);
}

const portWiring = (port) => ({ mode: 'port', port, order: 'auto' });
const noLight = () => ({ mode: 'none' });

function ctl(name, label, kind, x, y, wiring) {
  return { id: controlId(), name, label, kind, x: Math.round(x), y: Math.round(y), wiring };
}

// Button offsets from the joystick centre: Vewlix-style arced rows.
const TOP_ROW = [[72, -20], [108, -31], [145, -31], [182, -27]];
const BOTTOM_ROW = [[68, 17], [104, 6], [141, 6], [178, 10]];

function playerCluster(p, sx, sy, buttons, firstPort, extraPorts) {
  const perRow = buttons / 2;
  const out = [ctl(`P${p}_JOYSTICK`, '', 'stick', sx, sy, noLight())];
  let port = firstPort;
  for (let i = 0; i < perRow; i++) {
    const [dx, dy] = TOP_ROW[i];
    out.push(ctl(`P${p}_BUTTON${i + 1}`, String(i + 1), 'button', sx + dx, sy + dy, portWiring(port++)));
  }
  for (let i = 0; i < perRow; i++) {
    const [dx, dy] = BOTTOM_ROW[i];
    out.push(ctl(`P${p}_BUTTON${perRow + i + 1}`, String(perRow + i + 1), 'button', sx + dx, sy + dy, portWiring(port++)));
  }
  const [startPort, coinPort] = extraPorts;
  out.push(ctl(`P${p}_COIN`, 'COIN', 'small', sx + 108, sy - 105, coinPort ? portWiring(coinPort) : noLight()));
  out.push(ctl(`P${p}_START`, `${p}P`, 'small', sx + 145, sy - 105, startPort ? portWiring(startPort) : noLight()));
  return out;
}

function centre(layout) {
  let min = Infinity;
  let max = -Infinity;
  for (const c of layout.controls) {
    const r = radiusOf(c);
    min = Math.min(min, c.x - r);
    max = Math.max(max, c.x + r);
  }
  const dx = Math.round((layout.width - (max - min)) / 2 - min);
  for (const c of layout.controls) c.x += dx;
  return layout;
}

function base(width, height, controls, templateId) {
  return { version: 1, board: DEFAULT_BOARD, width, height, panelColor: '#17181d', template: templateId, controls };
}

export const TEMPLATES = [
  {
    id: 'two-player-6',
    name: '2 players · 6 buttons',
    description: 'Street Fighter style. P1 buttons on LED ports 1–6, start/coin on 7–8; P2 mirrored on 17–24.',
    build: () =>
      centre(base(640, 260, [...playerCluster(1, 120, 165, 6, 1, [7, 8]), ...playerCluster(2, 420, 165, 6, 17, [23, 24])], 'two-player-6')),
  },
  {
    id: 'two-player-8',
    name: '2 players · 8 buttons',
    description: 'Neo Geo / Vewlix 8-button. P1 on ports 1–10, P2 on ports 17–26.',
    build: () =>
      centre(base(760, 260, [...playerCluster(1, 120, 165, 8, 1, [9, 10]), ...playerCluster(2, 480, 165, 8, 17, [25, 26])], 'two-player-8')),
  },
  {
    id: 'two-player-6-trackball',
    name: '2 players · 6 buttons + trackball',
    description: 'Two 6-button clusters with a trackball and two admin buttons between them.',
    build: () => {
      const layout = base(900, 320, [...playerCluster(1, 110, 200, 6, 1, [7, 8]), ...playerCluster(2, 590, 200, 6, 17, [23, 24])], 'two-player-6-trackball');
      layout.controls.push(
        ctl('P1_TRACKBALL', '', 'trackball', 455, 205, portWiring(9)),
        ctl('ALWAYS_ON_HOTKEY', 'HOT', 'small', 415, 95, portWiring(10)),
        ctl('ALWAYS_ON_EXIT', 'EXIT', 'small', 495, 95, portWiring(11)),
      );
      return centre(layout);
    },
  },
  {
    id: 'four-player',
    name: '4 players · 4 buttons',
    description: 'Beat-em-up panel. Each player gets 4 buttons, start and coin (P1 ports 1–6, P2 7–12, P3 17–22, P4 23–28).',
    build: () => {
      const controls = [];
      const ports = [1, 7, 17, 23];
      [1, 2, 3, 4].forEach((p, i) => {
        const cluster = playerCluster(p, 90 + i * 290, 190, 4, ports[i], [ports[i] + 4, ports[i] + 5]);
        controls.push(...cluster);
      });
      return centre(base(1200, 300, controls, 'four-player'));
    },
  },
  {
    id: 'led-grid',
    name: 'LED port grid (32 ports)',
    description: 'Every Ultimate I/O LED port in board order. Handy when you just want to see what a file lights up.',
    build: () => {
      const controls = [];
      for (let i = 0; i < 16; i++) {
        controls.push(ctl(`LED${String(i + 1).padStart(2, '0')}`, String(i + 1), 'button', 40 + i * 48, 170, portWiring(i + 1)));
        controls.push(ctl(`LED${String(i + 17).padStart(2, '0')}`, String(i + 17), 'button', 40 + i * 48, 80, portWiring(i + 17)));
      }
      return base(800, 240, controls, 'led-grid');
    },
  },
];

export const DEFAULT_TEMPLATE = 'two-player-6';

export function buildTemplate(id = DEFAULT_TEMPLATE) {
  const t = TEMPLATES.find((x) => x.id === id) || TEMPLATES[0];
  return t.build();
}

// ---------------------------------------------------------------------------
// Validation (shared by the browser and the server)

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

function cleanWiring(w, board) {
  if (!w || typeof w !== 'object') return { mode: 'none' };
  switch (w.mode) {
    case 'port':
      if (!isInt(w.port, 1, board.portCount)) throw new Error(`LED port must be 1–${board.portCount}`);
      return { mode: 'port', port: w.port, order: w.order === 'auto' || CHANNEL_ORDERS.includes(w.order) ? w.order : 'auto' };
    case 'pins':
      for (const k of ['r', 'g', 'b']) if (!isInt(w[k], 1, board.pinCount)) throw new Error(`Pin numbers must be 1–${board.pinCount}`);
      return { mode: 'pins', r: w.r, g: w.g, b: w.b };
    case 'single':
      if (!isInt(w.pin, 1, board.pinCount)) throw new Error(`Pin numbers must be 1–${board.pinCount}`);
      return { mode: 'single', pin: w.pin, tint: /^#[0-9a-f]{6}$/i.test(w.tint || '') ? w.tint : '#ffffff' };
    default:
      return { mode: 'none' };
  }
}

/** Returns a cleaned copy of a layout, or throws with a readable message. */
export function sanitizeLayout(input) {
  if (!input || typeof input !== 'object') throw new Error('Layout must be an object');
  const boardId = BOARDS[input.board] ? input.board : DEFAULT_BOARD;
  const board = getBoard(boardId);
  const { minSize, maxSize, maxControls } = LAYOUT_LIMITS;
  const width = isNum(input.width) ? Math.round(input.width) : 800;
  const height = isNum(input.height) ? Math.round(input.height) : 300;
  if (width < minSize || width > maxSize || height < minSize || height > maxSize) throw new Error(`Panel size must be ${minSize}–${maxSize} mm`);
  if (!Array.isArray(input.controls)) throw new Error('Layout has no controls list');
  if (input.controls.length > maxControls) throw new Error(`A layout can have at most ${maxControls} controls`);
  const seen = new Set();
  const controls = input.controls.map((c, i) => {
    if (!c || typeof c !== 'object') throw new Error(`Control ${i + 1} is invalid`);
    const id = typeof c.id === 'string' && /^[\w-]{1,40}$/.test(c.id) && !seen.has(c.id) ? c.id : controlId();
    seen.add(id);
    const name = String(c.name ?? '').trim().slice(0, 40);
    if (!/^[\w.-]*$/.test(name)) throw new Error(`Control name "${name}" may only use letters, numbers, _ - and .`);
    if (!isNum(c.x) || !isNum(c.y)) throw new Error(`Control ${name || i + 1} has no position`);
    const out = {
      id,
      name,
      label: String(c.label ?? '').slice(0, 12),
      kind: CONTROL_KINDS[c.kind] ? c.kind : 'button',
      x: Math.round(Math.max(-maxSize, Math.min(maxSize * 2, c.x))),
      y: Math.round(Math.max(-maxSize, Math.min(maxSize * 2, c.y))),
      wiring: cleanWiring(c.wiring, board),
    };
    if (isNum(c.r) && c.r >= 3 && c.r <= 120) out.r = Math.round(c.r);
    return out;
  });
  const panelColor = /^#[0-9a-f]{6}$/i.test(input.panelColor || '') ? input.panelColor : '#17181d';
  return { version: 1, board: boardId, width, height, panelColor, template: String(input.template || '').slice(0, 40), controls };
}
