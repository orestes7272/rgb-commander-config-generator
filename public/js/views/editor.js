import { h, icon, iconButton, clear, timeAgo, isTyping, isControl } from '../dom.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { PanelView } from '../ui/panel.js';
import { ColorPicker } from '../ui/picker.js';
import { Timeline } from '../ui/timeline.js';
import { drawThumb } from '../ui/thumb.js';
import { Player, buildSchedule } from '../player.js';
import { openDialog, confirmDialog, toast, errorToast } from '../ui/dialogs.js';
import { showMenu } from '../ui/menu.js';
import { openEffectsDialog } from '../ui/effects-dialog.js';
import { openSnippetsDialog } from '../ui/snippets-dialog.js';
import { openNewSchemeDialog, openRenameDialog, importLocalFile } from '../ui/new-scheme-dialog.js';
import { getControlColor, setControlColor } from '../core/project.js';
import { mirrorName, playerOf } from '../core/layouts.js';
import { scaleColor, sameColor, toTriplet, describeColor, OFF } from '../core/color.js';
import { projectToRgba } from '../core/project.js';

const STATUS_TEXT = {
  published: ['ok', 'Published'],
  changed: ['warn', 'Unpublished changes'],
  foreign: ['warn', 'Not published yet (file name in use)'],
  unpublished: ['muted', 'Not published yet'],
};

export class EditorView {
  constructor() {
    this.el = h('div.editor');
    this.unsubs = [];
    this.player = new Player((index, pins) => {
      this.panel.setPins(pins);
      this.timeline.setPlaying(true, index);
    });
  }

  async mount(container, projectId) {
    container.replaceChildren(this.el);
    this.buildSidebar();
    this.workspace = h('section.workspace');
    this.picker = new ColorPicker();
    this.inspector = h('aside.inspector', this.picker.el);
    this.el.replaceChildren(this.sidebar, this.workspace, this.inspector);
    this.buildWorkspace();

    this.unsubs.push(
      store.on('projects', () => this.renderSchemeList()),
      store.on('project', () => this.renderHead()),
      store.on('status', () => this.renderHead()),
      store.on('save', () => this.renderSaveState()),
      store.on('frame', () => this.showFrame()),
      store.on('selection', () => this.panel.setSelection(store.selection)),
      store.on('layout', () => this.renderLayout()),
      store.on('tool', () => this.renderTools()),
      store.on('settings', () => this.renderLayout()),
      store.on('conflict', () => this.onConflict()),
      store.on('error', () => this.onSaveError()),
      store.on('warnings', () => this.showWarnings()),
    );
    this.onKey = (e) => this.handleKey(e);
    document.addEventListener('keydown', this.onKey);
    await this.open(projectId);
  }

  unmount() {
    this.stop();
    this.unsubs.forEach((u) => u());
    this.picker.destroy();
    this.timeline.destroy();
    document.removeEventListener('keydown', this.onKey);
  }

  async open(projectId) {
    let id = projectId || store.lastProjectId;
    // No (valid) scheme in the URL or remembered: open the most recently edited one.
    if (!projectId && !store.projects.some((p) => p.id === id)) id = store.projects[0]?.id;
    const exists = id && store.projects.some((p) => p.id === id);
    if (projectId && !exists) toast('That scheme no longer exists', { kind: 'warn' });
    this.stop();
    if (exists) {
      try {
        await store.openProject(id);
        if (!projectId) history.replaceState(null, '', `#/editor/${id}`);
      } catch (err) {
        errorToast(err, 'Could not open the scheme');
      }
    } else if (store.project) {
      store.closeProject();
    }
    this.renderLayout();
    this.renderHead();
    this.renderSchemeList();
    this.showFrame();
  }

  // --- sidebar ----------------------------------------------------------------

