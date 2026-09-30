import { h, icon, iconButton, clear, isTyping, isControl } from '../dom.js';
import { store } from '../store.js';
import { PanelView } from '../ui/panel.js';
import { confirmDialog, toast } from '../ui/dialogs.js';
import { showMenu } from '../ui/menu.js';
import { BOARDS, CHANNEL_ORDERS, getBoard, portPinsWithOrder } from '../core/boards.js';
import {
  CONTROL_KINDS,
  TEMPLATES,
  RGBCMD_NAME_RE,
  standardControlNames,
  controlId,
  radiusOf,
  playerOf,
  buildTemplate,
} from '../core/layouts.js';
import { blankPins, setControlColor } from '../core/project.js';

const SNAP = 5;
const clone = (v) => structuredClone(v);

export class LayoutView {
  constructor() {
    this.el = h('div.layout-view');
    this.selection = new Set();
    this.unsubs = [];
    this.snap = true;
  }

  mount(container) {
    container.replaceChildren(this.el);
    this.panel = new PanelView({
      mode: 'layout',
      callbacks: {
        onSelect: (ids, mode) => this.select(ids, mode),
        onMoveStart: () => this.startMove(),
        onMove: (dx, dy, e) => this.moveBy(dx, dy, e),
        onMoveEnd: (cancelled) => this.endMove(cancelled),
        describe: (c) => `${c.name || '(no name)'} · ${this.wiringText(c)}`,
      },
    });
    this.inspector = h('aside.inspector.layout-inspector');
    this.portMap = h('section.port-map', { 'aria-label': 'LED ports' });
    this.undoBtn = iconButton('undo', { title: 'Undo', kbd: 'Ctrl+Z', onclick: () => store.undoLayout() });
    this.redoBtn = iconButton('redo', { title: 'Redo', kbd: 'Ctrl+Shift+Z', onclick: () => store.redoLayout() });
    this.snapBtn = h('button.btn.small.toggle', { type: 'button', title: 'Snap to a 5 mm grid while dragging (hold Alt to override)', onclick: () => ((this.snap = !this.snap), this.renderToolbar()) }, icon('magnet', { size: 15 }), h('span', 'Snap'));
    this.portsBtn = h('button.btn.small.toggle', { type: 'button', title: 'Show LED port numbers', onclick: () => store.saveSettings({ showPorts: !store.settings.showPorts }) }, icon('hash', { size: 15 }), h('span', 'Ports'));

    const addButtons = Object.entries(CONTROL_KINDS).map(([kind, k]) =>
      h('button.btn.small', { type: 'button', title: `Add a ${k.label.toLowerCase()} (${k.hint})`, onclick: () => this.add(kind) }, icon('plus', { size: 14 }), h('span', k.label)),
    );
    const workspace = h(
      'section.workspace',
      h(
        'header.scheme-head',
        h('div.scheme-title-wrap', h('h1.view-title', 'Panel layout'), h('span.view-sub', 'Place your controls and tell the app which LED port each one is wired to. Sizes are in millimetres.')),
        h('div.head-spacer'),
        h('button.btn', { type: 'button', onclick: (e) => this.templateMenu(e.currentTarget) }, icon('grid'), h('span', 'Templates')),
        this.undoBtn,
        this.redoBtn,
      ),
      h(
        'div.toolbar',
        h('span.toolbar-label', 'Add'),
        addButtons,
        h('div.tl-sep'),
        iconButton('copy', { label: 'Duplicate', cls: 'small', title: 'Duplicate selection', kbd: 'Ctrl+D', onclick: () => this.duplicate() }),
        iconButton('mirror', { label: 'Copy P1 → P2', cls: 'small', title: 'Create P2 copies of the selected P1 controls', onclick: () => this.copyToP2() }),
        iconButton('trash', { label: 'Delete', cls: 'small', title: 'Delete selection', kbd: 'Del', onclick: () => this.remove() }),
        h('div.tl-spacer'),
        this.snapBtn,
        this.portsBtn,
      ),
      h('div.stage.layout-stage', this.panel.el),
      this.portMap,
    );
    this.el.replaceChildren(workspace, this.inspector);
    this.unsubs.push(
      store.on('layout', () => this.render()),
      store.on('settings', () => this.render()),
      store.on('frame', () => this.renderPreview()),
    );
    this.onKey = (e) => this.handleKey(e);
    document.addEventListener('keydown', this.onKey);
    document.title = 'Panel layout · RGB Commander Studio';
    this.render();
  }

