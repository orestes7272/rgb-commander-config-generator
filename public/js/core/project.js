// Lighting schemes ("projects").
//
// A scheme stores each frame as raw pin values, exactly what goes into the
// .rgba file. Colours are read and written through a control's wiring, so the
// preview always shows what the board will really do, BGR header and all.

import { BOARDS, DEFAULT_BOARD, getBoard, resolveWiring } from './boards.js';
import { clampByte, parseHex } from './color.js';
import {
  parseRgba,
  serializeRgba,
  splitDelay,
  expandToPins,
  validateFileName,
  contentHash,
  MAX_FRAMES,
} from './rgba.js';

export const MAX_HOLD_MS = 60000;
export const DEFAULT_FRAME_MS = 200;

export function newId(prefix = 'p') {
  return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function blankPins(pinCount) {
  return new Array(pinCount).fill(0);
}

export function newFrame(pinCount, ms = DEFAULT_FRAME_MS, pins = null) {
  return { id: newId('f'), ms, pins: pins ? pins.slice() : blankPins(pinCount) };
}

export function createProject({ name = 'New scheme', fileName = 'custom_scheme', board = DEFAULT_BOARD, frames, notes = '' } = {}) {
  const b = getBoard(board);
  const now = new Date().toISOString();
  return {
    id: newId('p'),
    name,
    fileName,
    notes,
    board: b.id,
    frames: frames?.length ? frames : [newFrame(b.pinCount)],
    createdAt: now,
    updatedAt: now,
    rev: 0,
    publishedAt: null,
  };
}

// ---------------------------------------------------------------------------
// Reading and writing control colours

/** Resolve every control in a layout to its pins on the layout's board. */
export function resolveControls(layout) {
  const board = getBoard(layout?.board);
  return (layout?.controls || []).map((c) => ({ ...c, pins: resolveWiring(c.wiring, board) }));
}

export function getControlColor(framePins, pins) {
  if (!pins) return null;
  if (pins.single) {
    const v = framePins[pins.single - 1] ?? 0;
    const tint = parseHex(pins.tint) || { r: 255, g: 255, b: 255 };
    return { r: Math.round((tint.r * v) / 255), g: Math.round((tint.g * v) / 255), b: Math.round((tint.b * v) / 255), level: v };
  }
  return { r: framePins[pins.r - 1] ?? 0, g: framePins[pins.g - 1] ?? 0, b: framePins[pins.b - 1] ?? 0 };
}

/** Mutates framePins. Single-colour LEDs take the colour's brightest channel. */
export function setControlColor(framePins, pins, rgb) {
  if (!pins) return;
  if (pins.single) {
    framePins[pins.single - 1] = clampByte(Math.max(rgb.r, rgb.g, rgb.b));
    return;
  }
  framePins[pins.r - 1] = clampByte(rgb.r);
  framePins[pins.g - 1] = clampByte(rgb.g);
  framePins[pins.b - 1] = clampByte(rgb.b);
}

/** Pins a set of resolved controls touch. */
export function pinsOf(controls) {
  const set = new Set();
  for (const c of controls) {
    if (!c.pins) continue;
    if (c.pins.single) set.add(c.pins.single);
    else set.add(c.pins.r).add(c.pins.g).add(c.pins.b);
  }
  return set;
}

/** Distinct colours in a frame, most used first: [{ rgb, ids }] */
export function frameColors(framePins, controls) {
  const map = new Map();
  for (const c of controls) {
    if (!c.pins || c.pins.single) continue;
    const rgb = getControlColor(framePins, c.pins);
    const key = `${rgb.r},${rgb.g},${rgb.b}`;
    if (!map.has(key)) map.set(key, { rgb, ids: [] });
    map.get(key).ids.push(c.id);
  }
  return [...map.values()].sort((a, b) => b.ids.length - a.ids.length);
}

// ---------------------------------------------------------------------------
// Export / import

/** Frames as they will be written: long holds split into repeated frames. */
export function exportFrames(project) {
  const out = [];
  for (const f of project.frames) {
    for (const delay of splitDelay(f.ms)) out.push({ values: f.pins, delay });
  }
  return out;
}

export function projectToRgba(project, { eol = '\r\n' } = {}) {
  return serializeRgba(exportFrames(project), { eol });
}

/** Content hash of what a scheme would publish (formatting-independent). */
export function projectHash(project) {
  return contentHash(exportFrames(project), getBoard(project.board).pinCount);
}

/** Content hash of an existing .rgba file, or null when it cannot be read. */
export function fileHash(text, board = DEFAULT_BOARD) {
  try {
    return contentHash(parseRgba(text).frames, getBoard(board).pinCount);
  } catch {
    return null;
  }
}

/** Build a scheme from .rgba text. */
export function projectFromRgba(text, { name, fileName, board = DEFAULT_BOARD } = {}) {
  const { frames, warnings } = parseRgba(text);
  const b = getBoard(board);
  const lengths = new Set(frames.map((f) => f.values.length));
  const notes = [];
  if (!lengths.has(b.pinCount) || lengths.size > 1) {
    notes.push(`Frames had ${[...lengths].join('/')} values; they were repeated across all ${b.pinCount} pins, the same way RGBcommander plays them.`);
  }
  const project = createProject({
    name: name || fileName || 'Imported scheme',
    fileName: fileName || 'imported',
    board: b.id,
    frames: frames.map((f) => ({ id: newId('f'), ms: f.delay, pins: expandToPins(f.values, b.pinCount) })),
  });
  return { project, warnings: [...warnings, ...notes] };
}

// ---------------------------------------------------------------------------
// Validation (shared by the browser and the server)

export function sanitizeProject(input) {
  if (!input || typeof input !== 'object') throw new Error('Scheme must be an object');
  const board = BOARDS[input.board] ? input.board : DEFAULT_BOARD;
  const { pinCount } = getBoard(board);
  const name = String(input.name ?? '').trim().slice(0, 80) || 'Untitled scheme';
  const fileName = String(input.fileName ?? '').trim();
  const nameError = validateFileName(fileName);
  if (nameError) throw new Error(nameError);
  if (!Array.isArray(input.frames) || !input.frames.length) throw new Error('A scheme needs at least one frame');
  if (input.frames.length > MAX_FRAMES) throw new Error(`A scheme can have at most ${MAX_FRAMES} frames`);
  const frames = input.frames.map((f, i) => {
    if (!f || !Array.isArray(f.pins) || f.pins.length !== pinCount) throw new Error(`Frame ${i + 1} must have ${pinCount} pin values`);
    const pins = f.pins.map((v) => {
      if (!Number.isInteger(v) || v < 0 || v > 255) throw new Error(`Frame ${i + 1} has a pin value outside 0–255`);
      return v;
    });
    const ms = Number(f.ms);
    if (!Number.isFinite(ms) || ms < 0 || ms > MAX_HOLD_MS) throw new Error(`Frame ${i + 1} duration must be 0–${MAX_HOLD_MS} ms`);
    const id = typeof f.id === 'string' && /^[\w-]{1,40}$/.test(f.id) ? f.id : newId('f');
    return { id, ms: Math.round(ms), pins };
  });
  const expanded = frames.reduce((n, f) => n + splitDelay(f.ms).length, 0);
  if (expanded > MAX_FRAMES) throw new Error(`Long frames are split into 255 ms pieces; this scheme would need ${expanded} frames (limit ${MAX_FRAMES})`);
  return {
    name,
    fileName,
    notes: String(input.notes ?? '').slice(0, 4000),
    board,
    frames,
  };
}

/** Total hold time of a scheme in ms (frame delays only). */
export function totalMs(project) {
  return project.frames.reduce((n, f) => n + f.ms, 0);
}