  buildSidebar() {
    this.search = h('input.search', { type: 'search', placeholder: 'Filter schemes…', 'aria-label': 'Filter schemes', oninput: () => this.renderSchemeList() });
    this.list = h('ul.scheme-list');
    const fileInput = h('input', { type: 'file', accept: '.rgba,.xml', hidden: true });
    fileInput.addEventListener('change', () => {
      if (fileInput.files[0]) importLocalFile(fileInput.files[0]);
      fileInput.value = '';
    });
    this.sidebar = h(
      'aside.sidebar',
      { 'aria-label': 'Schemes' },
      h('div.sidebar-head', h('h2', 'Schemes'), iconButton('plus', { label: 'New', cls: 'primary small', onclick: () => openNewSchemeDialog() })),
      this.search,
      this.list,
      h('div.sidebar-foot', iconButton('upload', { label: 'Import .rgba…', cls: 'ghost small', title: 'Import an .rgba file from this computer', onclick: () => fileInput.click() }), fileInput),
    );
  }

  renderSchemeList() {
    const q = this.search.value.trim().toLowerCase();
    clear(this.list);
    const items = store.projects.filter((p) => !q || p.name.toLowerCase().includes(q) || p.fileName.toLowerCase().includes(q));
    if (!store.projects.length) {
      this.list.append(h('li.empty-note', 'No schemes yet.'));
      return;
    }
    if (!items.length) this.list.append(h('li.empty-note', 'Nothing matches.'));
    for (const p of items) {
      const canvas = h('canvas.thumb');
      drawThumb(canvas, store.layout, store.controls, p.thumb, { previewMode: store.settings.previewMode, cssWidth: 76 });
      const [tone, label] = STATUS_TEXT[p.status] || STATUS_TEXT.unpublished;
      this.list.append(
        h(
          'li.scheme-item' + (store.project?.id === p.id ? '.active' : ''),
          h(
            'a',
            { href: `#/editor/${p.id}`, 'aria-current': store.project?.id === p.id ? 'page' : null },
            canvas,
            h(
              'div.scheme-text',
              h('strong', p.name),
              h('span.mono', `${p.fileName}.rgba`),
              h('span.scheme-status', h('span.dot.' + tone), p.frameCount > 1 ? `${label} · ${p.frameCount} frames` : label),
            ),
          ),
        ),
      );
    }
  }

  // --- workspace ----------------------------------------------------------------

