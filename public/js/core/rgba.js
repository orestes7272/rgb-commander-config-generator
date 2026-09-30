// Reading and writing RGBcommander .rgba animation files.
//
// Behaviour below was confirmed against RGBcommander 0.4.0.5
// (ControlPanel::LoadAnimations / ControlPanel::RGBAthread):
//
//   <anim>
//   	<frm dec="v1,v2,...,vN"/>   one element per frame, one value per LED pin
//   	<tms dec="t1,t2,...,tF"/>   one delay per frame, in milliseconds
//   </anim>
//
// * Commas become whitespace and values are read with `>> int`, so line breaks
//   and tabs inside the attribute are harmless.
// * Every value is stored as an unsigned byte: anything outside 0-255 wraps
//   (300 becomes 44). This applies to frame delays too, so one frame can be
//   held for at most 255 ms.
// * If a frame has fewer values than the board has pins, the values repeat
//   from the start (a 32-value frame on a 96-pin board is shown three times).
// * The tms list must have one entry per frame; the daemon reads past the end
//   of the list otherwise.
// * Only the `dec` attribute is understood.

export const MAX_PIN_VALUE = 255;
export const MAX_FRAME_DELAY = 255;
export const MAX_FRAMES = 2000;

export class RgbaError extends Error {}

const wrapByte = (v) => ((v % 256) + 256) % 256;

function readNumbers(raw, what, warnings) {
  const tokens = raw.split(/[\s,]+/).filter(Boolean);
  const out = [];
  let wrapped = 0;
  for (const token of tokens) {
    if (!/^[+-]?\d+$/.test(token)) throw new RgbaError(`${what} contains "${token}", which is not a whole number`);
    const n = parseInt(token, 10);
    if (n < 0 || n > 255) wrapped++;
    out.push(wrapByte(n));
  }
  if (wrapped) warnings.push(`${what}: ${wrapped} value(s) outside 0–255 were wrapped the same way RGBcommander does`);
  return out;
}

function decAttribute(attrs) {
  const m = /\bdec\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
  return m ? (m[1] ?? m[2]) : null;
}

/**
 * Parse .rgba text.
 * @returns {{ frames: {values: number[], delay: number}[], warnings: string[] }}
 */
