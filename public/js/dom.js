const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Tiny element builder: h('button.primary', { onclick }, 'Save'), h('h2#title', 'Hi').
 * Tags prefixed with "svg:" are created in the SVG namespace.
 */
export function h(spec, props, ...children) {
  if (props == null || typeof props !== 'object' || props.nodeType || Array.isArray(props)) {
    if (props !== undefined && props !== null) children.unshift(props);
    props = {};
  }
  const svg = spec.startsWith('svg:');
  let tag = 'div';
  let id = null;
  const classes = [];
  for (const part of (svg ? spec.slice(4) : spec).match(/[.#]?[^.#]+/g) || []) {
    if (part[0] === '.') classes.push(part.slice(1));
    else if (part[0] === '#') id = part.slice(1);
    else tag = part;
  }
  const el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
  if (id) el.id = id;
  if (classes.length) el.setAttribute('class', classes.join(' '));
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.setAttribute('class', [el.getAttribute('class'), value].filter(Boolean).join(' '));
    else if (key === 'style' && typeof value === 'object') {
      for (const [prop, v] of Object.entries(value)) {
        if (prop.startsWith('--')) el.style.setProperty(prop, v);
        else el.style[prop] = v;
      }
    }
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (!svg && (key === 'value' || key === 'checked' || key === 'disabled' || key === 'selected' || key === 'indeterminate')) el[key] = value;
    else if (key === 'html') el.innerHTML = value;
    else el.setAttribute(key, value === true ? '' : value);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    if (Array.isArray(child)) append(el, child);
    else el.append(child.nodeType ? child : String(child));
  }
}

export const svgEl = (tag, attrs = {}, ...children) => h('svg:' + tag, attrs, ...children);

export function clear(el) {
  while (el.firstChild) el.firstChild.remove();
  return el;
}

// Icons: 24x24, stroked, drawn for this app.
const ICONS = {
  select: 'M5 3l13 8-6 1.5L9 19z',
  paint: 'M18.5 3.5a2.1 2.1 0 013 3L12 16l-4 1 1-4zM7 17c-2 0-3.5 1.5-3.5 3.5H7a3 3 0 003-3',
  pick: 'M19 5a2.8 2.8 0 00-4 0l-2 2-1-1-2 2 1 1-6 6v3h3l6-6 1 1 2-2-1-1 2-2a2.8 2.8 0 001-4z',
  undo: 'M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3',
  redo: 'M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6 6h12v12H6z',
  plus: 'M12 5v14M5 12h14',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  left: 'M15 6l-6 6 6 6',
  right: 'M9 6l6 6-6 6',
  upload: 'M12 16V4M7 9l5-5 5 5M4 20h16',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  send: 'M4 12l16-8-6 16-2.5-6.5z',
  code: 'M9 7l-5 5 5 5M15 7l5 5-5 5',
  settings: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 13a7.6 7.6 0 000-2l2-1.6-2-3.4-2.4 1a7.7 7.7 0 00-1.7-1L15 3h-4l-.4 2.6a7.7 7.7 0 00-1.7 1l-2.4-1-2 3.4L6.5 11a7.6 7.6 0 000 2l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 001.7 1L11 21h4l.4-2.6a7.7 7.7 0 001.7-1l2.4 1 2-3.4z',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  sparkles: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  mirror: 'M12 3v18M8 7L4 12l4 5V7zM16 7l4 5-4 5V7z',
  power: 'M12 3v8M7 6.5a7 7 0 1010 0',
  sun: 'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  moon: 'M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 016.7-1.4',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  alert: 'M12 4l9 16H3zM12 10v4M12 17v.5',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5M12 8v.5',
  x: 'M6 6l12 12M18 6L6 18',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20 20l-4-4',
  menu: 'M4 7h16M4 12h16M4 17h16',
  layers: 'M12 4l9 5-9 5-9-5zM3 14l9 5 9-5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  folder: 'M3 6h6l2 2h10v11H3z',
  refresh: 'M20 12a8 8 0 11-2.3-5.7M20 4v5h-5',
  magnet: 'M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z',
  hash: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16',
  blend: 'M9 15a6 6 0 100-12 6 6 0 000 12zM15 21a6 6 0 100-12 6 6 0 000 12z',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  sort: 'M7 4v16M4 17l3 3 3-3M17 20V4M14 7l3-3 3 3',
  history: 'M3.5 12a8.5 8.5 0 102.5-6M3.5 4v4h4M12 8v4l3 2',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z',
  reverse: 'M4 8h13l-3-3M20 16H7l3 3',
};

export function icon(name, { size = 18, title } = {}) {
  const el = svgEl(
    'svg',
    { viewBox: '0 0 24 24', width: size, height: size, class: 'icon', 'aria-hidden': title ? null : 'true', role: title ? 'img' : null },
    title ? svgEl('title', {}, title) : null,
    svgEl('path', { d: ICONS[name] || ICONS.info, fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
  );
  if (name === 'play' || name === 'stop') el.querySelector('path').setAttribute('fill', 'currentColor');
  if (name === 'grip') el.querySelector('path').setAttribute('stroke-width', '3');
  return el;
}

/** Button with an icon and optional label; title doubles as tooltip and aria-label. */
export function iconButton(name, { label, title, onclick, cls = '', kbd, disabled, pressed } = {}) {
  return h(
    'button.btn' + (label ? '' : '.icon-only') + (cls ? '.' + cls.split(' ').join('.') : ''),
    {
      type: 'button',
      title: title ? (kbd ? `${title} (${kbd})` : title) : null,
      'aria-label': label ? null : title,
      'aria-pressed': pressed === undefined ? null : String(pressed),
      onclick,
      disabled,
    },
    icon(name),
    label ? h('span', label) : null,
  );
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    return fn(...args);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function formatMs(ms) {
  if (ms < 1000) return `${Math.round(ms)} ms`;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(s < 10 ? 2 : 1)} s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'color', 'submit', 'reset', 'file']);

/** True while the user is typing text, so single-key shortcuts should stay out of the way. */
export function isTyping(event) {
  const t = event.target;
  if (!t || !t.tagName) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return t.tagName === 'INPUT' && !NON_TEXT_INPUTS.has(t.type);
}

/** Focusable controls that use arrows/space/enter themselves (sliders, buttons, links). */
export function isControl(el) {
  return Boolean(el && el.tagName && /^(INPUT|BUTTON|A|SELECT|SUMMARY)$/.test(el.tagName));
}
