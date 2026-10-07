import { h, formatMs } from '../dom.js';
import { store } from '../store.js';
import { openDialog, errorToast } from './dialogs.js';
import { PanelView } from './panel.js';
import { Player, buildSchedule, scheduleLength } from '../player.js';
import { parseRgba, expandToPins } from '../core/rgba.js';

/** Play an .rgba file on the current panel layout. */
export function openPreviewDialog({ title, text, actions = [] }) {
  let frames;
  try {
    frames = parseRgba(text).frames;
  } catch (err) {
    return errorToast(err, 'Preview failed');
  }
  const pinCount = store.board.pinCount;
  const schemeFrames = frames.map((fr) => ({ ms: fr.delay, pins: expandToPins(fr.values, pinCount) }));
  const view = new PanelView({ mode: 'static', className: 'file-preview' });
  view.setLayout(store.layout, store.controls);
  view.setOptions({ previewMode: store.settings.previewMode, showPorts: store.settings.showPorts });
  const counter = h('span.muted');
  const player = new Player((i, pins) => {
    view.setPins(pins);
    counter.textContent = `Frame ${i + 1} / ${schemeFrames.length}`;
  });
  const schedule = buildSchedule(schemeFrames, store.settings);
  if (schemeFrames.length > 1) player.play(schedule);
  else view.setPins(schemeFrames[0].pins);
  return openDialog({
    title,
    subtitle:
      schemeFrames.length > 1
        ? `${schemeFrames.length} frames · loop ≈ ${formatMs(scheduleLength(schedule))}${store.settings.simulateHardware && store.settings.frameWriteMs ? ' with estimated USB time' : ''}`
        : 'Static scheme · 1 frame',
    size: 'lg',
    body: [view.el, h('p.hint', counter, ' Shown on your current panel layout.')],
    actions: [...actions, { label: 'Close', kind: 'primary' }],
    onClose: () => player.stop(),
  });
}
