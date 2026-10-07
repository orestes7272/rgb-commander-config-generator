import { h } from '../dom.js';
import { store } from '../store.js';
import { openDialog } from './dialogs.js';
import { PanelView } from './panel.js';
import { ColorStops } from './color-stops.js';
import { applyGradient, defaultStops, DIRECTIONS, SPACINGS, BLENDS } from '../core/gradient.js';

// The last gradient used this session, so tweaking and re-applying is quick.
let remembered = null;

export function openGradientDialog() {
  if (!store.project) return;
  const selected = store.controls.filter((c) => c.pins && store.selection.has(c.id));
  const options = { direction: 'left-right', spacing: 'even', blend: 'rgb', ...remembered?.options, scope: selected.length > 1 ? 'selection' : 'all' };
  let stops = remembered?.stops || defaultStops(store.color, store.frame.pins, store.controls);

  const preview = new PanelView({ mode: 'static', className: 'effect-preview' });
  preview.setLayout(store.layout, store.controls);
  preview.setOptions({ previewMode: store.settings.previewMode });

  const targets = () => (options.scope === 'selection' && selected.length ? selected : store.controls.filter((c) => c.pins));
  const update = () => {
    const pins = store.frame.pins.slice();
    applyGradient(pins, targets(), { stops, ...options });
    preview.setPins(pins);
    remembered = { stops, options: { direction: options.direction, spacing: options.spacing, blend: options.blend } };
  };

  const editor = new ColorStops({
    colors: stops,
    min: 2,
    max: 3,
    onChange: (colors) => {
      stops = colors;
      update();
    },
  });

  const select = (key, label, choices) =>
    h(
      'label.fx-field',
      h('span', label),
      h(
        'select',
        {
          onchange: (e) => {
            options[key] = e.target.value;
            update();
          },
        },
        choices.map(([value, text, disabled]) => h('option', { value, selected: options[key] === value, disabled }, text)),
      ),
    );

  const frames = store.project.frames.length;
  const where = frames > 1 ? (store.applyAll ? ' in every frame' : ` in frame ${store.frameIndex + 1}`) : '';
  openDialog({
    title: 'Gradient',
    subtitle: `Blend two or three colours across the buttons${where}.`,
    size: 'lg',
    body: h(
      'div.gradient-layout',
      h(
        'div.gradient-main',
        preview.el,
        h(
          'div.effect-form',
          select('direction', 'Direction', DIRECTIONS),
          select('spacing', 'Spacing', SPACINGS),
          select('blend', 'Blend', BLENDS),
          select('scope', 'Applies to', [
            ['all', 'All lit buttons'],
            ['selection', selected.length > 1 ? `The ${selected.length} selected buttons` : 'Selected buttons (select 2 or more first)', selected.length < 2],
          ]),
        ),
      ),
      editor.el,
    ),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Apply gradient',
        kind: 'primary',
        icon: 'blend',
        onClick: () => {
          const controls = targets();
          store.changeFrames(() => {
            for (const f of store.targetFrames()) applyGradient(f.pins, controls, { stops, ...options });
          });
          for (const c of [...stops].reverse()) store.rememberColor(c);
        },
      },
    ],
  });
  update();
}