  buildWorkspace() {
    this.titleBtn = h('button.scheme-title', { type: 'button', title: 'Rename', onclick: () => store.project && openRenameDialog() });
    this.saveStateEl = h('span.save-state');
    this.statusEl = h('span.publish-status');
    this.publishBtn = h('button.btn.primary.publish-btn', { type: 'button', title: 'Write the .rgba file to the output folder (Ctrl+Enter)', onclick: () => this.publish() }, icon('send'), h('span', 'Publish'));
    this.moreBtn = iconButton('more', { title: 'More actions', onclick: () => this.moreMenu() });
    this.head = h(
      'header.scheme-head',
      h('button.btn.icon-only.ghost.sidebar-toggle', { type: 'button', 'aria-label': 'Show schemes', onclick: () => this.el.classList.toggle('show-sidebar') }, icon('menu')),
      h('div.scheme-title-wrap', this.titleBtn),
      h('div.head-spacer'),
      this.saveStateEl,
      this.statusEl,
      iconButton('code', { label: 'rgbcmdd.xml', title: 'Snippets for RGBcommander’s config file', cls: 'ghost', onclick: () => openSnippetsDialog() }),
      this.moreBtn,
      this.publishBtn,
    );

    this.toolBtns = {
      select: iconButton('select', { title: 'Select buttons', kbd: 'V', onclick: () => store.setTool('select') }),
      paint: iconButton('paint', { title: 'Paint with the brush colour', kbd: 'B', onclick: () => store.setTool('paint') }),
      pick: iconButton('pick', { title: 'Pick a colour from a button', kbd: 'I or Alt+click', onclick: () => store.setTool('pick') }),
    };
    this.groupBar = h('div.group-bar', { role: 'group', 'aria-label': 'Quick select' });
    this.undoBtn = iconButton('undo', { title: 'Undo', kbd: 'Ctrl+Z', onclick: () => store.undo() });
    this.redoBtn = iconButton('redo', { title: 'Redo', kbd: 'Ctrl+Shift+Z', onclick: () => store.redo() });
    this.portsBtn = h('button.btn.small.toggle', { type: 'button', title: 'Show LED port numbers on the panel', onclick: () => store.saveSettings({ showPorts: !store.settings.showPorts }) }, icon('hash', { size: 15 }), h('span', 'Ports'));
    this.unsubs.push(store.on('history', () => this.renderHistory()));
    const toolbar = h(
      'div.toolbar',
      h('div.tool-group', { role: 'group', 'aria-label': 'Tools' }, Object.values(this.toolBtns)),
      h('div.tl-sep'),
      this.groupBar,
      h('div.tl-sep'),
      iconButton('paint', { label: 'Fill', title: 'Give the selection (or every button) the brush colour', cls: 'small', onclick: () => this.fill() }),
      iconButton('mirror', { label: 'Mirror', title: 'Copy colours between players', cls: 'small', onclick: (e) => this.mirrorMenu(e.currentTarget) }),
      iconButton('moon', { title: 'Dim selection (or everything) 20%', kbd: '[', cls: 'small', onclick: () => this.scale(0.8) }),
      iconButton('sun', { title: 'Brighten selection (or everything) 25%', kbd: ']', cls: 'small', onclick: () => this.scale(1.25) }),
      iconButton('power', { title: 'Turn selected buttons off', kbd: 'Del', cls: 'small', onclick: () => this.turnOff() }),
      h('div.tl-spacer'),
      this.portsBtn,
      this.undoBtn,
      this.redoBtn,
    );

    this.panel = new PanelView({
      mode: 'paint',
      getTool: () => store.tool,
      callbacks: {
        onSelect: (ids, mode) => {
          this.stop();
          store.select(ids, mode);
        },
        onPaint: (ids) => {
          this.stop();
          store.paint(ids);
        },
        onGestureStart: () => store.beginGesture(),
        onGestureEnd: () => {
          store.endGesture();
          store.rememberColor();
        },
        onPick: (id) => this.pickFrom(id),
        onDoubleClick: (id) => this.selectSameColor(id),
        describe: (c) => this.describeControl(c),
      },
    });
    this.stage = h('div.stage', this.panel.el);
    this.empty = h('div.empty-state');
    this.timeline = new Timeline({ onPlayToggle: () => this.togglePlay(), onEffects: () => (this.stop(), openEffectsDialog()) });
    this.workspace.replaceChildren(this.head, toolbar, this.stage, this.empty, this.timeline.el);
    this.renderTools();
    this.renderHistory();
  }

  renderLayout() {
    this.panel.setLayout(store.layout, store.controls);
    this.panel.setOptions({ previewMode: store.settings.previewMode, showPorts: store.settings.showPorts });
    this.panel.setSelection(store.selection);
    this.portsBtn.setAttribute('aria-pressed', String(store.settings.showPorts));
    this.renderGroups();
    this.showFrame();
    this.renderSchemeList();
  }

  renderGroups() {
    clear(this.groupBar);
    const lit = store.controls.filter((c) => c.pins);
    const groups = [['All', lit]];
    const players = [...new Set(lit.map((c) => playerOf(c.name)).filter(Boolean))].sort();
    for (const p of players) groups.push([`P${p}`, lit.filter((c) => playerOf(c.name) === p)]);
    const startCoin = lit.filter((c) => /_(START|COIN)$/.test(c.name));
    if (startCoin.length) groups.push(['Start/Coin', startCoin]);
    for (const [label, controls] of groups) {
      this.groupBar.append(
        h(
          'button.btn.small.chip-btn',
          {
            type: 'button',
            title: `Select ${label === 'All' ? 'every lit button' : label} (Shift adds to the selection)`,
            onclick: (e) => store.select(controls.map((c) => c.id), e.shiftKey ? 'add' : 'replace'),
          },
          label,
        ),
      );
    }
    this.groupBar.append(h('button.btn.small.chip-btn.ghost', { type: 'button', title: 'Clear selection (Esc)', onclick: () => store.select([]) }, 'None'));
  }

