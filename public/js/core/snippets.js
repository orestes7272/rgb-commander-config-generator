// rgbcmdd.xml snippets generated from the layout and a scheme.

import { getBoard } from './boards.js';
import { RGBCMD_NAME_RE } from './layouts.js';
import { getControlColor, resolveControls } from './project.js';
import { RGBCOMMANDER_COLOURS } from './rgbcommander-colours.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** <ledboard> block describing which pins each named control uses. */
export function ledboardSnippet(layout) {
  const board = getBoard(layout.board);
  const controls = resolveControls(layout);
  const warnings = [];
  const names = new Map();
  const pinOwners = new Map();
  const lines = [];

  for (const c of controls) {
    if (!c.pins) continue;
    if (!c.name) {
      warnings.push(`A ${c.kind} at ${c.x},${c.y} mm has no name, so it was left out.`);
      continue;
    }
    if (!RGBCMD_NAME_RE.test(c.name)) warnings.push(`${c.name} doesn't follow RGBcommander's naming pattern (Px_…, ALWAYS_ON…, ALWAYS_OFF…); it won't match game configs.`);
    if (names.has(c.name)) warnings.push(`${c.name} is used by more than one control; names must be unique.`);
    names.set(c.name, c);
    const pins = c.pins.single ? [c.pins.single, c.pins.single, c.pins.single] : [c.pins.r, c.pins.g, c.pins.b];
    for (const p of new Set(pins)) {
      if (pinOwners.has(p) && pinOwners.get(p) !== c.name) warnings.push(`Pin ${p} is shared by ${pinOwners.get(p)} and ${c.name}.`);
      pinOwners.set(p, c.name);
    }
    lines.push(`\t\t\t<control name="${esc(c.name)}" pin="${pins.join(',')}"/>`);
  }
  const xml = [`\t\t<ledboard name="${board.rgbcmdName}" hwthrottle="${board.hwthrottle}">`, ...lines, '\t\t</ledboard>'].join('\n');
  return { xml, warnings: [...new Set(warnings)] };
}

/** How to point RGBcommander at an animation file. */
export function animationUsageSnippet(fileName) {
  const name = esc(fileName);
  return [
    '<!-- Attract mode: play it whenever the frontend is running (inside <options>) -->',
    `<option ... rgbadefault="${name}" rgbadefaultspeed="100" ... />`,
    '',
    '<!-- Or play it after one emulator has run (on that <emulator> tag) -->',
    `<emulator binary="arcade" ... rgba="${name}" rgbaspeed="100">`,
  ].join('\n');
}

function camel(fileName) {
  const parts = String(fileName).split(/[^A-Za-z0-9]+/).filter(Boolean);
  const cleaned = parts[0] === 'custom' && parts.length > 1 ? parts.slice(1) : parts;
  return cleaned.map((p) => p[0].toUpperCase() + p.slice(1)).join('') || 'Scheme';
}

/**
 * Static colours for one frame: <colour> definitions plus <control> lines that
 * can go in a <rom id="…"> or a static <map id="…">.
 */
export function coloursSnippet(layout, framePins, fileName) {
  const controls = resolveControls(layout).filter((c) => c.pins && c.name);
  const known = new Map(RGBCOMMANDER_COLOURS.map((c) => [`${c.r},${c.g},${c.b}`, c.name]));
  const custom = new Map();
  const prefix = camel(fileName);
  const controlLines = [];
  for (const c of controls) {
    const rgb = getControlColor(framePins, c.pins);
    const key = `${rgb.r},${rgb.g},${rgb.b}`;
    let colour = known.get(key);
    if (!colour) {
      if (!custom.has(key)) custom.set(key, `${prefix}${custom.size + 1}`);
      colour = custom.get(key);
    }
    controlLines.push(`\t\t<control name="${esc(c.name)}" colour="${esc(colour)}"/>`);
  }
  const colourLines = [...custom].map(([rgb, name]) => `\t<colour name="${esc(name)}" rgb="${rgb}"/>`);
  return {
    colours: colourLines.length ? colourLines.join('\n') : '\t<!-- every colour already exists in the stock <colours> list -->',
    rom: ['\t<rom id="default">', ...controlLines, '\t</rom>'].join('\n'),
    map: ['\t<map id="default">', ...controlLines, '\t</map>'].join('\n'),
  };
}
