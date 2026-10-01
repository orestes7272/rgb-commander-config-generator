import { api } from './api.js';
import { debounce } from './dom.js';
import { getBoard } from './core/boards.js';
import { resolveControls, getControlColor, setControlColor } from './core/project.js';
import { withBrightness, sameColor, isOff } from './core/color.js';

const LOCAL_KEY = 'rgbcs:v1';

function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY)) || {};
  } catch {
    return {};
  }
}

function saveLocal(patch) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify({ ...loadLocal(), ...patch }));
  } catch {
    // private mode or storage disabled: preferences just won't stick
  }
}

class History {
  constructor(limit = 200) {
    this.limit = limit;
    this.past = [];
    this.future = [];
  }
  record(snapshot) {
    this.past.push(snapshot);
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
  }
  clear() {
    this.past = [];
    this.future = [];
  }
}

const clone = (v) => structuredClone(v);

export class Store {
  constructor() {
    const local = loadLocal();
    this.listeners = new Map();
    this.info = null;
    this.settings = null;
    this.layout = null;
    this.controls = [];
    this.controlById = new Map();
    this.projects = [];
    this.project = null;
    this.status = 'unpublished';
    this.frameIndex = 0;
    this.selection = new Set();
    this.primary = null;
    this.tool = 'select';
    this.color = local.color || { r: 0, g: 0, b: 255 };
    this.keepBrightness = local.keepBrightness ?? true;
    this.recent = local.recent || [];
    this.applyAll = false;
    this.playing = false;
    this.saveState = 'saved';
    this.history = new History();
    this.layoutHistory = new History(100);
    this.gesture = null;
    this.editVersion = 0;
    this.savedVersion = 0;
    this.scheduleSave = debounce(() => this.saveProject(), 700);
    this.scheduleLayoutSave = debounce(() => this.saveLayout(), 600);
  }

  // --- events ---------------------------------------------------------------

  on(topic, fn) {
    if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
    this.listeners.get(topic).add(fn);
    return () => this.listeners.get(topic).delete(fn);
  }

  emit(...topics) {
    for (const topic of topics) for (const fn of this.listeners.get(topic) || []) fn();
  }

  // --- loading --------------------------------------------------------------

  async boot() {
    const [info, settings, layout, projects] = await Promise.all([api.info(), api.settings(), api.layout(), api.projects()]);
    this.info = info;
    this.settings = settings;
    this.setLayout(layout, { save: false });
    this.projects = projects;
  }

  /** Re-read server facts (folders, permissions). Emits 'info' when something changed. */
  async refreshInfo() {
    const info = await api.info();
    const changed = JSON.stringify(info) !== JSON.stringify(this.info);
    this.info = info;
    if (changed) this.emit('info');
    return info;
  }

  get board() {
    return getBoard(this.layout?.board);
  }

  get frame() {
    return this.project?.frames[this.frameIndex] || null;
  }

  setLayout(layout, { save = true, record = false } = {}) {
    if (record && this.layout) this.layoutHistory.record(clone(this.layout));
    this.layout = layout;
    this.controls = resolveControls(layout);
    this.controlById = new Map(this.controls.map((c) => [c.id, c]));
    for (const id of [...this.selection]) if (!this.controlById.has(id)) this.selection.delete(id);
    if (save) this.scheduleLayoutSave();
    this.emit('layout');
  }

  async saveLayout() {
    try {
      const saved = await api.saveLayout(this.layout);
      // Keep local object identity; the server only normalises values.
      this.layout.width = saved.width;
      this.layout.height = saved.height;
    } catch (err) {
      this.emit('error');
      throw err;
    }
  }

  undoLayout() {
    if (!this.layoutHistory.past.length) return;
    this.layoutHistory.future.push(clone(this.layout));
    this.setLayout(this.layoutHistory.past.pop());
  }

  redoLayout() {
    if (!this.layoutHistory.future.length) return;
    this.layoutHistory.past.push(clone(this.layout));
    this.setLayout(this.layoutHistory.future.pop());
  }

  async refreshProjects() {
    this.projects = await api.projects();
    this.emit('projects');
  }