  unmount() {
    this.unsubs.forEach((u) => u());
    document.removeEventListener('keydown', this.onKey);
    store.scheduleLayoutSave.flush?.();
  }

  get layout() {
    return store.layout;
  }

  get board() {
    return getBoard(this.layout.board);
  }

  record() {
    store.layoutHistory.record(clone(this.layout));
  }

  commit() {
    store.setLayout(this.layout);
  }

  // --- rendering ---------------------------------------------------------------------

  render() {
    this.panel.setLayout(this.layout, store.controls);
    this.panel.setOptions({ previewMode: store.settings.previewMode, showPorts: store.settings.showPorts });
    for (const id of [...this.selection]) if (!store.controlById.has(id)) this.selection.delete(id);
    this.panel.setSelection(this.selection);
    this.renderPreview();
    this.renderToolbar();
    if (!this.quiet) this.renderInspector();
    this.renderPortMap();
  }

  renderToolbar() {
    this.snapBtn.setAttribute('aria-pressed', String(this.snap));
    this.portsBtn.setAttribute('aria-pressed', String(store.settings.showPorts));
    this.undoBtn.disabled = !store.layoutHistory.past.length;
    this.redoBtn.disabled = !store.layoutHistory.future.length;
  }

  /** Light wired controls with the open scheme, or a soft white so wiring is visible. */
  renderPreview() {
    let pins = store.frame?.pins;
    if (!pins || pins.length !== this.board.pinCount) {
      pins = blankPins(this.board.pinCount);
      for (const c of store.controls) if (c.pins) setControlColor(pins, c.pins, { r: 70, g: 70, b: 80 });
    }
    this.panel.setPins(pins);
  }

  wiringText(c) {
    const w = c.wiring || { mode: 'none' };
    if (w.mode === 'port') {
      const p = portPinsWithOrder(this.board, w.port, w.order);
      return `port ${w.port} (R${p.r} G${p.g} B${p.b})`;
    }
    if (w.mode === 'pins') return `pins R${w.r} G${w.g} B${w.b}`;
    if (w.mode === 'single') return `single LED on pin ${w.pin}`;
    return 'no light';
  }

