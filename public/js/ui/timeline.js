import { h, icon, iconButton, clear, formatMs } from '../dom.js';
import { store } from '../store.js';
import { drawThumb } from './thumb.js';
import { splitDelay } from '../core/rgba.js';
import { newFrame, MAX_HOLD_MS } from '../core/project.js';
import { buildSchedule, scheduleLength } from '../player.js';

export class Timeline {
  constructor({ onPlayToggle, onEffects }) {
    this.onPlayToggle = onPlayToggle;
    this.onEffects = onEffects;
    this.cards = new Map();
    this.el = h('section.timeline', { 'aria-label': 'Animation frames' });
    this.playBtn = h('button.btn.play-btn', { type: 'button', onclick: () => this.onPlayToggle() });
    this.counter = h('span.tl-counter');
    this.applyAll = h('input', { type: 'checkbox', onchange: () => ((store.applyAll = this.applyAll.checked), store.emit('selection')) });
    this.totals = h('span.tl-totals');
    this.strip = h('div.tl-strip', { role: 'listbox', 'aria-label': 'Frames' });
    this.el.append(
      h(
        'div.tl-bar',
        this.playBtn,
        this.counter,
        h('div.tl-sep'),
        iconButton('copy', { title: 'Duplicate frame', label: 'Duplicate', onclick: () => this.duplicate() }),
        iconButton('plus', { title: 'Add a blank frame after this one', label: 'Blank', onclick: () => this.addBlank() }),
        iconButton('left', { title: 'Move frame earlier', onclick: () => this.move(-1) }),
        iconButton('right', { title: 'Move frame later', onclick: () => this.move(1) }),
        iconButton('trash', { title: 'Delete frame', onclick: () => this.remove() }),
        h('div.tl-sep'),
        iconButton('sparkles', { title: 'Generate an animation from this frame', label: 'Effects', cls: 'accent-ghost', onclick: () => this.onEffects() }),
        h('label.check.tl-all', { title: 'Colour changes go to every frame instead of just this one' }, this.applyAll, h('span', 'Edit all frames')),
        h('div.tl-spacer'),
        this.totals,
      ),
      this.strip,
    );
    this.unsubs = [
      store.on('frame', () => this.render()),
      store.on('project', () => this.render(true)),
      store.on('layout', () => this.render(true)),
      store.on('settings', () => this.render(true)),
    ];
    this.render(true);
  }

  destroy() {
    this.unsubs.forEach((u) => u());
  }

  setPlaying(playing, index) {
    this.playing = playing;
    this.playBtn.replaceChildren(icon(playing ? 'stop' : 'play', { size: 16 }), h('span', playing ? 'Stop' : 'Play'));
    this.playBtn.title = playing ? 'Stop (Space)' : 'Play the animation (Space)';
    this.playBtn.classList.toggle('playing', playing);
    for (const [, card] of this.cards) card.el.classList.remove('playing');
    if (playing && index !== undefined) {
      const frame = store.project?.frames[index];
      const card = frame && this.cards.get(frame.id);
      if (card) {
        card.el.classList.add('playing');
        card.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      }
    }
  }

  render(full = false) {
    const project = store.project;
    this.el.hidden = !project;
    if (!project) return;
    const frames = project.frames;
    const ids = frames.map((f) => f.id).join(',');
    if (full || ids !== this.lastIds) {
      this.lastIds = ids;
      clear(this.strip);
      this.cards.clear();
      frames.forEach((f, i) => this.strip.append(this.buildCard(f, i)));
    }
    frames.forEach((f, i) => {
      const card = this.cards.get(f.id);
      const key = f.pins.join(',');
      if (card.key !== key || full) {
        card.key = key;
        drawThumb(card.canvas, store.layout, store.controls, f.pins, { previewMode: store.settings.previewMode, cssWidth: 104 });
      }
      card.el.classList.toggle('active', i === store.frameIndex);
      card.el.setAttribute('aria-selected', String(i === store.frameIndex));
      card.no.textContent = String(i + 1);
      if (document.activeElement !== card.ms) card.ms.value = String(f.ms);
      const parts = splitDelay(f.ms).length;
      card.split.hidden = parts < 2;
      card.split.textContent = `×${parts}`;
      card.split.title = `RGBcommander stores at most 255 ms per frame, so this hold is written as ${parts} identical frames`;
    });
    this.applyAll.checked = store.applyAll;
    this.counter.textContent = frames.length === 1 ? 'Static scheme · 1 frame' : `Frame ${store.frameIndex + 1} of ${frames.length}`;
    const s = store.settings;
    const plain = frames.reduce((n, f) => n + f.ms, 0);
    const real = scheduleLength(buildSchedule(frames, { simulateHardware: true, frameWriteMs: s.frameWriteMs }));
    const written = frames.reduce((n, f) => n + splitDelay(f.ms).length, 0);
    this.totals.textContent = frames.length === 1 ? '' : `${written} frames in file · loop ${formatMs(plain)} of delays`;
    this.totals.title = s.frameWriteMs ? `With ~${s.frameWriteMs} ms of USB writes per frame, one loop takes about ${formatMs(real)} on the cabinet` : '';
    if (frames.length > 1 && s.frameWriteMs) this.totals.textContent += ` · ≈ ${formatMs(real)} on the cabinet`;
    this.el.classList.toggle('single', frames.length === 1);
    if (!this.playing) this.setPlaying(false);
  }

