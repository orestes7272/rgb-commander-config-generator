import { h, icon, iconButton, clear, timeAgo, formatMs } from '../dom.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { thumb } from './thumb.js';
import { confirmDialog, toast, errorToast } from './dialogs.js';
import { openPreviewDialog } from './preview-dialog.js';
import { prettyName } from '../core/rgba.js';

const size = (n) => (n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`);
const when = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Settings card listing the copies kept of replaced or deleted .rgba files. */
export class BackupsCard {
  constructor() {
    this.el = h('section.card.backups-card', { id: 'backups', 'aria-labelledby': 'backups-title' });
    this.expanded = new Set();
    this.data = null;
    this.load();
  }

  async load() {
    try {
      this.data = await api.backups();
      this.error = null;
    } catch (err) {
      this.error = err;
    }
    this.render();
  }

  render() {
    clear(this.el);
    const groups = this.data?.groups || [];
    const count = groups.reduce((n, g) => n + g.versions.length, 0);
    const total = groups.reduce((n, g) => n + g.size, 0);
    this.el.append(
      h(
        'div.card-head',
        h('h2#backups-title', 'Backups'),
        count ? h('button.btn.small.danger', { type: 'button', onclick: () => this.deleteAll(count) }, icon('trash', { size: 14 }), h('span', 'Delete all')) : null,
      ),
      h(
        'p.card-intro',
        `Copies of .rgba files this app replaced or deleted, newest first. The last ${this.data?.keep ?? 10} of each file are kept.`,
        count ? ` ${plural(count, 'backup')}, ${size(total)}.` : '',
      ),
    );
    if (this.error) {
      this.el.append(h('div.callout.error', icon('alert'), h('div', `Couldn't list the backups: ${this.error.message}`)));
      return;
    }
    if (!this.data) return this.el.append(h('p.hint', 'Loading…'));
    if (!groups.length) return this.el.append(h('p.hint', 'No backups yet. One is made whenever publishing replaces a file, or a file is deleted.'));
    // Keep a single file's history open; with several, let the user pick.
    if (groups.length === 1) this.expanded.add(groups[0].file);
    for (const g of groups) this.el.append(this.group(g));
  }

  group(g) {
    const details = h(
      'details.backup-group',
      { open: this.expanded.has(g.file) },
      h(
        'summary',
        h('span.backup-file.mono', g.file),
        h('span.backup-meta', `${plural(g.versions.length, 'version')} · ${size(g.size)} · latest ${timeAgo(g.versions[0].savedAt)}`),
        g.inOutput ? null : h('span.badge.muted-badge', { title: 'There is no file with this name in the output folder right now' }, 'not in output folder'),
        h(
          'button.btn.small.ghost.backup-group-delete',
          {
            type: 'button',
            onclick: (e) => {
              e.preventDefault();
              this.deleteGroup(g);
            },
          },
          'Delete these',
        ),
      ),
      g.versions.map((v) => this.row(g, v)),
    );
    details.addEventListener('toggle', () => (details.open ? this.expanded.add(g.file) : this.expanded.delete(g.file)));
    return details;
  }

  row(g, v) {
    const broken = Boolean(v.error);
    const picture = broken ? h('div.thumb-missing', icon('alert')) : thumb(store.layout, store.controls, v.thumb, { previewMode: store.settings.previewMode, cssWidth: 96 });
    const facts = broken ? h('span.error-text', v.error) : `${plural(v.frameCount, 'frame')}${v.frameCount > 1 ? ` · ${formatMs(v.totalMs)}` : ''} · ${size(v.size)}`;
    return h(
      'div.backup-row',
      h('button.backup-thumb', { type: 'button', title: 'Preview', disabled: broken, onclick: () => this.preview(g, v) }, picture),
      h('div.backup-text', h('strong', { title: when(v.savedAt) }, `Saved ${timeAgo(v.savedAt)}`), h('span.muted', when(v.savedAt)), h('span.muted', facts)),
      h(
        'div.backup-actions',
        iconButton('history', { label: 'Put back', cls: 'small', disabled: broken, title: 'Restore this version to the output folder', onclick: () => this.restore(g, v) }),
        iconButton('edit', { label: 'Open as scheme', cls: 'small', disabled: broken, title: 'Make a new scheme from this version', onclick: () => this.openAsScheme(g, v) }),
        iconButton('eye', { title: 'Preview', cls: 'small ghost', disabled: broken, onclick: () => this.preview(g, v) }),
        h('a.btn.small.icon-only.ghost', { href: api.backupDownloadUrl(g.file, v.id), download: g.file, title: 'Download', 'aria-label': 'Download' }, icon('download')),
        iconButton('trash', { title: 'Delete this backup', cls: 'small ghost', onclick: () => this.remove(g, v) }),
      ),
    );
  }

  async preview(g, v) {
    try {
      openPreviewDialog({
        title: `${g.file} · ${when(v.savedAt)}`,
        text: await api.backupText(g.file, v.id),
        actions: [{ label: 'Put back', icon: 'history', kind: 'ghost', onClick: () => void this.restore(g, v) }],
      });
    } catch (err) {
      errorToast(err, 'Preview failed');
    }
  }

  async restore(g, v) {
    const ok = await confirmDialog({
      title: `Put back ${g.file}?`,
      message: g.inOutput
        ? `The version saved ${when(v.savedAt)} replaces the file in the output folder now, and Syncthing sends it to the cabinet. The file there now is backed up first, so you can switch back from here.`
        : `The version saved ${when(v.savedAt)} goes back into the output folder, and Syncthing sends it to the cabinet.`,
      confirm: 'Put back',
    });
    if (!ok) return;
    try {
      await api.restoreBackup(g.file, v.id);
      toast(`Put back ${g.file}. RGBcommander loads it when it restarts.`, { kind: 'success' });
      await Promise.all([this.load(), store.refreshProjects()]);
    } catch (err) {
      errorToast(err, 'Restore failed');
    }
  }

  async openAsScheme(g, v) {
    const stamp = new Date(v.savedAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    try {
      const res = await api.importBackup(g.file, v.id, `${prettyName(g.name, store.settings.filePrefix)} (backup ${stamp})`);
      await store.refreshProjects();
      location.hash = `#/editor/${res.project.id}`;
      toast(`Opened the ${stamp} version as a new scheme. Publishing it will ask before replacing ${g.file}.`, { kind: 'success', timeout: 6000 });
    } catch (err) {
      errorToast(err, 'Could not open the backup');
    }
  }

  async remove(g, v) {
    if (!(await confirmDialog({ title: 'Delete this backup?', message: `The copy of ${g.file} saved ${when(v.savedAt)} is deleted for good.`, confirm: 'Delete', danger: true }))) return;
    try {
      await api.deleteBackup(g.file, v.id);
      await this.load();
    } catch (err) {
      errorToast(err, 'Delete failed');
    }
  }

  async deleteGroup(g) {
    if (!(await confirmDialog({ title: `Delete ${plural(g.versions.length, 'backup')} of ${g.file}?`, message: 'They are deleted for good. The file in the output folder is not touched.', confirm: 'Delete', danger: true }))) return;
    try {
      await api.deleteBackupGroup(g.file);
      await this.load();
    } catch (err) {
      errorToast(err, 'Delete failed');
    }
  }

  async deleteAll(count) {
    if (!(await confirmDialog({ title: `Delete all ${plural(count, 'backup')}?`, message: 'Every backup is deleted for good. Files in the output folder are not touched.', confirm: 'Delete all', danger: true }))) return;
    try {
      await api.deleteAllBackups();
      await this.load();
      toast('All backups deleted', { kind: 'success' });
    } catch (err) {
      errorToast(err, 'Delete failed');
    }
  }
}
