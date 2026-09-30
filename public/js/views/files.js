import { h, icon, iconButton, clear, timeAgo, formatMs } from '../dom.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { thumb } from '../ui/thumb.js';
import { openDialog, confirmDialog, toast, errorToast } from '../ui/dialogs.js';
import { PanelView } from '../ui/panel.js';
import { Player, buildSchedule, scheduleLength } from '../player.js';
import { parseRgba, expandToPins } from '../core/rgba.js';

export class FilesView {
  constructor() {
    this.el = h('div.page.files-view');
    this.files = [];
  }

  async mount(container) {
    container.replaceChildren(this.el);
    document.title = 'Files · RGB Commander Studio';
    this.search = h('input.search', { type: 'search', placeholder: 'Filter files…', 'aria-label': 'Filter files', oninput: () => this.renderGrid() });
    this.grid = h('div.file-grid');
    this.notice = h('div');
    this.el.replaceChildren(
      h(
        'header.page-head',
        h(
          'div',
          h('h1', 'Files'),
          h('p', 'Everything in the output folder. This is the folder Syncthing sends to your cabinet, so it should mirror RGBcommander’s rgba folder.'),
        ),
        h('div.page-actions', this.search, iconButton('refresh', { label: 'Refresh', onclick: () => this.load() })),
      ),
      this.notice,
      this.grid,
    );
    await this.load();
  }

  unmount() {}

  async load() {
    clear(this.notice);
    if (store.info && !store.info.outputWritable) {
      this.notice.append(
        h(
          'div.callout.error',
          icon('alert'),
          h(
            'div',
            h('strong', 'The output folder isn’t writable. '),
            `Publishing will fail until the app (running as ${store.info.user}) can write to ${store.info.outputDir}${store.info.outputOwner ? `, which belongs to ${store.info.outputOwner}` : ''}. `,
            h('a', { href: '#/settings' }, 'How to fix it'),
          ),
        ),
      );
    }
    try {
      this.files = await api.files();
    } catch (err) {
      errorToast(err, 'Could not list files');
      this.files = [];
    }
    this.renderGrid();
  }

  renderGrid() {
    clear(this.grid);
    const q = this.search.value.trim().toLowerCase();
    const files = this.files.filter((f) => !q || f.name.toLowerCase().includes(q));
    if (!this.files.length) {
      this.grid.append(
        h(
          'div.empty-card.wide',
          h('h2', 'No .rgba files yet'),
          h('p', 'Publish a scheme and it appears here. If Syncthing syncs both ways, RGBcommander’s stock animations and your existing custom files show up here too, ready to open.'),
          h('p.hint.mono', store.info?.outputDir || ''),
        ),
      );
      return;
    }
    for (const f of files) this.grid.append(this.card(f));
  }

  card(f) {
    const linked = f.linked?.[0];
    const canvas = f.thumb ? thumb(store.layout, store.controls, f.thumb, { previewMode: store.settings.previewMode, cssWidth: 240 }) : h('div.thumb-missing', icon('alert'));
    const facts = f.error
      ? [h('span.error-text', f.error)]
      : [
          `${f.frameCount} frame${f.frameCount === 1 ? '' : 's'}`,
          f.frameCount > 1 ? formatMs(f.totalMs) : null,
          f.valuesPerFrame?.length === 1 && f.valuesPerFrame[0] !== store.board.pinCount ? `${f.valuesPerFrame[0]} values/frame` : null,
          `${(f.size / 1024).toFixed(1)} KB`,
        ].filter(Boolean);
    return h(
      'article.file-card',
      h('button.file-thumb', { type: 'button', title: f.error ? 'Cannot preview' : 'Preview', disabled: Boolean(f.error), onclick: () => this.preview(f) }, canvas, f.frameCount > 1 ? h('span.play-badge', icon('play', { size: 14 })) : null),
      h(
        'div.file-body',
        h('h3.mono', `${f.name}.rgba`),
        h('p.file-facts', facts.map((x, i) => [i ? ' · ' : '', x])),
        h('p.file-meta', `Modified ${timeAgo(f.modifiedAt)}`),
        linked ? h('p.file-linked', icon('layers', { size: 14 }), h('span', 'Scheme: '), h('a', { href: `#/editor/${linked.id}` }, linked.name)) : h('p.file-linked.muted', 'Not linked to a scheme'),
        f.warnings?.length ? h('p.file-warn', { title: f.warnings.join('\n') }, icon('alert', { size: 14 }), `${f.warnings.length} note${f.warnings.length === 1 ? '' : 's'}`) : null,
      ),
      h(
        'div.file-actions',
        linked
          ? h('a.btn.small.primary', { href: `#/editor/${linked.id}` }, icon('edit', { size: 14 }), h('span', 'Edit'))
          : h('button.btn.small.primary', { type: 'button', disabled: Boolean(f.error), onclick: () => this.importFile(f) }, icon('edit', { size: 14 }), h('span', 'Open as scheme')),
        h('a.btn.small', { href: api.fileDownloadUrl(f.name), download: `${f.name}.rgba` }, icon('download', { size: 14 }), h('span', 'Download')),
        iconButton('trash', { title: 'Delete file', cls: 'small ghost', onclick: () => this.remove(f) }),
      ),
    );
  }

  async importFile(f) {
    try {
      const res = await api.importFile(f.name);
      await store.refreshProjects();
      location.hash = `#/editor/${res.project.id}`;
      const notes = res.warnings || [];
      toast(
        h('div', h('strong', `Opened ${f.name}.rgba as a scheme`), notes.length ? h('ul', notes.map((n) => h('li', n))) : h('div', 'Edits publish back to the same file.')),
        { kind: notes.length ? 'warn' : 'success', timeout: notes.length ? 12000 : 5000 },
      );
    } catch (err) {
      errorToast(err, 'Import failed');
    }
  }

  async remove(f) {
    const ok = await confirmDialog({
      title: `Delete ${f.name}.rgba?`,
      message: `It disappears from the cabinet too once Syncthing syncs.${f.linked?.length ? ' The scheme stays in the app, so you can publish it again.' : ''} A backup copy is kept in the app’s data folder.`,
      confirm: 'Delete file',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteFile(f.name);
      toast(`Deleted ${f.name}.rgba`, { kind: 'success' });
      await Promise.all([this.load(), store.refreshProjects()]);
    } catch (err) {
      errorToast(err, 'Delete failed');
    }
  }

  async preview(f) {
    let frames;
    try {
      frames = parseRgba(await api.fileText(f.name)).frames;
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
    openDialog({
      title: `${f.name}.rgba`,
      subtitle:
        schemeFrames.length > 1
          ? `${schemeFrames.length} frames · loop ≈ ${formatMs(scheduleLength(schedule))}${store.settings.simulateHardware && store.settings.frameWriteMs ? ' with estimated USB time' : ''}`
          : 'Static scheme · 1 frame',
      size: 'lg',
      body: [view.el, h('p.hint', counter, ' Shown on your current panel layout.')],
      actions: [{ label: 'Close', kind: 'primary' }],
      onClose: () => player.stop(),
    });
  }
}