  renderTools() {
    for (const [tool, btn] of Object.entries(this.toolBtns)) btn.setAttribute('aria-pressed', String(store.tool === tool));
    this.stage.dataset.tool = store.tool;
  }

  renderHistory() {
    this.undoBtn.disabled = !store.history.past.length;
    this.redoBtn.disabled = !store.history.future.length;
  }

  renderHead() {
    const p = store.project;
    this.workspace.classList.toggle('no-project', !p);
    this.stage.hidden = !p;
    this.empty.hidden = Boolean(p);
    this.publishBtn.disabled = !p;
    this.moreBtn.disabled = !p;
    if (!p) {
      this.renderEmpty();
      this.titleBtn.replaceChildren(h('span.scheme-name', 'No scheme open'));
      this.statusEl.replaceChildren();
      document.title = 'RGB Commander Studio';
      return;
    }
    document.title = `${p.name} · RGB Commander Studio`;
    this.titleBtn.replaceChildren(h('span.scheme-name', p.name, icon('edit', { size: 14 })), h('span.scheme-file.mono', `${p.fileName}.rgba`));
    const [tone, label] = STATUS_TEXT[store.status] || STATUS_TEXT.unpublished;
    this.statusEl.replaceChildren(
      h('span.dot.' + tone),
      h('span', label),
      ...(store.status === 'published' && p.publishedAt ? [h('span.muted', ` · ${timeAgo(p.publishedAt)}`)] : []),
    );
    this.statusEl.title =
      store.status === 'foreign'
        ? `${p.fileName}.rgba already exists in the output folder. Publishing will ask before replacing it.`
        : store.status === 'changed'
          ? 'The file in the output folder is older than what you see here.'
          : '';
    this.renderSaveState();
    this.renderSchemeList();
  }

  renderSaveState() {
    const text = { saved: 'Saved', dirty: 'Saving…', saving: 'Saving…', error: 'Not saved!' }[store.saveState];
    this.saveStateEl.textContent = store.project ? text : '';
    this.saveStateEl.className = 'save-state ' + store.saveState;
  }

  renderEmpty() {
    clear(this.empty);
    const hasSchemes = store.projects.length > 0;
    this.empty.append(
      h(
        'div.empty-card',
        h('div.empty-leds', ['#ff2d55', '#ffcc00', '#34c759', '#0a84ff', '#bf5af2'].map((c) => h('span', { style: { '--c': c } }))),
        h('h2', hasSchemes ? 'Pick a scheme to edit' : 'Design your first lighting scheme'),
        h(
          'p',
          'Paint your buttons, preview them glowing like the real LEDs, and publish an .rgba file that Syncthing carries to your cabinet.',
        ),
        h(
          'div.empty-actions',
          h('button.btn.primary', { type: 'button', onclick: () => openNewSchemeDialog() }, icon('plus'), h('span', 'New scheme')),
          h('a.btn', { href: '#/files' }, icon('folder'), h('span', 'Open an existing .rgba')),
        ),
        h('p.hint', 'Using the “', h('a', { href: '#/layout' }, templateName()), '” panel layout. Make it match your cabinet first so the preview and wiring are right.'),
      ),
    );
  }

  showFrame() {
    if (!store.project || this.player.playing) return;
    this.panel.setPins(store.frame.pins);
    this.panel.setSelection(store.selection);
  }

  describeControl(c) {
    const port = c.wiring?.mode === 'port' ? `port ${c.wiring.port}` : c.wiring?.mode === 'pins' ? `pins ${c.pins?.r},${c.pins?.g},${c.pins?.b}` : c.wiring?.mode === 'single' ? `pin ${c.wiring.pin}` : 'no LED';
    const name = c.name || c.label || c.kind;
    if (!c.pins || !store.frame) return `${name} · ${port}`;
    const rgb = getControlColor(store.frame.pins, c.pins);
    return `${name} · ${port} · ${describeColor(rgb)} (${toTriplet(rgb)})`;
  }

