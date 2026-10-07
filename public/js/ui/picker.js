import { h, icon, clear } from '../dom.js';
import { store } from '../store.js';
import {
  rgbToHsv,
  hsvToRgb,
  toHex,
  parseHex,
  ledToScreen,
  cssRgb,
  clampByte,
  describeColor,
  LED_PALETTE,
  toTriplet,
  isOff,
  hueTrack,
} from '../core/color.js';
import { RGBCOMMANDER_COLOURS, REQUIRED_COLOUR_COUNT } from '../core/rgbcommander-colours.js';
import { frameColors } from '../core/project.js';
import { toast } from './dialogs.js';

const WHEEL = 196;

export class ColorPicker {
  constructor() {
    const hsv = rgbToHsv(store.color);
    this.hsv = { h: hsv.h, s: hsv.s, v: hsv.v };
    this.lastV = hsv.v || 255;
    this.el = h('section.picker', { 'aria-label': 'Colour picker' });
    this.build();
    this.unsubs = [
      store.on('color', () => this.syncFromStore()),
      store.on('selection', () => this.renderTarget()),
      store.on('frame', () => this.renderChips()),
      store.on('layout', () => this.renderChips()),
      store.on('recent', () => this.renderRecent()),
      store.on('settings', () => this.refresh()),
    ];
    this.refresh();
  }

  destroy() {
    this.unsubs.forEach((u) => u());
  }

  build() {
    this.preview = h('div.led-preview', { 'aria-hidden': 'true' });
    this.nameEl = h('div.color-name');
    this.valuesEl = h('button.color-values', { type: 'button', title: 'Copy as R,G,B', onclick: () => this.copyTriplet() });
    this.targetEl = h('p.picker-target');

    this.canvas = h('canvas.wheel', { width: WHEEL, height: WHEEL, 'aria-hidden': 'true' });
    this.marker = h('div.wheel-marker');
    const wheel = h('div.wheel-wrap', { style: { width: `${WHEEL}px`, height: `${WHEEL}px` } }, this.canvas, this.marker);
    this.bindWheel(wheel);

    // The wheel moves hue and saturation together; this nudges just the hue.
    this.hue = h('input.slider.hue-slider', { type: 'range', min: 0, max: 359, step: 1, 'aria-label': 'Hue' });
    this.hueVal = h('span.field-val');
    this.bindSlider(this.hue, () => {
      this.hsv.h = Number(this.hue.value);
      // White and greys have no hue to turn, so give them full colour.
      if (this.hsv.s < 0.05) this.hsv.s = 1;
      if (!this.hsv.v) this.hsv.v = this.lastV;
      this.commitColor(hsvToRgb(this.hsv), 'set');
    });

    this.brightness = h('input.slider.brightness-slider', {
      type: 'range',
      min: 0,
      max: 255,
      step: 1,
      'aria-label': 'Brightness',
    });
    this.brightnessVal = h('span.field-val');
    this.lockBtn = h('button.btn.small.toggle', { type: 'button', onclick: () => store.setKeepBrightness(!store.keepBrightness) });
    this.bindSlider(this.brightness, () => {
      const v = Number(this.brightness.value);
      this.hsv.v = v;
      if (v) this.lastV = v;
      this.commitColor(hsvToRgb(this.hsv), 'brightness');
    });

    this.channels = {};
    const rows = ['r', 'g', 'b'].map((ch) => {
      const slider = h('input.slider.channel-slider.ch-' + ch, { type: 'range', min: 0, max: 255, step: 1, 'aria-label': ch.toUpperCase() });
      const num = h('input.num', { type: 'number', min: 0, max: 255, step: 1, 'aria-label': `${ch.toUpperCase()} value` });
      this.bindSlider(slider, () => this.setChannel(ch, Number(slider.value)));
      num.addEventListener('change', () => {
        store.beginGesture();
        this.setChannel(ch, clampByte(num.value));
        store.endGesture();
        store.rememberColor();
      });
      this.channels[ch] = { slider, num };
      return h('div.channel-row', h('span.ch-label', ch.toUpperCase()), slider, num);
    });

    this.hex = h('input.hex', { type: 'text', spellcheck: 'false', maxlength: 7, 'aria-label': 'Hex value (LED values)' });
    this.hex.addEventListener('change', () => {
      const rgb = parseHex(this.hex.value);
      if (!rgb) return this.refresh();
      this.pick(rgb, { exact: true });
    });

    this.swatches = h('div.swatches');
    this.chips = h('div.chips');
    this.recentEl = h('div.swatches.recent');
    this.namedSearch = h('input.search', { type: 'search', placeholder: 'Search 141 colours…', 'aria-label': 'Search RGBcommander colours' });
    this.namedList = h('div.named-list');
    this.namedSearch.addEventListener('input', () => this.renderNamed());

    this.el.append(
      h('div.picker-head', this.preview, h('div.picker-meta', this.nameEl, this.valuesEl)),
      this.targetEl,
      h('div.wheel-row', wheel),
      h('div.field', h('div.field-head', h('label', 'Hue'), this.hueVal), this.hue),
      h('div.field', h('div.field-head', h('label', 'Brightness'), this.brightnessVal), this.brightness),
      h('div.field.lock-row', this.lockBtn),
      h('div.channels', rows),
      h('div.hex-row', h('label', 'Hex'), this.hex, h('span.hint', 'raw LED values')),
      h('div.picker-section', h('h3', 'LED colours'), this.swatches),
      h('div.picker-section', h('h3', 'In this frame', h('span.hint', 'click to select those buttons')), this.chips),
      h('div.picker-section', h('h3', 'Recent'), this.recentEl),
      h(
        'details.picker-section.named',
        h('summary', h('h3', 'RGBcommander colours', h('span.hint', 'exact rgbcmdd.xml values'))),
        this.namedSearch,
        this.namedList,
      ),
    );
    this.renderSwatches();
    this.renderNamed();
    this.renderRecent();
  }

