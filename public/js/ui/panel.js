import { h, svgEl } from '../dom.js';
import { radiusOf } from '../core/layouts.js';
import { getControlColor } from '../core/project.js';
import { ledToScreen, cssRgb, luminance, isOff } from '../core/color.js';

let uidCounter = 0;

const OFF_CAP = '#2a2d36';

/**
 * SVG rendering of a control panel.
 *
 * mode 'paint'  – select / paint / pick colours (the editor)
 * mode 'layout' – select and drag controls around (the layout editor)
 * mode 'static' – no interaction (previews)
 */
export class PanelView {
  constructor({ mode = 'static', getTool = () => 'select', callbacks = {}, className = '' } = {}) {
    this.mode = mode;
    this.getTool = getTool;
    this.cb = callbacks;
    this.uid = `pv${++uidCounter}`;
    this.options = { previewMode: 'led', showPorts: false, grid: mode === 'layout' };
    this.selection = new Set();
    this.nodes = new Map();
    this.controls = [];
    this.pins = null;
    this.tooltip = h('div.panel-tooltip', { hidden: true });
    this.svg = svgEl('svg', { class: `panel-svg mode-${mode}`, preserveAspectRatio: 'xMidYMid meet', role: mode === 'static' ? 'img' : 'application' });
    this.el = h('div.panel-view' + (className ? '.' + className : ''), this.svg, this.tooltip);
    if (mode !== 'static') this.bindPointer();
  }

  setOptions(options) {
    const rebuild = options.grid !== undefined && options.grid !== this.options.grid;
    Object.assign(this.options, options);
    if (rebuild && this.layout) this.setLayout(this.layout, this.controls);
    else this.repaint();
  }

  setLayout(layout, controls) {
    this.layout = layout;
    this.controls = controls;
    const pad = 14;
    const { width: w, height: hgt } = layout;
    this.svg.setAttribute('viewBox', `${-pad} ${-pad} ${w + pad * 2} ${hgt + pad * 2}`);
    const u = this.uid;
    const panel = layout.panelColor || '#17181d';
    const defs = svgEl(
      'defs',
      {},
      svgEl('filter', { id: `${u}-glow`, x: '-1', y: '-1', width: '3', height: '3', 'color-interpolation-filters': 'sRGB' }, svgEl('feGaussianBlur', { stdDeviation: 9 })),
      svgEl(
        'radialGradient',
        { id: `${u}-shine`, cx: '0.36', cy: '0.3', r: '0.8' },
        svgEl('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.55' }),
        svgEl('stop', { offset: '0.3', 'stop-color': '#fff', 'stop-opacity': '0.12' }),
        svgEl('stop', { offset: '0.75', 'stop-color': '#000', 'stop-opacity': '0.08' }),
        svgEl('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '0.4' }),
      ),
      svgEl(
        'radialGradient',
        { id: `${u}-ball`, cx: '0.35', cy: '0.3', r: '0.85' },
        svgEl('stop', { offset: '0', 'stop-color': '#fff', 'stop-opacity': '0.7' }),
        svgEl('stop', { offset: '0.25', 'stop-color': '#fff', 'stop-opacity': '0.1' }),
        svgEl('stop', { offset: '1', 'stop-color': '#000', 'stop-opacity': '0.55' }),
      ),
      svgEl(
        'linearGradient',
        { id: `${u}-panel`, x1: '0', y1: '0', x2: '0', y2: '1' },
        svgEl('stop', { offset: '0', 'stop-color': panel }),
        svgEl('stop', { offset: '1', 'stop-color': '#0b0c0f' }),
      ),
      svgEl('pattern', { id: `${u}-grid`, width: 10, height: 10, patternUnits: 'userSpaceOnUse' }, svgEl('path', { d: 'M10 0H0V10', fill: 'none', stroke: 'rgba(255,255,255,0.05)', 'stroke-width': 0.6 })),
    );
    const bg = svgEl('rect', { class: 'panel-bg', x: 0, y: 0, width: w, height: hgt, rx: 16, fill: `url(#${u}-panel)` });
    const edge = svgEl('rect', { class: 'panel-edge', x: 0.5, y: 0.5, width: w - 1, height: hgt - 1, rx: 16 });
    this.glowLayer = svgEl('g', { class: 'glows' });
    this.controlLayer = svgEl('g', { class: 'controls' });
    this.marquee = svgEl('rect', { class: 'marquee', visibility: 'hidden' });
    this.svg.replaceChildren(
      defs,
      bg,
      ...(this.options.grid ? [svgEl('rect', { x: 0, y: 0, width: w, height: hgt, fill: `url(#${u}-grid)`, 'pointer-events': 'none' })] : []),
      edge,
      this.glowLayer,
      this.controlLayer,
      this.marquee,
    );
    this.nodes.clear();
    for (const c of controls) this.buildControl(c);
    this.repaint();
  }