  async openProject(id) {
    if (this.project?.id === id) return;
    await this.flushSave();
    const { project, status } = await api.project(id);
    this.project = project;
    this.status = status;
    this.frameIndex = 0;
    this.selection.clear();
    this.primary = null;
    this.history.clear();
    this.editVersion = this.savedVersion = 0;
    this.saveState = 'saved';
    saveLocal({ lastProject: id });
    this.emit('project', 'frame', 'selection', 'history', 'save', 'status');
  }

  closeProject() {
    this.project = null;
    this.emit('project', 'frame', 'selection', 'history', 'save', 'status');
  }

  get lastProjectId() {
    return loadLocal().lastProject;
  }

  // --- editing --------------------------------------------------------------

  snapshot() {
    return { frames: clone(this.project.frames), frameIndex: this.frameIndex };
  }

  beginGesture() {
    this.gesture = { recorded: false };
  }

  endGesture() {
    this.gesture = null;
  }

  /** Run fn(frames) as one undoable edit of the current scheme. */
  changeFrames(fn, { record = true } = {}) {
    if (!this.project) return;
    if (record && !(this.gesture && this.gesture.recorded)) {
      const snap = this.snapshot();
      this.history.record(snap);
      if (this.gesture) {
        this.gesture.recorded = true;
        this.gesture.base = snap.frames;
      }
    }
    fn(this.project.frames);
    this.markDirty();
    this.emit('frame', 'history');
  }

  /** Frames an edit should touch: the current one, or all of them. */
  targetFrames() {
    return this.applyAll ? this.project.frames : [this.frame];
  }

  markDirty() {
    this.editVersion++;
    this.saveState = 'dirty';
    this.emit('save');
    this.scheduleSave();
  }

  undo() {
    if (!this.project || !this.history.past.length) return;
    this.history.future.push(this.snapshot());
    this.restore(this.history.past.pop());
  }

  redo() {
    if (!this.project || !this.history.future.length) return;
    this.history.past.push(this.snapshot());
    this.restore(this.history.future.pop());
  }

  restore(snap) {
    this.project.frames = snap.frames;
    this.frameIndex = Math.min(snap.frameIndex, snap.frames.length - 1);
    this.markDirty();
    this.emit('frame', 'project', 'history');
  }

  setMeta(patch) {
    Object.assign(this.project, patch);
    this.markDirty();
    this.emit('project');
  }

  setFrameIndex(i) {
    if (!this.project) return;
    const next = Math.max(0, Math.min(this.project.frames.length - 1, i));
    if (next === this.frameIndex) return;
    this.frameIndex = next;
    this.syncColorFromSelection();
    this.emit('frame');
  }

  colorOf(controlId, pins = this.frame?.pins) {
    const c = this.controlById.get(controlId);
    return c && pins ? getControlColor(pins, c.pins) : null;
  }

  // --- selection & colour -----------------------------------------------------

  select(ids, mode = 'replace') {
    const lit = ids.filter((id) => this.controlById.get(id)?.pins);
    if (mode === 'replace') this.selection = new Set(lit);
    else if (mode === 'add') lit.forEach((id) => this.selection.add(id));
    else if (mode === 'toggle') lit.forEach((id) => (this.selection.has(id) ? this.selection.delete(id) : this.selection.add(id)));
    if (lit.length && (mode !== 'toggle' || this.selection.has(lit.at(-1)))) this.primary = lit.at(-1);
    if (!this.selection.has(this.primary)) this.primary = [...this.selection].at(-1) ?? null;
    this.syncColorFromSelection();
    this.emit('selection');
  }

  syncColorFromSelection() {
    if (!this.primary) return;
    const rgb = this.colorOf(this.primary);
    if (rgb && !isOff(rgb)) this.setBrush({ r: rgb.r, g: rgb.g, b: rgb.b });
  }

  setBrush(rgb) {
    if (sameColor(rgb, this.color)) return;
    this.color = { r: rgb.r, g: rgb.g, b: rgb.b };
    saveLocal({ color: this.color });
    this.emit('color');
  }