  // --- input helpers ------------------------------------------------------------

  bindSlider(slider, onInput) {
    slider.addEventListener('input', () => {
      if (!this.sliding) {
        this.sliding = true;
        store.beginGesture();
      }
      onInput();
    });
    slider.addEventListener('change', () => {
      this.sliding = false;
      store.endGesture();
      store.rememberColor();
    });
  }

  bindWheel(wrap) {
    const set = (e) => {
      const box = this.canvas.getBoundingClientRect();
      const x = e.clientX - box.left - box.width / 2;
      const y = e.clientY - box.top - box.height / 2;
      const radius = box.width / 2 - 2;
      const hue = ((Math.atan2(x, -y) * 180) / Math.PI + 360) % 360;
      const sat = Math.min(1, Math.hypot(x, y) / radius);
      this.hsv.h = hue;
      this.hsv.s = sat;
      if (!this.hsv.v) this.hsv.v = this.lastV;
      this.commitColor(hsvToRgb(this.hsv), 'set');
    };
    wrap.addEventListener('pointerdown', (e) => {
      wrap.setPointerCapture(e.pointerId);
      this.wheelDrag = true;
      store.beginGesture();
      set(e);
    });
    wrap.addEventListener('pointermove', (e) => this.wheelDrag && set(e));
    const end = () => {
      if (!this.wheelDrag) return;
      this.wheelDrag = false;
      store.endGesture();
      store.rememberColor();
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
  }

  setChannel(ch, value) {
    const rgb = { ...store.color, [ch]: value };
    const hsv = rgbToHsv(rgb);
    if (hsv.s) this.hsv.h = hsv.h;
    this.hsv.s = hsv.s;
    this.hsv.v = hsv.v;
    if (hsv.v) this.lastV = hsv.v;
    this.commitColor(rgb, 'set');
  }

  /** A colour chosen from a swatch or list. */
  pick(rgb, { exact = false } = {}) {
    let next = rgb;
    if (!isOff(rgb)) {
      const hsv = rgbToHsv(rgb);
      if (!exact && store.keepBrightness) {
        const v = this.hsv.v || this.lastV;
        next = hsvToRgb({ h: hsv.h, s: hsv.s, v });
        this.hsv = { h: hsv.h, s: hsv.s, v };
      } else {
        this.hsv = { h: hsv.s ? hsv.h : this.hsv.h, s: hsv.s, v: hsv.v };
      }
      if (this.hsv.v) this.lastV = this.hsv.v;
    }
    store.beginGesture();
    this.commitColor(next, 'set');
    store.endGesture();
    store.rememberColor(next);
  }

  commitColor(rgb, mode) {
    this.internal = true;
    store.applyColor(rgb, { mode });
    this.internal = false;
    this.refresh();
  }

  syncFromStore() {
    if (this.internal) return;
    const hsv = rgbToHsv(store.color);
    if (hsv.v) {
      if (hsv.s) this.hsv.h = hsv.h;
      this.hsv.s = hsv.s;
      this.lastV = hsv.v;
    }
    this.hsv.v = hsv.v;
    this.refresh();
  }

  async copyTriplet() {
    const text = toTriplet(store.color);
    try {
      await navigator.clipboard.writeText(text);
      toast(`Copied ${text}`, { kind: 'success', timeout: 1800 });
    } catch {
      toast(text, { timeout: 3000 });
    }
  }

  // --- rendering ------------------------------------------------------------------

  refresh() {
    const rgb = store.color;
    const mode = store.settings?.previewMode || 'led';
    const screen = cssRgb(ledToScreen(rgb, mode));
    this.preview.style.setProperty('--c', screen);
    this.preview.classList.toggle('off', isOff(rgb));
    this.nameEl.textContent = describeColor(rgb);
    this.valuesEl.textContent = `${rgb.r}, ${rgb.g}, ${rgb.b}`;
    const hue = Math.round(this.hsv.h) % 360;
    this.hue.value = String(hue);
    this.hueVal.textContent = `${hue}°`;
    this.hue.style.setProperty('--track', hueTrack(mode, this.hsv.s));
    const pct = Math.round((this.hsv.v / 255) * 100);
    this.brightness.value = String(this.hsv.v);
    this.brightnessVal.textContent = `${pct}% · ${this.hsv.v}/255`;
    const full = cssRgb(ledToScreen(hsvToRgb({ h: this.hsv.h, s: this.hsv.s, v: 255 }), mode));
    this.brightness.style.setProperty('--track', `linear-gradient(90deg, #000, ${full})`);
    for (const ch of ['r', 'g', 'b']) {
      const { slider, num } = this.channels[ch];
      slider.value = String(rgb[ch]);
      if (document.activeElement !== num) num.value = String(rgb[ch]);
      const lo = cssRgb(ledToScreen({ ...rgb, [ch]: 0 }, mode));
      const hi = cssRgb(ledToScreen({ ...rgb, [ch]: 255 }, mode));
      slider.style.setProperty('--track', `linear-gradient(90deg, ${lo}, ${hi})`);
    }
    if (document.activeElement !== this.hex) this.hex.value = toHex(rgb);
    this.lockBtn.replaceChildren(icon(store.keepBrightness ? 'lock' : 'unlock', { size: 15 }), h('span', store.keepBrightness ? 'Swatches keep this brightness' : 'Swatches use their own brightness'));
    this.lockBtn.setAttribute('aria-pressed', String(store.keepBrightness));
    this.lockBtn.title = store.keepBrightness
      ? 'Clicking a swatch changes the hue but keeps the brightness you set. Click to turn off.'
      : 'Clicking a swatch uses its full brightness. Click to keep your brightness instead.';
    if (mode !== this.wheelMode) this.drawWheel(mode);
    const angle = ((this.hsv.h - 90) * Math.PI) / 180;
    const r = (WHEEL / 2 - 2) * this.hsv.s;
    this.marker.style.transform = `translate(${WHEEL / 2 + Math.cos(angle) * r}px, ${WHEEL / 2 + Math.sin(angle) * r}px)`;
    this.marker.style.setProperty('--c', full);
    this.renderTarget();
    this.markActiveSwatches();
  }

  drawWheel(mode) {
    this.wheelMode = mode;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.round(WHEEL * dpr);
    this.canvas.width = size;
    this.canvas.height = size;
    this.canvas.style.width = `${WHEEL}px`;
    this.canvas.style.height = `${WHEEL}px`;
    const ctx = this.canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    const c = size / 2;
    const radius = c - 2 * dpr;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x + 0.5 - c;
        const dy = y + 0.5 - c;
        const d = Math.hypot(dx, dy);
        const alpha = Math.max(0, Math.min(1, radius + 0.5 - d));
        if (!alpha) continue;
        const hue = ((Math.atan2(dx, -dy) * 180) / Math.PI + 360) % 360;
        const rgb = ledToScreen(hsvToRgb({ h: hue, s: Math.min(1, d / radius), v: 255 }), mode);
        const i = (y * size + x) * 4;
        img.data[i] = rgb.r;
        img.data[i + 1] = rgb.g;
        img.data[i + 2] = rgb.b;
        img.data[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  renderTarget() {
    const n = store.selection.size;
    const frames = store.project?.frames.length || 0;
    let text;
    if (!store.project) text = 'Open a scheme to start painting.';
    else if (!n) text = 'Brush colour. Select buttons to recolour them, or press B and paint.';
    else {
      const where = frames > 1 ? (store.applyAll ? ' in every frame' : ' in this frame') : '';
      text = `Recolouring ${n} selected button${n === 1 ? '' : 's'}${where}.`;
    }
    this.targetEl.textContent = text;
    this.targetEl.classList.toggle('active', n > 0);
  }

  swatch(rgb, title, onClick, cls = '') {
    const mode = store.settings?.previewMode || 'led';
    return h(
      'button.swatch' + cls,
      {
        type: 'button',
        title,
        'aria-label': title,
        style: { '--c': isOff(rgb) ? 'transparent' : cssRgb(ledToScreen(rgb, mode)) },
        dataset: { rgb: toTriplet(rgb) },
        onclick: onClick,
      },
      isOff(rgb) ? icon('power', { size: 14 }) : null,
    );
  }

  renderSwatches() {
    clear(this.swatches);
    for (const p of LED_PALETTE) this.swatches.append(this.swatch(p, `${p.name} (${toTriplet(p)} at full brightness)`, () => this.pick(p)));
    this.swatches.append(this.swatch({ r: 0, g: 0, b: 0 }, 'Off (0,0,0)', () => this.pick({ r: 0, g: 0, b: 0 }), '.off-swatch'));
  }

  markActiveSwatches() {
    const key = toTriplet(store.color);
    for (const el of this.el.querySelectorAll('.swatch')) el.classList.toggle('current', el.dataset.rgb === key);
  }

  renderChips() {
    clear(this.chips);
    const frame = store.frame;
    if (!frame) return;
    const colors = frameColors(frame.pins, store.controls);
    if (!colors.length) {
      this.chips.append(h('p.hint', 'No lit buttons in the layout yet.'));
      return;
    }
    const mode = store.settings?.previewMode || 'led';
    for (const { rgb, ids } of colors) {
      this.chips.append(
        h(
          'button.chip',
          {
            type: 'button',
            title: `Select the ${ids.length} button${ids.length === 1 ? '' : 's'} using ${toTriplet(rgb)}`,
            onclick: (e) => store.select(ids, e.shiftKey ? 'add' : 'replace'),
          },
          h('span.chip-dot', { style: { '--c': isOff(rgb) ? 'transparent' : cssRgb(ledToScreen(rgb, mode)) }, class: isOff(rgb) ? 'off' : null }),
          h('span', describeColor(rgb)),
          h('span.chip-count', String(ids.length)),
        ),
      );
    }
    this.markActiveSwatches();
  }

  renderRecent() {
    clear(this.recentEl);
    if (!store.recent.length) {
      this.recentEl.append(h('p.hint', 'Colours you use show up here.'));
      return;
    }
    for (const rgb of store.recent) this.recentEl.append(this.swatch(rgb, `${describeColor(rgb)} (${toTriplet(rgb)})`, () => this.pick(rgb, { exact: true })));
    this.markActiveSwatches();
  }

  renderNamed() {
    const q = this.namedSearch.value.trim().toLowerCase();
    const mode = store.settings?.previewMode || 'led';
    clear(this.namedList);
    RGBCOMMANDER_COLOURS.forEach((c, i) => {
      if (q && !c.name.toLowerCase().includes(q) && !toTriplet(c).includes(q)) return;
      this.namedList.append(
        h(
          'button.named-row',
          { type: 'button', onclick: () => this.pick(c, { exact: true }), title: i < REQUIRED_COLOUR_COUNT ? 'Required colour: MAME game colours use it' : null },
          h('span.chip-dot', { style: { '--c': isOff(c) ? 'transparent' : cssRgb(ledToScreen(c, mode)) }, class: isOff(c) ? 'off' : null }),
          h('span.named-name', c.name),
          h('span.named-rgb', toTriplet(c)),
        ),
      );
    });
  }
}