  select(ids, mode = 'replace') {
    if (mode === 'replace') this.selection = new Set(ids);
    else if (mode === 'add') ids.forEach((id) => this.selection.add(id));
    else ids.forEach((id) => (this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id)));
    this.panel.setSelection(this.selection);
    this.renderInspector();
    this.renderPortMap();
  }

  selected() {
    return this.layout.controls.filter((c) => this.selection.has(c.id));
  }

  renderInspector() {
    clear(this.inspector);
    const sel = this.selected();
    if (sel.length === 1) this.inspector.append(this.controlForm(sel[0]));
    else if (sel.length > 1) this.inspector.append(this.multiForm(sel));
    else this.inspector.append(this.panelForm());
  }

  field(label, input, hint) {
    return h('label.prop', h('span.prop-label', label), input, hint ? h('span.prop-hint', hint) : null);
  }

  /**
   * Wire an inspector input to the layout. Edits record one undo step (one per
   * drag for sliders) and redraw the panel; the inspector itself is only rebuilt
   * when `rebuild` is set, so typing and dragging keep focus.
   */
  bind(input, apply, { live = false, rebuild = false } = {}) {
    const run = (record) => {
      if (record) this.record();
      apply(input);
      this.quiet = !rebuild;
      this.commit();
      this.quiet = false;
    };
    if (live) {
      input.addEventListener('input', () => {
        run(!this.sliding);
        this.sliding = true;
      });
      input.addEventListener('change', () => (this.sliding = false));
    } else {
      input.addEventListener('change', () => run(true));
    }
    return input;
  }

  controlForm(c) {
    const board = this.board;
    const names = h('datalist', { id: 'control-names' }, standardControlNames().map((n) => h('option', { value: n })));
    const nameOk = RGBCMD_NAME_RE.test(c.name);
    const nameInput = this.bind(
      h('input.mono', { type: 'text', value: c.name, list: 'control-names', maxlength: 40, spellcheck: 'false' }),
      (i) => {
        c.name = i.value.trim().toUpperCase().replace(/[^\w.-]/g, '_');
      },
      { rebuild: true },
    );
    const labelInput = this.bind(h('input', { type: 'text', value: c.label, maxlength: 12 }), (i) => (c.label = i.value));
    const kind = this.bind(
      h('select', Object.entries(CONTROL_KINDS).map(([k, v]) => h('option', { value: k, selected: c.kind === k }, `${v.label} (${v.hint})`))),
      (i) => {
        c.kind = i.value;
        delete c.r;
      },
      { rebuild: true },
    );
    const sizeLabel = h('span.prop-label', `Size · ${radiusOf(c) * 2} mm`);
    const size = this.bind(
      h('input.slider', { type: 'range', min: 3, max: 60, value: radiusOf(c) }),
      (i) => {
        c.r = Number(i.value);
        sizeLabel.textContent = `Size · ${c.r * 2} mm`;
      },
      { live: true },
    );
    const x = this.bind(h('input.num', { type: 'number', value: c.x, step: 1 }), (i) => (c.x = Math.round(Number(i.value) || 0)));
    const y = this.bind(h('input.num', { type: 'number', value: c.y, step: 1 }), (i) => (c.y = Math.round(Number(i.value) || 0)));

    const w = c.wiring || { mode: 'none' };
    const modes = [
      ['port', 'LED port'],
      ['pins', 'Custom pins'],
      ['single', 'Single colour'],
      ['none', 'No light'],
    ];
    const modeBar = h(
      'div.segmented',
      { role: 'radiogroup', 'aria-label': 'Light' },
      modes.map(([m, label]) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(w.mode === m),
            onclick: () => {
              if (w.mode === m) return;
              this.record();
              c.wiring = this.defaultWiring(m, c);
              this.commit();
            },
          },
          label,
        ),
      ),
    );

    const wiringFields = h('div.wiring-fields');
    if (w.mode === 'port') {
      const used = this.portUsers();
      const port = this.bind(
        h(
          'select',
          Array.from({ length: board.portCount }, (_, i) => {
            const n = i + 1;
            const others = (used.get(n) || []).filter((o) => o.id !== c.id);
            const side = board.portOrder(n).toUpperCase();
            return h('option', { value: n, selected: w.port === n }, `${n}  ·  ${side}${others.length ? '  ·  used by ' + others.map((o) => o.name || '?').join(', ') : ''}`);
          }),
        ),
        (i) => (c.wiring = { ...w, port: Number(i.value) }),
        { rebuild: true },
      );
      const autoLabel = `Auto (${board.portOrder(w.port).toUpperCase()})`;
      const order = this.bind(
        h('select', [h('option', { value: 'auto', selected: w.order === 'auto' }, autoLabel), ...CHANNEL_ORDERS.map((o) => h('option', { value: o, selected: w.order === o }, o.toUpperCase()))]),
        (i) => (c.wiring = { ...w, order: i.value }),
        { rebuild: true },
      );
      const p = portPinsWithOrder(board, w.port, w.order);
      wiringFields.append(
        this.field('Port', port),
        this.field('Channel order', order, `Pins R${p.r} · G${p.g} · B${p.b}. ${board.id === 'ultimateio' ? 'Ports 17–32 sit on the B,G,R header; Auto handles it. Change it only if a test shows swapped colours.' : ''}`),
      );
    } else if (w.mode === 'pins') {
      const pin = (ch) =>
        this.bind(h('input.num', { type: 'number', min: 1, max: board.pinCount, value: w[ch] }), (i) => {
          c.wiring = { ...c.wiring, [ch]: Math.max(1, Math.min(board.pinCount, Math.round(Number(i.value) || 1))) };
        });
      wiringFields.append(h('div.prop-row', this.field('Red pin', pin('r')), this.field('Green pin', pin('g')), this.field('Blue pin', pin('b'))), h('p.prop-hint', `Pins 1–${board.pinCount}, same numbers as the pin="…" attribute in rgbcmdd.xml.`));
    } else if (w.mode === 'single') {
      const pin = this.bind(h('input.num', { type: 'number', min: 1, max: board.pinCount, value: w.pin }), (i) => {
        c.wiring = { ...c.wiring, pin: Math.max(1, Math.min(board.pinCount, Math.round(Number(i.value) || 1))) };
      });
      const tint = this.bind(h('input.color-input', { type: 'color', value: w.tint || '#ffffff' }), (i) => (c.wiring = { ...c.wiring, tint: i.value }));
      wiringFields.append(h('div.prop-row', this.field('Pin', pin), this.field('LED colour', tint)), h('p.prop-hint', 'For plain single-colour LEDs. The scheme sets its brightness; the colour is only for the preview.'));
    } else {
      wiringFields.append(h('p.prop-hint', 'Shown on the panel for reference, never lit.'));
    }

    return h(
      'div.props',
      h('div.props-head', h('h2', c.name || 'Control'), iconButton('trash', { title: 'Delete', onclick: () => this.remove() })),
      names,
      this.field('RGBcommander name', nameInput, c.name && !nameOk ? 'Not a standard RGBcommander name. Fine for animations, but game configs won’t find it.' : 'Used in rgbcmdd.xml, e.g. P1_BUTTON1, P2_START.'),
      h('div.prop-row', this.field('Label', labelInput), this.field('Type', kind)),
      h('div.prop-row', this.field('X (mm)', x), this.field('Y (mm)', y)),
      h('label.prop', sizeLabel, size),
      h('h3.prop-section', 'Light'),
      modeBar,
      wiringFields,
    );
  }

  multiForm(sel) {
    return h(
      'div.props',
      h('div.props-head', h('h2', `${sel.length} controls`), iconButton('trash', { title: 'Delete', onclick: () => this.remove() })),
      h('p.prop-hint', 'Drag to move them together. Arrow keys nudge 1 mm (Shift: 10 mm).'),
      h(
        'div.align-grid',
        [
          ['Align tops', () => this.align('y', 'min')],
          ['Align middles', () => this.align('y', 'mid')],
          ['Align lefts', () => this.align('x', 'min')],
          ['Align centres', () => this.align('x', 'mid')],
          ['Space evenly across', () => this.distribute('x')],
          ['Space evenly down', () => this.distribute('y')],
        ].map(([label, fn]) => h('button.btn.small', { type: 'button', onclick: fn }, label)),
      ),
    );
  }

  panelForm() {
    const l = this.layout;
    const board = this.bind(
      h('select', Object.values(BOARDS).map((b) => h('option', { value: b.id, selected: l.board === b.id }, `${b.name} (${b.pinCount} pins)`))),
      (i) => {
        l.board = i.value;
        const b = getBoard(i.value);
        for (const c of l.controls) {
          if (c.wiring?.mode === 'port' && c.wiring.port > b.portCount) c.wiring = { mode: 'none' };
          if (c.wiring?.mode === 'pins' && [c.wiring.r, c.wiring.g, c.wiring.b].some((p) => p > b.pinCount)) c.wiring = { mode: 'none' };
          if (c.wiring?.mode === 'single' && c.wiring.pin > b.pinCount) c.wiring = { mode: 'none' };
        }
      },
      { rebuild: true },
    );
    const width = this.bind(h('input.num', { type: 'number', min: 100, max: 3000, value: l.width }), (i) => (l.width = Math.max(100, Math.min(3000, Math.round(Number(i.value) || 800)))));
    const height = this.bind(h('input.num', { type: 'number', min: 100, max: 3000, value: l.height }), (i) => (l.height = Math.max(100, Math.min(3000, Math.round(Number(i.value) || 300)))));
    const color = this.bind(h('input.color-input', { type: 'color', value: l.panelColor }), (i) => (l.panelColor = i.value));
    const lit = store.controls.filter((c) => c.pins).length;
    return h(
      'div.props',
      h('div.props-head', h('h2', 'Control panel')),
      h('p.prop-hint', `${l.controls.length} controls, ${lit} with lights. Click a control to edit it, or drag across the panel to select several.`),
      this.field('LED board', board, 'New schemes use this board’s pin count.'),
      h('div.prop-row', this.field('Width (mm)', width), this.field('Height (mm)', height)),
      this.field('Panel colour', color),
      h('h3.prop-section', 'Tips'),
      h(
        'ul.tips',
        h('li', 'Not sure which button is on which port? Create a scheme from the “Wiring test: port walk” starter, publish it and watch the cabinet.'),
        h('li', 'Colours look swapped on some buttons? The “all red” wiring test shows which ones need a different channel order.'),
        h('li', 'Arrow keys nudge the selection; hold Alt while dragging to skip snapping.'),
      ),
    );
  }

  /** port -> controls using it (port wiring, or custom pins inside the port). */
  portUsers() {
    const users = new Map();
    const add = (port, c) => {
      if (!users.has(port)) users.set(port, []);
      if (!users.get(port).includes(c)) users.get(port).push(c);
    };
    for (const c of this.layout.controls) {
      const w = c.wiring;
      if (w?.mode === 'port') add(w.port, c);
      else if (w?.mode === 'pins') [w.r, w.g, w.b].forEach((p) => add(Math.ceil(p / 3), c));
      else if (w?.mode === 'single') add(Math.ceil(w.pin / 3), c);
    }
    return users;
  }

  renderPortMap() {
    clear(this.portMap);
    const board = this.board;
    const users = this.portUsers();
    const cell = (n) => {
      const list = users.get(n) || [];
      const conflict = list.length > 1 && !(list.every((c) => c.wiring.mode !== 'port') && this.pinsDistinct(list));
      const selected = list.some((c) => this.selection.has(c.id));
      return h(
        'button.port-cell' + (list.length ? '.used' : '') + (conflict ? '.conflict' : '') + (selected ? '.selected' : ''),
        {
          type: 'button',
          title: list.length ? `Port ${n}: ${list.map((c) => c.name || c.kind).join(', ')}${conflict ? ' (conflict!)' : ''}` : `Port ${n} is free`,
          onclick: () => list.length && this.select(list.map((c) => c.id)),
        },
        h('span.port-no', String(n)),
        h('span.port-name', list.length ? list.map((c) => shortName(c.name) || '?').join(', ') : 'free'),
      );
    };
    if (board.id === 'ultimateio') {
      this.portMap.append(
        h('div.port-map-head', h('h3', 'LED ports'), h('span.hint', 'Click a port to select what’s wired to it. Red means two controls share a port.')),
        h('div.port-row-label', 'Ports 17–32 · pins 49–96 · wired B,G,R'),
        h('div.port-row', Array.from({ length: 16 }, (_, i) => cell(i + 17))),
        h('div.port-row-label', 'Ports 1–16 · pins 1–48 · wired R,G,B'),
        h('div.port-row', Array.from({ length: 16 }, (_, i) => cell(i + 1))),
      );
    } else {
      this.portMap.append(
        h('div.port-map-head', h('h3', 'LED ports'), h('span.hint', `${board.portCount} RGB ports, R,G,B order`)),
        h('div.port-row.wrap', Array.from({ length: board.portCount }, (_, i) => cell(i + 1))),
      );
    }
  }

  pinsDistinct(list) {
    const seen = new Set();
    for (const c of list) {
      const w = c.wiring;
      const pins = w.mode === 'single' ? [w.pin] : [w.r, w.g, w.b];
      for (const p of pins) {
        if (seen.has(p)) return false;
        seen.add(p);
      }
    }
    return true;
  }

  // --- editing -------------------------------------------------------------------------

  freePorts() {
    const used = this.portUsers();
    return Array.from({ length: this.board.portCount }, (_, i) => i + 1).filter((n) => !used.has(n));
  }

  defaultWiring(mode, c) {
    const board = this.board;
    const port = c.wiring?.mode === 'port' ? c.wiring.port : this.freePorts()[0] || 1;
    if (mode === 'port') return { mode: 'port', port, order: 'auto' };
    if (mode === 'pins') return { mode: 'pins', ...board.portPins(port) };
    if (mode === 'single') return { mode: 'single', pin: board.portPins(port).r, tint: '#ffffff' };
    return { mode: 'none' };
  }

  nextName(base) {
    const taken = new Set(this.layout.controls.map((c) => c.name));
    const m = /^(.*?)(\d+)$/.exec(base);
    if (!taken.has(base) && base) return base;
    const stem = m ? m[1] : base + '_';
    let n = m ? Number(m[2]) + 1 : 2;
    while (taken.has(`${stem}${n}`)) n++;
    return `${stem}${n}`;
  }

  /** A spot near (x, y) where a control of radius r doesn't overlap anything. */
  freeSpot(x, y, r) {
    const { width, height, controls } = this.layout;
    const fits = (px, py) =>
      px - r >= 0 &&
      px + r <= width &&
      py - r >= 0 &&
      py + r <= height &&
      controls.every((c) => Math.hypot(c.x - px, c.y - py) >= radiusOf(c) + r + 4);
    for (let dist = 0; dist <= Math.max(width, height); dist += 10) {
      const steps = dist ? Math.max(8, Math.round(dist / 6)) : 1;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const px = Math.round((x + Math.cos(a) * dist) / SNAP) * SNAP;
        const py = Math.round((y + Math.sin(a) * dist) / SNAP) * SNAP;
        if (fits(px, py)) return { x: px, y: py };
      }
    }
    return { x: Math.round(width / 2), y: Math.round(height / 2) };
  }

  add(kind) {
    this.record();
    const anchor = this.selected()[0];
    const r = CONTROL_KINDS[kind].r;
    const spot = anchor ? this.freeSpot(anchor.x + radiusOf(anchor) + r + 8, anchor.y, r) : this.freeSpot(this.layout.width / 2, this.layout.height / 2, r);
    const lit = kind !== 'stick';
    const free = this.freePorts()[0];
    // Follow the selected control's player, so adding next to P2 suggests P2 names.
    const p = playerOf(anchor?.name) || 1;
    const baseName = { button: `P${p}_BUTTON1`, small: `P${p}_START`, large: 'ALWAYS_ON_1', stick: `P${p}_JOYSTICK`, trackball: `P${p}_TRACKBALL`, spinner: `P${p}_SPINNER`, led: 'ALWAYS_ON_LED1' }[kind];
    const c = {
      id: controlId(),
      name: this.nextName(baseName),
      label: '',
      kind,
      x: spot.x,
      y: spot.y,
      wiring: lit && free ? { mode: 'port', port: free, order: 'auto' } : { mode: 'none' },
    };
    this.layout.controls.push(c);
    this.commit();
    this.select([c.id]);
    if (lit && !free) toast('Every LED port is in use, so the new control has no light yet.', { kind: 'warn' });
  }

  duplicate() {
    const sel = this.selected();
    if (!sel.length) return;
    this.record();
    const ids = [];
    for (const src of sel) {
      const c = clone(src);
      c.id = controlId();
      c.name = this.nextName(src.name);
      c.x += 20;
      c.y += 20;
      if (c.wiring?.mode === 'port') {
        const free = this.freePorts()[0];
        c.wiring = free ? { ...c.wiring, port: free } : { mode: 'none' };
      } else if (c.wiring?.mode !== 'none') c.wiring = { mode: 'none' };
      this.layout.controls.push(c);
      ids.push(c.id);
    }
    this.commit();
    this.select(ids);
  }

  copyToP2() {
    const p1 = this.selected().filter((c) => playerOf(c.name) === 1);
    if (!p1.length) return toast('Select some P1_… controls first', { kind: 'warn' });
    const names = new Set(this.layout.controls.map((c) => c.name));
    const stick1 = this.layout.controls.find((c) => c.name === 'P1_JOYSTICK');
    const stick2 = this.layout.controls.find((c) => c.name === 'P2_JOYSTICK');
    const dx = stick1 && stick2 ? stick2.x - stick1.x : Math.round(this.layout.width / 2);
    const dy = stick1 && stick2 ? stick2.y - stick1.y : 0;
    this.record();
    const free = this.freePorts().filter((n) => n > this.board.portCount / 2).concat(this.freePorts().filter((n) => n <= this.board.portCount / 2));
    const created = [];
    let skipped = 0;
    for (const src of [...p1].sort((a, b) => (a.wiring?.port || 99) - (b.wiring?.port || 99))) {
      const name = src.name.replace(/^P1_/, 'P2_');
      if (names.has(name)) {
        skipped++;
        continue;
      }
      const c = { ...clone(src), id: controlId(), name, x: src.x + dx, y: src.y + dy, label: src.label === '1P' ? '2P' : src.label };
      if (c.wiring?.mode === 'port') {
        const port = free.shift();
        c.wiring = port ? { mode: 'port', port, order: 'auto' } : { mode: 'none' };
      } else if (c.wiring?.mode !== 'none') c.wiring = { mode: 'none' };
      this.layout.controls.push(c);
      created.push(c.id);
    }
    this.commit();
    this.select(created);
    toast(`Created ${created.length} P2 control${created.length === 1 ? '' : 's'}${skipped ? `; ${skipped} already existed` : ''}`, { kind: 'success' });
  }

  async remove() {
    const sel = this.selected();
    if (!sel.length) return;
    if (sel.length > 3 && !(await confirmDialog({ title: `Delete ${sel.length} controls?`, message: 'You can undo this with Ctrl+Z.', confirm: 'Delete', danger: true }))) return;
    this.record();
    this.layout.controls = this.layout.controls.filter((c) => !this.selection.has(c.id));
    this.selection.clear();
    this.commit();
  }

  startMove() {
    this.record();
    this.moveOrigin = new Map(this.selected().map((c) => [c.id, { x: c.x, y: c.y }]));
  }

  moveBy(dx, dy, e) {
    if (!this.moveOrigin) return;
    const snap = this.snap && !e.altKey;
    for (const c of this.selected()) {
      const o = this.moveOrigin.get(c.id);
      if (!o) continue;
      let x = o.x + dx;
      let y = o.y + dy;
      if (snap) {
        x = Math.round(x / SNAP) * SNAP;
        y = Math.round(y / SNAP) * SNAP;
      }
      c.x = Math.round(x);
      c.y = Math.round(y);
    }
    this.commit();
  }

  endMove(cancelled) {
    if (cancelled && this.moveOrigin) {
      // Nothing moved: drop the undo step we recorded at pointerdown.
      store.layoutHistory.past.pop();
      this.renderToolbar();
    }
    this.moveOrigin = null;
  }

  nudge(dx, dy) {
    const sel = this.selected();
    if (!sel.length) return;
    this.record();
    for (const c of sel) {
      c.x += dx;
      c.y += dy;
    }
    this.commit();
  }

  align(axis, how) {
    const sel = this.selected();
    this.record();
    const vals = sel.map((c) => c[axis]);
    const target = how === 'min' ? Math.min(...vals) : Math.round((Math.min(...vals) + Math.max(...vals)) / 2);
    for (const c of sel) c[axis] = target;
    this.commit();
  }

  distribute(axis) {
    const sel = this.selected().sort((a, b) => a[axis] - b[axis]);
    if (sel.length < 3) return toast('Select at least three controls', { kind: 'warn' });
    this.record();
    const first = sel[0][axis];
    const step = (sel.at(-1)[axis] - first) / (sel.length - 1);
    sel.forEach((c, i) => (c[axis] = Math.round(first + step * i)));
    this.commit();
  }

  templateMenu(anchor) {
    showMenu(
      anchor,
      TEMPLATES.map((t) => ({
        label: t.name,
        icon: 'grid',
        onClick: async () => {
          const ok = await confirmDialog({
            title: `Switch to “${t.name}”?`,
            message: `${t.description} This replaces your current layout (Ctrl+Z brings it back). Schemes keep their pin values, so buttons may show different colours until the layout matches your wiring again.`,
            confirm: 'Replace layout',
          });
          if (!ok) return;
          this.record();
          store.setLayout(buildTemplate(t.id));
          this.selection.clear();
          this.render();
        },
      })),
    );
  }

  handleKey(e) {
    if (document.querySelector('dialog[open]') || isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    if (!mod && isControl(e.target) && /^(Arrow|Enter$| $|Home$|End$|Page)/.test(e.key)) return;
    if (mod && key === 'z') {
      e.preventDefault();
      return e.shiftKey ? store.redoLayout() : store.undoLayout();
    }
    if (mod && key === 'y') {
      e.preventDefault();
      return store.redoLayout();
    }
    if (mod && key === 'd') {
      e.preventDefault();
      return this.duplicate();
    }
    if (mod && key === 'a') {
      e.preventDefault();
      return this.select(this.layout.controls.map((c) => c.id));
    }
    const step = e.shiftKey ? 10 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key] && this.selection.size) {
      e.preventDefault();
      return this.nudge(...moves[e.key]);
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.selection.size) {
      e.preventDefault();
      return this.remove();
    }
    if (e.key === 'Escape') this.select([]);
  }
}

function shortName(name) {
  return String(name || '')
    .replace(/^P(\d)_BUTTON/, 'P$1 B')
    .replace(/^P(\d)_/, 'P$1 ')
    .replace(/^ALWAYS_ON_?/, '')
    .replace(/_/g, ' ');
}
