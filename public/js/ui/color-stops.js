import { h, icon, iconButton, clear } from '../dom.js';
import { store } from '../store.js';
import { LED_PALETTE, ledToScreen, cssRgb, describeColor, toTriplet, toHex, parseHex, rgbToHsv, hsvToRgb, withBrightness, isOff } from '../core/color.js';
import { blend } from '../core/gradient.js';

/**
 * Editor for 2-4 gradient colours: a row of stops plus a small picker for the
 * selected one. onChange(colors) fires on every edit.
 */
export class ColorStops {
  constructor({ colors, min = 2, max = 3, onChange }) {
    this.colors = colors.map((c) => ({ r: c.r, g: c.g, b: c.b }));
    this.min = min;
    this.max = max;
    this.onChange = onChange;
    this.active = 0;
    this.el = h('div.color-stops');
    this.render();
  }

  get previewMode() {
    return store.settings?.previewMode || 'led';
  }

  screen(rgb) {
    return isOff(rgb) ? 'transparent' : cssRgb(ledToScreen(rgb, this.previewMode));
  }

  emit() {
    this.refresh();
    this.onChange?.(this.colors.map((c) => ({ ...c })));
  }

  setActiveColor(rgb) {
    this.colors[this.active] = { r: rgb.r, g: rgb.g, b: rgb.b };
    this.emit();
  }

  render() {
    clear(this.el);
    const n = this.colors.length;
    this.stopButtons = this.colors.map((c, i) =>
      h('button.stop' + (i === this.active ? '.active' : ''), {
        type: 'button',
        'aria-pressed': String(i === this.active),
        onclick: () => {
          this.active = i;
          this.render();
        },
      }),
    );
    const row = h(
      'div.stops-row',
      this.stopButtons.flatMap((btn, i) => (i ? [h('span.stop-arrow', { 'aria-hidden': 'true' }, '→'), btn] : [btn])),
      h(
        'div.stops-actions',
        iconButton('plus', { label: 'Add colour', cls: 'small ghost', disabled: n >= this.max, title: `Up to ${this.max} colours`, onclick: () => this.add() }),
        iconButton('trash', { title: 'Remove the selected colour', cls: 'small ghost', disabled: n <= this.min, onclick: () => this.remove() }),
        iconButton('reverse', { title: 'Reverse the order', cls: 'small ghost', onclick: () => this.reverse() }),
      ),
    );
    this.bar = h('div.stops-bar', { 'aria-hidden': 'true' });

    this.brightness = h('input.slider', { type: 'range', min: 0, max: 255, step: 1, 'aria-label': 'Brightness of the selected colour' });
    this.brightness.addEventListener('input', () => this.setActiveColor(withBrightness(this.colors[this.active], Number(this.brightness.value))));
    this.brightnessVal = h('span.field-val');
    this.hex = h('input.hex', { type: 'text', maxlength: 7, spellcheck: 'false', 'aria-label': 'Hex value of the selected colour' });
    this.hex.addEventListener('change', () => {
      const rgb = parseHex(this.hex.value);
      if (rgb) this.setActiveColor(rgb);
      else this.refresh();
    });
    this.activeLabel = h('span.stop-name');

    const palette = h(
      'div.swatches',
      [...LED_PALETTE, { name: 'Off', r: 0, g: 0, b: 0 }].map((p) =>
        h(
          'button.swatch' + (isOff(p) ? '.off-swatch' : ''),
          {
            type: 'button',
            title: isOff(p) ? 'Off' : `${p.name}${store.keepBrightness ? ' (keeps this colour’s brightness)' : ''}`,
            'aria-label': p.name,
            style: { '--c': this.screen(p) },
            onclick: () => this.pick(p),
          },
          isOff(p) ? icon('power', { size: 14 }) : null,
        ),
      ),
    );
    const brush = store.color;
    const extras = h(
      'div.stop-extras',
      h('button.btn.small', { type: 'button', onclick: () => this.setActiveColor(store.color), title: `Use the brush colour (${toTriplet(brush)})` }, h('span.chip-dot', { style: { '--c': this.screen(brush) } }), h('span', 'Brush colour')),
      store.recent.slice(0, 6).map((rgb) =>
        h('button.swatch.mini', { type: 'button', title: `${describeColor(rgb)} (${toTriplet(rgb)})`, 'aria-label': describeColor(rgb), style: { '--c': this.screen(rgb) }, onclick: () => this.setActiveColor(rgb) }),
      ),
    );

    this.el.append(
      row,
      this.bar,
      h(
        'div.stop-editor',
        h('div.stop-editor-head', h('strong', `Colour ${this.active + 1}`), this.activeLabel),
        palette,
        extras,
        h('div.field', h('div.field-head', h('label', 'Brightness'), this.brightnessVal), this.brightness),
        h('div.hex-row', h('label', 'Hex'), this.hex, h('span.hint', 'raw LED values')),
      ),
    );
    this.refresh();
  }

  /** Update colours in place, so sliders keep working mid-drag. */
  refresh() {
    this.colors.forEach((c, i) => {
      const btn = this.stopButtons[i];
      btn.style.setProperty('--c', this.screen(c));
      btn.title = `Colour ${i + 1}: ${describeColor(c)} (${toTriplet(c)})`;
      btn.setAttribute('aria-label', btn.title);
      btn.classList.toggle('off', isOff(c));
    });
    const stops = this.colors.map((c, i) => `${isOff(c) ? '#202228' : cssRgb(ledToScreen(c, this.previewMode))} ${Math.round((i / (this.colors.length - 1)) * 100)}%`);
    this.bar.style.setProperty('--g', `linear-gradient(90deg, ${stops.join(', ')})`);
    const c = this.colors[this.active];
    const v = Math.max(c.r, c.g, c.b);
    if (document.activeElement !== this.brightness) this.brightness.value = String(v);
    this.brightnessVal.textContent = `${Math.round((v / 255) * 100)}% · ${v}/255`;
    const full = isOff(c) ? '#fff' : cssRgb(ledToScreen(withBrightness(c, 255), this.previewMode));
    this.brightness.style.setProperty('--track', `linear-gradient(90deg, #000, ${full})`);
    if (document.activeElement !== this.hex) this.hex.value = toHex(c);
    this.activeLabel.textContent = `${describeColor(c)} · ${toTriplet(c)}`;
  }

  pick(p) {
    if (isOff(p)) return this.setActiveColor(p);
    const current = this.colors[this.active];
    const v = Math.max(current.r, current.g, current.b);
    if (store.keepBrightness && v) {
      const { h: hue, s } = rgbToHsv(p);
      return this.setActiveColor(hsvToRgb({ h: hue, s, v }));
    }
    this.setActiveColor(p);
  }

  add() {
    if (this.colors.length >= this.max) return;
    const a = this.colors[this.active];
    const b = this.colors[this.active + 1] || this.colors[this.active - 1] || a;
    this.colors.splice(this.active + 1, 0, blend(a, b, 0.5, 'hue'));
    this.active += 1;
    this.render();
    this.emit();
  }

  remove() {
    if (this.colors.length <= this.min) return;
    this.colors.splice(this.active, 1);
    this.active = Math.max(0, this.active - 1);
    this.render();
    this.emit();
  }

  reverse() {
    this.colors.reverse();
    this.active = this.colors.length - 1 - this.active;
    this.render();
    this.emit();
  }
}