  /**
   * Colour picked in the UI. With a selection it is applied straight away;
   * mode 'brightness' keeps each button's own hue.
   */
  applyColor(rgb, { mode = 'set' } = {}) {
    this.setBrush(rgb);
    if (!this.selection.size || !this.project) return;
    const ids = [...this.selection];
    const v = Math.max(rgb.r, rgb.g, rgb.b);
    this.changeFrames(() => {
      // Brightness drags scale from the colours at the start of the drag, so
      // going down to 0 and back up doesn't lose each button's own hue.
      const base = this.gesture?.base;
      for (const frame of this.targetFrames()) {
        const source = base?.[this.project.frames.indexOf(frame)]?.pins || frame.pins;
        for (const id of ids) {
          const c = this.controlById.get(id);
          if (!c?.pins) continue;
          let next = rgb;
          if (mode === 'brightness') {
            const own = getControlColor(source, c.pins);
            next = withBrightness(isOff(own) ? rgb : own, v);
          }
          setControlColor(frame.pins, c.pins, next);
        }
      }
    });
  }

  paint(ids, rgb = this.color) {
    const targets = ids.filter((id) => this.controlById.get(id)?.pins);
    if (!targets.length || !this.project) return;
    const needed = this.targetFrames().some((f) => targets.some((id) => !sameColor(getControlColor(f.pins, this.controlById.get(id).pins), rgb)));
    if (!needed) return;
    this.changeFrames(() => {
      for (const frame of this.targetFrames()) for (const id of targets) setControlColor(frame.pins, this.controlById.get(id).pins, rgb);
    });
  }

  rememberColor(rgb = this.color) {
    if (isOff(rgb)) return;
    this.recent = [rgb, ...this.recent.filter((c) => !sameColor(c, rgb))].slice(0, 12);
    saveLocal({ recent: this.recent });
    this.emit('recent');
  }

  setKeepBrightness(on) {
    this.keepBrightness = on;
    saveLocal({ keepBrightness: on });
    this.emit('color');
  }

  setTool(tool) {
    if (this.tool === tool) return;
    this.previousTool = this.tool;
    this.tool = tool;
    this.emit('tool');
  }

  // --- saving -----------------------------------------------------------------

  async saveProject() {
    if (!this.project) return;
    if (this.saving) {
      this.saveAgain = true;
      return;
    }
    this.saving = true;
    const version = this.editVersion;
    const project = this.project;
    this.saveState = 'saving';
    this.emit('save');
    try {
      const res = await api.saveProject(project);
      if (this.project !== project) return;
      project.rev = res.project.rev;
      project.updatedAt = res.project.updatedAt;
      this.status = res.status;
      this.savedVersion = version;
      this.saveState = this.editVersion === version ? 'saved' : 'dirty';
      this.updateSummary(project, res.status);
      if (res.warnings?.length) this.lastWarnings = res.warnings;
      this.emit('save', 'status', 'warnings');
    } catch (err) {
      this.saveState = 'error';
      this.saveError = err;
      this.emit('save', err.code === 'conflict' ? 'conflict' : 'error');
    } finally {
      this.saving = false;
      if (this.saveAgain || (this.saveState === 'dirty' && this.project === project)) {
        this.saveAgain = false;
        this.scheduleSave();
      }
    }
  }

  async flushSave() {
    this.scheduleSave.cancel();
    while (this.saving) await new Promise((r) => setTimeout(r, 50));
    if (this.project && this.editVersion !== this.savedVersion) await this.saveProject();
  }

  async forceSave() {
    const res = await api.saveProject({ ...this.project, rev: undefined }, true);
    this.project.rev = res.project.rev;
    this.savedVersion = this.editVersion;
    this.saveState = 'saved';
    this.status = res.status;
    this.emit('save', 'status');
  }

  updateSummary(project, status) {
    const summary = this.projects.find((p) => p.id === project.id);
    const next = {
      id: project.id,
      name: project.name,
      fileName: project.fileName,
      board: project.board,
      frameCount: project.frames.length,
      totalMs: project.frames.reduce((n, f) => n + f.ms, 0),
      updatedAt: project.updatedAt,
      publishedAt: project.publishedAt,
      status,
      thumb: project.frames[0].pins,
    };
    if (summary) Object.assign(summary, next);
    else this.projects.unshift(next);
    this.emit('projects');
  }

  async publish({ overwrite = false } = {}) {
    await this.flushSave();
    if (this.saveState === 'error') throw this.saveError;
    const res = await api.publish(this.project.id, overwrite);
    this.project.publishedAt = res.publishedAt;
    this.status = 'published';
    this.updateSummary(this.project, 'published');
    this.emit('status');
    return res;
  }

  async saveSettings(patch) {
    this.settings = await api.saveSettings({ ...this.settings, ...patch });
    this.emit('settings');
  }
}

export const store = new Store();