  // --- actions ----------------------------------------------------------------------

  pickFrom(id) {
    const rgb = store.colorOf(id);
    if (!rgb) return;
    store.setBrush({ r: rgb.r, g: rgb.g, b: rgb.b });
    if (store.tool === 'pick') store.setTool(store.previousTool && store.previousTool !== 'pick' ? store.previousTool : 'paint');
    toast(`Picked ${describeColor(rgb)} (${toTriplet(rgb)})`, { timeout: 1600 });
  }

  selectSameColor(id) {
    const rgb = store.colorOf(id);
    if (!rgb) return;
    const ids = store.controls.filter((c) => c.pins && sameColor(getControlColor(store.frame.pins, c.pins), rgb)).map((c) => c.id);
    store.select(ids);
  }

  targets() {
    const ids = store.selection.size ? [...store.selection] : store.controls.filter((c) => c.pins).map((c) => c.id);
    return ids.map((id) => store.controlById.get(id)).filter((c) => c?.pins);
  }

  fill() {
    this.stop();
    store.paint(this.targets().map((c) => c.id));
    store.rememberColor();
  }

  scale(factor) {
    this.stop();
    const controls = this.targets();
    store.changeFrames(() => {
      for (const f of store.targetFrames()) for (const c of controls) setControlColor(f.pins, c.pins, scaleColor(getControlColor(f.pins, c.pins), factor));
    });
    store.syncColorFromSelection();
  }

  turnOff() {
    if (!store.selection.size) return toast('Select the buttons to turn off first', { timeout: 2200 });
    this.stop();
    store.paint([...store.selection], OFF);
  }

  mirrorMenu(anchor) {
    const copy = (from, to) => () => {
      const pairs = store.controls
        .filter((c) => c.pins && playerOf(c.name) === from)
        .map((c) => [c, store.controls.find((d) => d.pins && d.name === mirrorName(c.name))])
        .filter(([, d]) => d);
      if (!pairs.length) return toast(`No P${from}_… buttons with a matching P${to}_… name`, { kind: 'warn' });
      store.changeFrames(() => {
        for (const f of store.targetFrames()) {
          const src = f.pins.slice();
          for (const [a, b] of pairs) {
            setControlColor(f.pins, b.pins, getControlColor(src, a.pins));
            if (to === 0) setControlColor(f.pins, a.pins, getControlColor(src, b.pins));
          }
        }
      });
      toast(`${to === 0 ? 'Swapped' : 'Copied'} ${pairs.length} button colours`, { kind: 'success', timeout: 1800 });
    };
    showMenu(anchor, [
      { label: 'Copy P1 colours to P2', icon: 'right', onClick: copy(1, 2) },
      { label: 'Copy P2 colours to P1', icon: 'left', onClick: copy(2, 1) },
      { label: 'Swap P1 and P2', icon: 'mirror', onClick: copy(1, 0) },
    ]);
  }

  moreMenu() {
    const p = store.project;
    showMenu(this.moreBtn, [
      { label: 'Rename…', icon: 'edit', onClick: () => openRenameDialog() },
      { label: 'Duplicate scheme', icon: 'copy', onClick: () => this.duplicate() },
      { label: 'Download .rgba', icon: 'download', onClick: () => this.download() },
      { label: 'Keyboard shortcuts', icon: 'keyboard', hint: '?', onClick: () => showShortcuts() },
      'sep',
      { label: 'Delete scheme…', icon: 'trash', danger: true, onClick: () => this.deleteScheme(p) },
    ]);
  }

  async duplicate() {
    try {
      await store.flushSave();
      const res = await api.duplicateProject(store.project.id);
      await store.refreshProjects();
      location.hash = `#/editor/${res.project.id}`;
      toast(`Created “${res.project.name}”`, { kind: 'success' });
    } catch (err) {
      errorToast(err, 'Duplicate failed');
    }
  }