  buildCard(frame, index) {
    const canvas = h('canvas.thumb');
    const no = h('span.frame-no');
    const ms = h('input.frame-ms', { type: 'number', min: 0, max: MAX_HOLD_MS, step: 10, 'aria-label': 'Frame duration in milliseconds' });
    const split = h('span.frame-split', { hidden: true });
    ms.addEventListener('change', () => {
      const v = Math.max(0, Math.min(MAX_HOLD_MS, Math.round(Number(ms.value) || 0)));
      const i = store.project.frames.findIndex((f) => f.id === frame.id);
      store.changeFrames((frames) => {
        frames[i].ms = v;
      });
    });
    ms.addEventListener('click', (e) => e.stopPropagation());
    const el = h(
      'div.frame-card',
      {
        role: 'option',
        tabindex: 0,
        draggable: 'true',
        onclick: () => store.setFrameIndex(store.project.frames.findIndex((f) => f.id === frame.id)),
        onkeydown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            store.setFrameIndex(store.project.frames.findIndex((f) => f.id === frame.id));
          }
        },
        ondragstart: (e) => {
          e.dataTransfer.setData('text/x-frame', frame.id);
          e.dataTransfer.effectAllowed = 'move';
          el.classList.add('dragging');
        },
        ondragend: () => el.classList.remove('dragging'),
        ondragover: (e) => {
          if (e.dataTransfer.types.includes('text/x-frame')) {
            e.preventDefault();
            el.classList.add('drop-target');
          }
        },
        ondragleave: () => el.classList.remove('drop-target'),
        ondrop: (e) => {
          e.preventDefault();
          el.classList.remove('drop-target');
          const id = e.dataTransfer.getData('text/x-frame');
          const frames = store.project.frames;
          const from = frames.findIndex((f) => f.id === id);
          const to = frames.findIndex((f) => f.id === frame.id);
          if (from < 0 || to < 0 || from === to) return;
          store.changeFrames((list) => list.splice(to, 0, list.splice(from, 1)[0]));
          store.frameIndex = to;
          store.emit('frame');
        },
      },
      h('div.frame-thumb', canvas, split),
      h('div.frame-meta', no, h('label.frame-time', ms, h('span', 'ms'))),
    );
    this.cards.set(frame.id, { el, canvas, no, ms, split, key: null });
    return el;
  }

  duplicate() {
    const i = store.frameIndex;
    store.changeFrames((frames) => frames.splice(i + 1, 0, newFrame(frames[i].pins.length, frames[i].ms, frames[i].pins)));
    store.setFrameIndex(i + 1);
  }

  addBlank() {
    const i = store.frameIndex;
    store.changeFrames((frames) => frames.splice(i + 1, 0, newFrame(frames[i].pins.length, store.settings.defaultFrameMs)));
    store.setFrameIndex(i + 1);
  }

  move(delta) {
    const i = store.frameIndex;
    const j = i + delta;
    if (j < 0 || j >= store.project.frames.length) return;
    store.changeFrames((frames) => ([frames[i], frames[j]] = [frames[j], frames[i]]));
    store.frameIndex = j;
    store.emit('frame');
  }

  remove() {
    if (store.project.frames.length < 2) return;
    const i = store.frameIndex;
    store.changeFrames((frames) => frames.splice(i, 1));
    store.frameIndex = Math.min(i, store.project.frames.length - 1);
    store.emit('frame');
  }
}