  buildControl(c) {
    const u = this.uid;
    const r = radiusOf(c);
    const glow = svgEl('circle', { class: 'glow', cx: c.x, cy: c.y, r: r * 2, filter: `url(#${u}-glow)` });
    this.glowLayer.append(glow);
    const g = svgEl('g', { class: `ctl kind-${c.kind}${c.pins ? '' : ' unlit'}`, transform: `translate(${c.x} ${c.y})`, 'data-id': c.id });
    let cap;
    let face;
    if (c.kind === 'stick') {
      g.append(svgEl('circle', { class: 'washer', r: r * 1.75 }), svgEl('circle', { class: 'shaft', r: r * 0.42 }));
      cap = svgEl('circle', { class: 'cap', r });
      face = svgEl('circle', { class: 'shine', r, fill: `url(#${u}-ball)` });
      g.append(cap, face);
    } else if (c.kind === 'trackball') {
      g.append(svgEl('circle', { class: 'bezel', r: r * 1.22 }));
      cap = svgEl('circle', { class: 'cap', r });
      face = svgEl('circle', { class: 'shine', r, fill: `url(#${u}-ball)` });
      g.append(cap, face);
    } else if (c.kind === 'spinner') {
      g.append(svgEl('circle', { class: 'bezel', r: r * 1.15 }));
      cap = svgEl('circle', { class: 'cap', r });
      g.append(cap);
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.append(svgEl('line', { class: 'ridge', x1: Math.cos(a) * r * 0.72, y1: Math.sin(a) * r * 0.72, x2: Math.cos(a) * r * 0.95, y2: Math.sin(a) * r * 0.95 }));
      }
      face = svgEl('circle', { class: 'shine', r, fill: `url(#${u}-shine)` });
      g.append(face);
    } else {
      g.append(svgEl('circle', { class: 'bezel', r: r * (c.kind === 'led' ? 1.35 : 1.2) }));
      cap = svgEl('circle', { class: 'cap', r });
      face = svgEl('circle', { class: 'shine', r, fill: `url(#${u}-shine)` });
      g.append(cap, face);
    }
    const labelSize = Math.max(5, Math.min(r * 0.62, 11));
    const label = c.label && c.kind !== 'led' ? svgEl('text', { class: 'label', 'font-size': labelSize, dy: labelSize * 0.35 }, c.label) : null;
    if (label) g.append(label);
    const ring = svgEl('circle', { class: 'sel-ring', r: r * (c.kind === 'stick' ? 1.95 : 1.42) });
    g.append(ring);
    let badge = null;
    if (c.wiring?.mode === 'port') {
      badge = svgEl(
        'g',
        { class: 'port-badge', transform: `translate(${r * 0.95} ${-r * 0.95})` },
        svgEl('rect', { x: -7, y: -5.5, width: 14, height: 11, rx: 3 }),
        svgEl('text', { dy: 3 }, String(c.wiring.port)),
      );
      g.append(badge);
    }
    this.controlLayer.append(g);
    this.nodes.set(c.id, { g, glow, cap, label, badge, ring });
  }

  setPins(pins) {
    this.pins = pins;
    this.repaint();
  }

  setSelection(selection) {
    this.selection = selection;
    for (const [id, n] of this.nodes) n.g.classList.toggle('selected', selection.has(id));
  }

  repaint() {
    const { previewMode, showPorts } = this.options;
    for (const c of this.controls) {
      const n = this.nodes.get(c.id);
      if (!n) continue;
      n.g.classList.toggle('selected', this.selection.has(c.id));
      if (n.badge) n.badge.style.display = showPorts ? '' : 'none';
      const rgb = this.pins && c.pins ? getControlColor(this.pins, c.pins) : null;
      if (!rgb || isOff(rgb)) {
        n.cap.setAttribute('fill', c.kind === 'stick' && !c.pins ? '#14151a' : OFF_CAP);
        n.glow.style.opacity = '0';
        n.g.classList.add('off');
        if (n.label) n.label.setAttribute('fill', '#8b91a0');
        continue;
      }
      n.g.classList.remove('off');
      const screen = ledToScreen(rgb, previewMode);
      const fill = cssRgb(screen);
      n.cap.setAttribute('fill', fill);
      n.glow.setAttribute('fill', fill);
      const level = Math.max(rgb.r, rgb.g, rgb.b) / 255;
      n.glow.style.opacity = String(0.18 + 0.6 * Math.sqrt(level));
      if (n.label) n.label.setAttribute('fill', luminance(screen) > 0.38 ? 'rgba(0,0,0,0.72)' : 'rgba(255,255,255,0.9)');
    }
  }

  // --- interaction ------------------------------------------------------------

  point(event) {
    const pt = this.svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const ctm = this.svg.getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : { x: 0, y: 0 };
  }

  controlAt(p, { litOnly = false } = {}) {
    let best = null;
    for (const c of this.controls) {
      if (litOnly && !c.pins) continue;
      const r = radiusOf(c) * (c.kind === 'stick' ? 1.3 : 1.15) + 2;
      const d = Math.hypot(p.x - c.x, p.y - c.y);
      if (d <= r && (!best || d < best.d)) best = { c, d };
    }
    return best?.c || null;
  }

  controlsIn(a, b) {
    const x1 = Math.min(a.x, b.x);
    const x2 = Math.max(a.x, b.x);
    const y1 = Math.min(a.y, b.y);
    const y2 = Math.max(a.y, b.y);
    return this.controls.filter((c) => c.x >= x1 && c.x <= x2 && c.y >= y1 && c.y <= y2).map((c) => c.id);
  }

  bindPointer() {
    const svg = this.svg;
    svg.addEventListener('pointerdown', (e) => this.onDown(e));
    svg.addEventListener('pointermove', (e) => this.onMove(e));
    svg.addEventListener('pointerup', (e) => this.onUp(e));
    svg.addEventListener('pointercancel', (e) => this.onUp(e, true));
    svg.addEventListener('pointerleave', () => this.hideTooltip());
    svg.addEventListener('dblclick', (e) => {
      const hit = this.controlAt(this.point(e), { litOnly: this.mode === 'paint' });
      if (hit) this.cb.onDoubleClick?.(hit.id, e);
    });
    svg.addEventListener('contextmenu', (e) => {
      if (this.mode === 'paint' && this.controlAt(this.point(e))) e.preventDefault();
    });
  }

  onDown(e) {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const p = this.point(e);
    const paintMode = this.mode === 'paint';
    const hit = this.controlAt(p, { litOnly: paintMode });
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    const tool = paintMode ? (e.altKey ? 'pick' : this.getTool()) : 'select';
    this.svg.setPointerCapture(e.pointerId);
    this.drag = { start: p, last: p, hit, tool, additive, moved: false, touched: new Set() };

    if (tool === 'pick') {
      if (hit) this.cb.onPick?.(hit.id);
      this.drag = null;
      return;
    }
    if (tool === 'paint') {
      this.cb.onGestureStart?.();
      if (hit) {
        this.drag.touched.add(hit.id);
        this.cb.onPaint?.([hit.id]);
      }
      return;
    }
    if (hit) {
      if (this.mode === 'layout') {
        if (!this.selection.has(hit.id) || additive) this.cb.onSelect?.([hit.id], additive ? 'toggle' : 'replace');
        this.drag.moving = true;
        this.cb.onMoveStart?.();
      } else {
        this.cb.onSelect?.([hit.id], additive ? 'toggle' : 'replace');
        this.drag.touched.add(hit.id);
        this.drag.brush = true;
      }
    } else {
      this.drag.marquee = true;
      this.drag.baseSelection = additive ? new Set(this.selection) : new Set();
    }
  }

  onMove(e) {
    const p = this.point(e);
    if (!this.drag) {
      this.showTooltip(e, this.controlAt(p));
      return;
    }
    const d = this.drag;
    if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 2) return;
    d.moved = true;
    this.hideTooltip();
    if (d.tool === 'paint' || d.brush) {
      // Sample along the stroke so fast drags don't skip buttons.
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - d.last.x, p.y - d.last.y) / 4));
      const newly = [];
      for (let i = 1; i <= steps; i++) {
        const q = { x: d.last.x + ((p.x - d.last.x) * i) / steps, y: d.last.y + ((p.y - d.last.y) * i) / steps };
        const hit = this.controlAt(q, { litOnly: this.mode === 'paint' });
        if (hit && !d.touched.has(hit.id)) {
          d.touched.add(hit.id);
          newly.push(hit.id);
        }
      }
      d.last = p;
      if (newly.length) {
        if (d.tool === 'paint') this.cb.onPaint?.(newly);
        else this.cb.onSelect?.(newly, 'add');
      }
      return;
    }
    if (d.moving) {
      this.cb.onMove?.(p.x - d.start.x, p.y - d.start.y, e);
      return;
    }
    if (d.marquee) {
      const x = Math.min(d.start.x, p.x);
      const y = Math.min(d.start.y, p.y);
      Object.entries({ x, y, width: Math.abs(p.x - d.start.x), height: Math.abs(p.y - d.start.y) }).forEach(([k, v]) => this.marquee.setAttribute(k, v));
      this.marquee.setAttribute('visibility', 'visible');
      const ids = new Set([...d.baseSelection, ...this.controlsIn(d.start, p)]);
      this.cb.onSelect?.([...ids], 'replace');
    }
  }

  onUp(e, cancelled = false) {
    const d = this.drag;
    this.drag = null;
    if (this.svg.hasPointerCapture?.(e.pointerId)) this.svg.releasePointerCapture(e.pointerId);
    this.marquee.setAttribute('visibility', 'hidden');
    if (!d) return;
    if (d.tool === 'paint') this.cb.onGestureEnd?.();
    if (d.moving) this.cb.onMoveEnd?.(cancelled || !d.moved);
    if (d.marquee && !d.moved && !d.additive) this.cb.onSelect?.([], 'replace');
  }

  showTooltip(e, c) {
    if (!c || !this.cb.describe) return this.hideTooltip();
    const text = this.cb.describe(c);
    if (!text) return this.hideTooltip();
    this.tooltip.textContent = text;
    this.tooltip.hidden = false;
    const box = this.el.getBoundingClientRect();
    this.tooltip.style.left = `${e.clientX - box.left + 14}px`;
    this.tooltip.style.top = `${e.clientY - box.top + 14}px`;
  }

  hideTooltip() {
    this.tooltip.hidden = true;
  }
}