  download() {
    const p = store.project;
    const text = projectToRgba(p, { eol: store.settings.eol === 'lf' ? '\n' : '\r\n' });
    const url = URL.createObjectURL(new Blob([text], { type: 'application/xml' }));
    const a = h('a', { href: url, download: `${p.fileName}.rgba` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async deleteScheme(p) {
    const withFile = h('input', { type: 'checkbox' });
    const ok = await confirmDialog({
      title: `Delete “${p.name}”?`,
      message: 'The scheme is removed from this app. This can’t be undone.',
      extra: h('label.check', withFile, h('span', `Also delete ${p.fileName}.rgba from the output folder (a backup is kept)`)),
      confirm: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      store.scheduleSave.cancel();
      await api.deleteProject(p.id, withFile.checked);
      store.closeProject();
      await store.refreshProjects();
      const next = store.projects[0];
      location.hash = next ? `#/editor/${next.id}` : '#/editor';
      toast(`Deleted “${p.name}”`, { kind: 'success' });
    } catch (err) {
      errorToast(err, 'Delete failed');
    }
  }

  async publish(overwrite = false) {
    if (!store.project) return;
    this.publishBtn.disabled = true;
    try {
      const res = await store.publish({ overwrite });
      toast(
        h(
          'div',
          h('strong', `Published ${res.file}`),
          h('div', 'Syncthing will carry it to the cabinet. RGBcommander loads new files when it restarts.'),
          res.backup ? h('div.muted', `The previous version was backed up (${res.backup}).`) : null,
        ),
        { kind: 'success', timeout: 7000 },
      );
    } catch (err) {
      if (err.code === 'exists') {
        const ok = await confirmDialog({
          title: `Replace ${store.project.fileName}.rgba?`,
          message: 'A file with this name is already in the output folder and wasn’t written by this scheme. Publishing replaces it on the cabinet too. A backup of the current file is kept in the app’s data folder.',
          confirm: 'Replace file',
          danger: true,
        });
        if (ok) return this.publish(true);
      } else errorToast(err, 'Publish failed');
    } finally {
      this.publishBtn.disabled = !store.project;
    }
  }

  // --- playback -------------------------------------------------------------------

  togglePlay() {
    if (this.player.playing) return this.stop();
    if (!store.project) return;
    if (store.project.frames.length < 2) return toast('Add a second frame (or use Effects) to animate.', { timeout: 2500 });
    const schedule = buildSchedule(store.project.frames, store.settings);
    const start = schedule.findIndex((s) => s.index === store.frameIndex);
    this.player.play(schedule, { startAt: Math.max(0, start) });
    store.playing = true;
  }

  stop() {
    if (!this.player.playing) return;
    this.player.stop();
    store.playing = false;
    this.timeline.setPlaying(false);
    this.showFrame();
  }

  // --- keyboard -------------------------------------------------------------------

  handleKey(e) {
    if (document.querySelector('dialog[open]') || isTyping(e)) return;
    const mod = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    // Sliders, checkboxes and buttons keep their own arrow/space/enter behaviour.
    if (!mod && isControl(e.target) && /^(Arrow|Enter$| $|Home$|End$|Page)/.test(e.key)) return;
    if (mod && key === 'z') {
      e.preventDefault();
      this.stop();
      return e.shiftKey ? store.redo() : store.undo();
    }
    if (mod && key === 'y') {
      e.preventDefault();
      this.stop();
      return store.redo();
    }
    if (mod && key === 's') {
      e.preventDefault();
      return store.flushSave().then(() => toast('Saved', { kind: 'success', timeout: 1200 }));
    }
    if (mod && key === 'enter') {
      e.preventDefault();
      return this.publish();
    }
    if (!store.project) return;
    if (mod && key === 'a') {
      e.preventDefault();
      return store.select(store.controls.filter((c) => c.pins).map((c) => c.id));
    }
    if (mod && key === 'c' && store.primary) {
      const rgb = store.colorOf(store.primary);
      this.clipboard = { r: rgb.r, g: rgb.g, b: rgb.b };
      return toast(`Copied ${toTriplet(rgb)}`, { timeout: 1200 });
    }
    if (mod && key === 'v' && this.clipboard && store.selection.size) {
      e.preventDefault();
      store.setBrush(this.clipboard);
      return store.paint([...store.selection], this.clipboard);
    }
    if (mod || e.altKey) return;
    switch (e.key) {
      case 'v':
      case 'V':
        return store.setTool('select');
      case 'b':
      case 'B':
        return store.setTool('paint');
      case 'i':
      case 'I':
        return store.setTool('pick');
      case 'Escape':
        if (this.player.playing) return this.stop();
        return store.select([]);
      case 'Delete':
      case 'Backspace':
        e.preventDefault();
        return this.turnOff();
      case ' ':
        e.preventDefault();
        return this.togglePlay();
      case 'ArrowLeft':
        e.preventDefault();
        this.stop();
        return store.setFrameIndex(store.frameIndex - 1);
      case 'ArrowRight':
        e.preventDefault();
        this.stop();
        return store.setFrameIndex(store.frameIndex + 1);
      case '[':
        return this.scale(0.8);
      case ']':
        return this.scale(1.25);
      case '?':
        return showShortcuts();
      default:
    }
  }

  // --- save problems ----------------------------------------------------------------

  async onConflict() {
    const choice = await openDialog({
      title: 'This scheme changed somewhere else',
      size: 'sm',
      body: h('p', 'Another browser tab (or device) saved this scheme after you opened it. Keep your version, or load theirs?'),
      actions: [
        { label: 'Load theirs', value: 'theirs', kind: 'ghost' },
        { label: 'Keep mine', value: 'mine', kind: 'primary' },
      ],
    }).result;
    const id = store.project.id;
    if (choice === 'mine') {
      await store.forceSave().catch((err) => errorToast(err, 'Save failed'));
    } else {
      store.project = null;
      await store.openProject(id);
      this.renderHead();
      this.showFrame();
    }
  }

  onSaveError() {
    const now = Date.now();
    if (this.lastErrorAt && now - this.lastErrorAt < 10000) return;
    this.lastErrorAt = now;
    errorToast(store.saveError, 'Changes are not being saved');
  }

  showWarnings() {
    this.shownWarnings ??= new Set();
    for (const w of store.lastWarnings || []) {
      if (this.shownWarnings.has(w)) continue;
      this.shownWarnings.add(w);
      toast(w, { kind: 'warn', timeout: 8000 });
    }
  }
}

function templateName() {
  const names = {
    'two-player-6': '2 players · 6 buttons',
    'two-player-8': '2 players · 8 buttons',
    'two-player-6-trackball': '2 players + trackball',
    'four-player': '4 players',
    'led-grid': 'LED port grid',
  };
  return names[store.layout.template] || 'custom';
}

export function showShortcuts() {
  const rows = [
    ['V / B / I', 'Select, paint, pick colour'],
    ['Alt + click', 'Pick a button’s colour'],
    ['Drag', 'Select (or paint) several buttons'],
    ['Double-click', 'Select every button with that colour'],
    ['Shift / Ctrl + click', 'Add to / remove from the selection'],
    ['Ctrl + A', 'Select every lit button'],
    ['Esc', 'Clear selection / stop playback'],
    ['Del', 'Turn selected buttons off'],
    ['[ and ]', 'Dim / brighten'],
    ['Ctrl + C / Ctrl + V', 'Copy a button’s colour / paste onto the selection'],
    ['← / →', 'Previous / next frame'],
    ['Space', 'Play / stop'],
    ['Ctrl + Z / Ctrl + Shift + Z', 'Undo / redo'],
    ['Ctrl + S', 'Save now (it autosaves anyway)'],
    ['Ctrl + Enter', 'Publish'],
  ];
  openDialog({
    title: 'Keyboard shortcuts',
    size: 'sm',
    body: h('dl.shortcuts', rows.map(([k, v]) => [h('dt', h('kbd', k)), h('dd', v)])),
    actions: [{ label: 'Close', kind: 'primary' }],
  });
}

