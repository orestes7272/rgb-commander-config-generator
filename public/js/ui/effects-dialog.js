import { h, clear, formatMs } from '../dom.js';
import { store } from '../store.js';
import { openDialog } from './dialogs.js';
import { PanelView } from './panel.js';
import { Player, buildSchedule, scheduleLength } from '../player.js';
import { EFFECTS, defaultParams, runEffect } from '../core/effects.js';
import { newFrame } from '../core/project.js';

const remembered = {};
let lastEffect = 'breathe';

export function openEffectsDialog() {
  if (!store.project) return;
  let effectId = lastEffect;
  let params = { ...defaultParams(EFFECTS.find((e) => e.id === effectId)), ...remembered[effectId] };
  let result = null;
  let applyBtn;

  const preview = new PanelView({ mode: 'static', className: 'effect-preview' });
  preview.setLayout(store.layout, store.controls);
  preview.setOptions({ previewMode: store.settings.previewMode });
  const player = new Player((_, pins) => preview.setPins(pins));
  const info = h('p.effect-info');
  const list = h('div.effect-list', { role: 'radiogroup', 'aria-label': 'Effect' });
  const form = h('div.effect-form');

  function ctx() {
    return {
      frames: store.project.frames,
      index: store.frameIndex,
      controls: store.controls,
      selection: store.selection,
      color: store.color,
      pinCount: store.frame.pins.length,
    };
  }

  function regenerate() {
    remembered[effectId] = params;
    result = runEffect(effectId, ctx(), params);
    const { frames } = result;
    // Inserted frames are previewed in context: this frame, the new ones, then whatever follows.
    const all = store.project.frames;
    const shown = result.mode === 'insert' ? [all[store.frameIndex], ...frames, ...(all[store.frameIndex + 1] ? [all[store.frameIndex + 1]] : [])] : frames;
    const schedule = buildSchedule(shown, store.settings);
    player.play(schedule);
    const loop = scheduleLength(schedule);
    const n = store.project.frames.length;
    info.textContent =
      result.mode === 'insert'
        ? `Adds ${frames.length} frame${frames.length === 1 ? '' : 's'} after frame ${store.frameIndex + 1}.`
        : `Replaces ${n === 1 ? 'the current frame' : `all ${n} frames`} with ${frames.length} new ones.`;
    info.textContent += ` Preview loop ≈ ${formatMs(loop)}${store.settings.simulateHardware && store.settings.frameWriteMs ? ' including estimated USB time' : ''}. Ctrl+Z undoes it.`;
    if (applyBtn) applyBtn.querySelector('span').textContent = result.mode === 'insert' ? 'Insert frames' : 'Replace frames';
  }

  function renderList() {
    clear(list);
    for (const e of EFFECTS) {
      list.append(
        h(
          'button.effect-item',
          {
            type: 'button',
            role: 'radio',
            'aria-checked': String(e.id === effectId),
            class: e.id === effectId ? 'active' : null,
            onclick: () => {
              effectId = e.id;
              lastEffect = e.id;
              params = { ...defaultParams(e), ...remembered[e.id] };
              renderList();
              renderForm();
              regenerate();
            },
          },
          h('strong', e.name),
          h('span', e.blurb),
        ),
      );
    }
  }

  function renderForm() {
    clear(form);
    const effect = EFFECTS.find((e) => e.id === effectId);
    for (const p of effect.params) {
      const id = `fx-${p.id}`;
      let input;
      if (p.type === 'select') {
        input = h(
          'select',
          { id, onchange: () => ((params[p.id] = input.value), regenerate()) },
          p.options.map(([value, label]) => h('option', { value, selected: params[p.id] === value }, label)),
        );
        if (p.id === 'scope' && !store.selection.size) {
          input.querySelector('option[value="selection"]').disabled = true;
          input.title = 'Select some buttons first to limit the effect to them';
        }
        form.append(h('label.fx-field', { for: id }, h('span', p.label), input));
      } else if (p.type === 'toggle') {
        input = h('input', { id, type: 'checkbox', checked: Boolean(params[p.id]), onchange: () => ((params[p.id] = input.checked), regenerate()) });
        form.append(h('label.check.fx-field', input, h('span', p.label)));
      } else if (p.type === 'seed') {
        form.append(
          h(
            'div.fx-field',
            h('span', p.label),
            h('button.btn.small', { type: 'button', onclick: () => ((params[p.id] = (params[p.id] || 1) + 1), regenerate()) }, 'Shuffle'),
          ),
        );
      } else {
        const val = h('output.fx-val');
        const show = () => (val.textContent = `${params[p.id]}${p.unit ? ' ' + p.unit : ''}`);
        input = h('input.slider', {
          id,
          type: 'range',
          min: p.min,
          max: p.max,
          step: p.step || 1,
          value: params[p.id],
          oninput: () => {
            params[p.id] = Number(input.value);
            show();
            regenerate();
          },
        });
        show();
        form.append(h('label.fx-field', { for: id }, h('span.fx-label', p.label, val), input));
      }
    }
  }

  renderList();
  renderForm();

  const dialog = openDialog({
    title: 'Generate an animation',
    subtitle: `Starts from frame ${store.frameIndex + 1} of “${store.project.name}”.`,
    size: 'lg',
    body: h('div.effects-layout', list, h('div.effect-main', preview.el, info, form)),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Replace frames',
        kind: 'primary',
        icon: 'sparkles',
        ref: (btn) => (applyBtn = btn),
        onClick: () => {
          const index = store.frameIndex;
          const created = result.frames.map((f) => newFrame(f.pins.length, f.ms, f.pins));
          store.changeFrames((frames) => {
            if (result.mode === 'insert') frames.splice(index + 1, 0, ...created);
            else frames.splice(0, frames.length, ...created);
          });
          store.frameIndex = result.mode === 'insert' ? index + 1 : 0;
          store.emit('frame', 'project');
        },
      },
    ],
    onClose: () => player.stop(),
  });
  regenerate();
  return dialog;
}