export function parseRgba(text) {
  if (typeof text !== 'string' || !text.trim()) throw new RgbaError('The file is empty');
  const src = text.replace(/^﻿/, '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/<anim[\s>]/i.test(src)) throw new RgbaError('Not an RGBcommander animation: no <anim> element found');

  const warnings = [];
  const frames = [];
  for (const m of src.matchAll(/<frm\b([^>]*)>/gi)) {
    const dec = decAttribute(m[1]);
    if (dec == null) throw new RgbaError(`Frame ${frames.length + 1} has no dec="…" attribute (RGBcommander only reads dec)`);
    const values = readNumbers(dec, `Frame ${frames.length + 1}`, warnings);
    if (!values.length) throw new RgbaError(`Frame ${frames.length + 1} has no values`);
    frames.push({ values, delay: 0 });
  }
  if (!frames.length) throw new RgbaError('The animation has no <frm> frames');
  if (frames.length > MAX_FRAMES) throw new RgbaError(`Too many frames (${frames.length}); the limit is ${MAX_FRAMES}`);

  const tmsMatches = [...src.matchAll(/<tms\b([^>]*)>/gi)];
  let delays = [];
  if (!tmsMatches.length) {
    warnings.push('No <tms> element: RGBcommander needs one delay per frame. Using 100 ms per frame.');
  } else {
    if (tmsMatches.length > 1) warnings.push('More than one <tms> element; only the first is used');
    const dec = decAttribute(tmsMatches[0][1]);
    if (dec == null) warnings.push('<tms> has no dec="…" attribute. Using 100 ms per frame.');
    else delays = readNumbers(dec, 'Frame delays', warnings);
  }
  if (delays.length && delays.length < frames.length) {
    warnings.push(`Only ${delays.length} delay(s) for ${frames.length} frames; RGBcommander would read garbage for the rest. Missing delays were set to ${delays.at(-1)} ms.`);
  } else if (delays.length > frames.length) {
    warnings.push(`${delays.length} delays for ${frames.length} frames; the extra delays are ignored`);
  }
  frames.forEach((f, i) => {
    f.delay = delays[i] ?? (delays.length ? delays.at(-1) : 100);
  });

  const counts = new Set(frames.map((f) => f.values.length));
  if (counts.size > 1) warnings.push(`Frames have different lengths (${[...counts].join(', ')} values)`);
  return { frames, warnings };
}

/**
 * Serialize frames in the same layout as the files that ship with RGBcommander.
 * @param {{values: number[], delay: number}[]} frames
 * @param {{eol?: string}} [options]
 */
export function serializeRgba(frames, { eol = '\r\n' } = {}) {
  if (!Array.isArray(frames) || !frames.length) throw new RgbaError('An animation needs at least one frame');
  if (frames.length > MAX_FRAMES) throw new RgbaError(`Too many frames (${frames.length}); the limit is ${MAX_FRAMES}`);
  const byte = (v, what) => {
    if (!Number.isInteger(v) || v < 0 || v > 255) throw new RgbaError(`${what} must be a whole number from 0 to 255 (got ${v})`);
    return v;
  };
  let out = `<anim>${eol}`;
  frames.forEach((f, i) => {
    if (!f.values?.length) throw new RgbaError(`Frame ${i + 1} has no values`);
    out += `\t<frm dec="${f.values.map((v) => byte(v, `Frame ${i + 1} value`)).join(',')}"/>${eol}`;
  });
  out += `\t<tms dec="${frames.map((f, i) => byte(f.delay, `Frame ${i + 1} delay`)).join(',')}"/>${eol}`;
  out += `</anim>${eol}`;
  return out;
}

/**
 * Split a hold time into per-frame delays that each fit in a byte.
 * 1000 ms becomes [250, 250, 250, 250]; 200 ms stays [200].
 */
export function splitDelay(ms) {
  const total = Math.max(0, Math.round(Number(ms) || 0));
  if (total <= MAX_FRAME_DELAY) return [total];
  const parts = Math.ceil(total / MAX_FRAME_DELAY);
  const base = Math.floor(total / parts);
  const extra = total - base * parts;
  return Array.from({ length: parts }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Repeat a frame's values across all pins, the way the daemon does. */
export function expandToPins(values, pinCount) {
  return Array.from({ length: pinCount }, (_, i) => values[i % values.length]);
}

// Names RGBcommander treats specially in rgbadefault= / rgba=.
const RESERVED = new Set(['OFF', 'RANDOM', 'STATIC', 'static']);

/** Returns an error message, or null when the name (without .rgba) is usable. */
export function validateFileName(name) {
  if (typeof name !== 'string' || !name) return 'Enter a file name';
  if (name.length > 80) return 'Keep the file name under 80 characters';
  if (/\.rgba$/i.test(name)) return 'Leave off the .rgba extension; it is added for you';
  if (name.startsWith('.')) return 'The name cannot start with a dot (RGBcommander chokes on hidden "._" files)';
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(name)) return 'Use letters, numbers, - and _ only (it ends up in rgbcmdd.xml attributes)';
  if (RESERVED.has(name)) return `"${name}" is a reserved word in rgbcmdd.xml`;
  return null;
}

/** Turn a display name into a safe file name, e.g. "Mike blue" -> "custom_mike_blue". */
export function suggestFileName(displayName, prefix = '') {
  const slug = String(displayName || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  const cleanPrefix = String(prefix || '').replace(/[^A-Za-z0-9_-]/g, '');
  let name = cleanPrefix + (slug || 'scheme');
  if (!/^[A-Za-z0-9]/.test(name)) name = 'x' + name;
  return name;
}

/** "custom_mike_blue" -> "Mike blue": a display name for an imported file. */
export function prettyName(fileName, prefix = 'custom_') {
  let base = String(fileName || '').replace(/\.rgba$/i, '');
  if (prefix && base.toLowerCase().startsWith(prefix.toLowerCase()) && base.length > prefix.length) base = base.slice(prefix.length);
  const words = base.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return words ? words[0].toUpperCase() + words.slice(1) : 'Imported scheme';
}

/** 32-bit FNV-1a, as hex. Used to tell whether a published file matches a scheme. */
export function hashText(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Hash of a file's meaning rather than its bytes: formatting, line endings and
 * wrapped values don't matter, so a hand-formatted file matches its re-export.
 */
export function contentHash(frames, pinCount) {
  const norm = frames.map((f) => ({ values: pinCount ? expandToPins(f.values, pinCount) : f.values, delay: f.delay }));
  return hashText(serializeRgba(norm, { eol: '\n' }));
}
