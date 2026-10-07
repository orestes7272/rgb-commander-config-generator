import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Router, HttpError, send, readJsonBody } from './http.js';
import { readJson, writeJson, readText, writeFileAtomic, backupFile } from './storage.js';
import { isWritable, canWrite, ownerOf, currentUser } from './system.js';
import { parseRgba, validateFileName, suggestFileName, expandToPins, prettyName } from '../public/js/core/rgba.js';
import { getBoard } from '../public/js/core/boards.js';
import { buildTemplate, sanitizeLayout, DEFAULT_TEMPLATE } from '../public/js/core/layouts.js';
import {
  createProject,
  sanitizeProject,
  projectToRgba,
  projectHash,
  fileHash,
  projectFromRgba,
  newId,
  totalMs,
} from '../public/js/core/project.js';

export const DEFAULT_SETTINGS = {
  eol: 'crlf',
  filePrefix: 'custom_',
  defaultFrameMs: 200,
  previewMode: 'led',
  simulateHardware: true,
  frameWriteMs: 185,
  showPorts: false,
  outputDir: '',
  schemeOrder: [],
};

function sanitizeSettings(input, current) {
  const s = { ...current };
  if (input.eol === 'crlf' || input.eol === 'lf') s.eol = input.eol;
  if (typeof input.filePrefix === 'string') {
    if (!/^[A-Za-z0-9_-]{0,20}$/.test(input.filePrefix)) throw new HttpError(400, 'File prefix may use letters, numbers, - and _ (max 20)');
    s.filePrefix = input.filePrefix;
  }
  const intIn = (key, min, max) => {
    if (input[key] === undefined) return;
    const n = Number(input[key]);
    if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `${key} must be ${min}–${max}`);
    s[key] = n;
  };
  intIn('defaultFrameMs', 0, 255);
  intIn('frameWriteMs', 0, 2000);
  if (input.previewMode === 'led' || input.previewMode === 'raw') s.previewMode = input.previewMode;
  for (const key of ['simulateHardware', 'showPorts']) if (typeof input[key] === 'boolean') s[key] = input[key];
  if (input.schemeOrder !== undefined) {
    const order = input.schemeOrder;
    if (!Array.isArray(order) || order.length > 5000 || !order.every((id) => typeof id === 'string' && PROJECT_ID.test(id))) {
      throw new HttpError(400, 'schemeOrder must be a list of scheme ids');
    }
    s.schemeOrder = [...new Set(order)];
  }
  return s;
}

const PROJECT_ID = /^p_[a-z0-9]{6,40}$/;

// Existing files may predate our naming rules, so reads are looser than writes.
function looseFileName(name) {
  if (!name || name.length > 200 || name.startsWith('.') || /[/\\\0]/.test(name)) throw new HttpError(400, 'Invalid file name');
  return name;
}

/**
 * hooks.onPing / hooks.onBye: set by the desktop launcher, which quits once
 * the app window stops checking in.
 */
export function createApi(config, hooks = {}) {
  const router = new Router();
  const projectsDir = path.join(config.dataDir, 'projects');
  const backupsDir = path.join(config.dataDir, 'backups');
  const settingsFile = path.join(config.dataDir, 'settings.json');
  const layoutFile = path.join(config.dataDir, 'layout.json');

  const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await readJson(settingsFile, {})) });
  const eolOf = (settings) => (settings.eol === 'lf' ? '\n' : '\r\n');

  /** Where files are published: fixed by OUTPUT_DIR, or chosen in Settings. */
  async function outputDir() {
    if (!config.outputDirEditable) return config.outputDir;
    return (await getSettings()).outputDir || config.outputDir;
  }
  const outputFile = async (name, dir) => path.join(dir ?? (await outputDir()), `${name}.rgba`);

  /** Validate a folder typed into Settings, creating it if needed. '' means the default. */
  async function checkOutputDir(value) {
    if (!config.outputDirEditable) throw new HttpError(400, 'The output folder is set by OUTPUT_DIR (the container volume), so change it there');
    if (value === '' || value === null) return '';
    if (typeof value !== 'string') throw new HttpError(400, 'The output folder must be a path');
    let dir = value.trim();
    if (dir === '~' || dir.startsWith('~/')) dir = path.join(os.homedir(), dir.slice(1));
    if (!path.isAbsolute(dir)) throw new HttpError(400, 'Use a full path, like /home/you/Sync/rgbcommander/rgba');
    dir = path.resolve(dir);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (err) {
      throw new HttpError(400, `Can't create ${dir} (${err.code || err.message})`);
    }
    if (!(await isWritable(dir))) throw new HttpError(400, `${dir} isn't writable`);
    return dir;
  }

  async function getLayout() {
    const stored = await readJson(layoutFile);
    if (stored) {
      try {
        return sanitizeLayout(stored);
      } catch {
        // fall through to a fresh template
      }
    }
    const layout = buildTemplate(DEFAULT_TEMPLATE);
    await writeJson(layoutFile, layout);
    return layout;
  }

  const projectFile = (id) => {
    if (!PROJECT_ID.test(id)) throw new HttpError(404, 'Scheme not found');
    return path.join(projectsDir, `${id}.json`);
  };

  async function loadProject(id) {
    const project = await readJson(projectFile(id));
    if (!project) throw new HttpError(404, 'Scheme not found');
    return project;
  }

  async function allProjects() {
    const out = [];
    for (const entry of await fs.readdir(projectsDir)) {
      if (!entry.endsWith('.json') || entry.startsWith('.')) continue;
      const p = await readJson(path.join(projectsDir, entry)).catch(() => null);
      if (p?.id && Array.isArray(p.frames)) out.push(p);
    }
    return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  /** How a scheme relates to the file of the same name in the output folder. */
  async function statusOf(project, dir) {
    const text = await readText(await outputFile(project.fileName, dir));
    if (text === null) return 'unpublished';
    const onDisk = fileHash(text, project.board);
    if (onDisk === projectHash(project)) return 'published';
    return onDisk && onDisk === project.publishedHash ? 'changed' : 'foreign';
  }

  async function summary(project, dir) {
    return {
      id: project.id,
      name: project.name,
      fileName: project.fileName,
      board: project.board,
      frameCount: project.frames.length,
      totalMs: totalMs(project),
      updatedAt: project.updatedAt,
      publishedAt: project.publishedAt,
      status: await statusOf(project, dir),
      thumb: project.frames[0].pins,
    };
  }

  async function fileNameClash(project) {
    const others = (await allProjects()).filter((p) => p.id !== project.id && p.fileName === project.fileName);
    return others.length ? `Another scheme ("${others[0].name}") also publishes ${project.fileName}.rgba` : null;
  }

  async function saveNewProject(fields, extra = {}) {
    const clean = sanitizeProject(fields);
    const project = { ...createProject(clean), ...clean, ...extra };
    await writeJson(projectFile(project.id), project);
    const clash = await fileNameClash(project);
    return { project, status: await statusOf(project), warnings: clash ? [clash] : [] };
  }

  // -------------------------------------------------------------------------

  // Unauthenticated; also lets the desktop launcher recognise a running copy of itself.
  router.add('GET', '/api/health', async () => ({ ok: true, app: 'rgb-commander-studio' }));

  router.add('GET', '/api/info', async () => {
    const dir = await outputDir();
    return {
      version: config.version,
      dataDir: config.dataDir,
      outputDir: dir,
      outputEditable: config.outputDirEditable,
      outputWritable: await canWrite(dir),
      dataWritable: await isWritable(config.dataDir),
      outputOwner: (await ownerOf(dir))?.owner ?? null,
      user: currentUser(),
      auth: Boolean(config.authPassword),
      desktop: config.desktop,
    };
  });

  router.add('GET', '/api/settings', getSettings);
  router.add('PUT', '/api/settings', async ({ req }) => {
    const body = await readJsonBody(req);
    const current = await getSettings();
    const next = sanitizeSettings(body, current);
    // The whole settings object comes back on every save; only check the folder when it changed.
    if (body.outputDir !== undefined && body.outputDir !== current.outputDir) next.outputDir = await checkOutputDir(body.outputDir);
    await writeJson(settingsFile, next);
    return next;
  });

  if (hooks.onPing) {
    router.add('POST', '/api/desktop/ping', async () => (hooks.onPing(), { ok: true }));
    router.add('POST', '/api/desktop/bye', async () => (hooks.onBye?.(), { ok: true }));
  }

  router.add('GET', '/api/layout', getLayout);
  router.add('PUT', '/api/layout', async ({ req }) => {
    let layout;
    try {
      layout = sanitizeLayout(await readJsonBody(req));
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err.message);
    }
    await writeJson(layoutFile, layout);
    return layout;
  });

  router.add('GET', '/api/projects', async () => {
    const dir = await outputDir();
    return Promise.all((await allProjects()).map((p) => summary(p, dir)));
  });

  router.add('POST', '/api/projects', async ({ req }) => {
    const body = await readJsonBody(req);
    try {
      return await saveNewProject(body);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err.message);
    }
  });

  router.add('GET', '/api/projects/:id', async ({ params }) => {
    const project = await loadProject(params.id);
    return { project, status: await statusOf(project) };
  });

  router.add('PUT', '/api/projects/:id', async ({ req, params, query }) => {
    const stored = await loadProject(params.id);
    const body = await readJsonBody(req);
    if (body.rev !== undefined && body.rev !== stored.rev && query.get('force') !== '1') {
      throw new HttpError(409, 'This scheme was changed somewhere else (another browser tab?)', { code: 'conflict', project: stored });
    }
    let clean;
    try {
      clean = sanitizeProject(body);
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    const project = { ...stored, ...clean, id: stored.id, updatedAt: new Date().toISOString(), rev: (stored.rev || 0) + 1 };
    await writeJson(projectFile(project.id), project);
    const clash = await fileNameClash(project);
    return { project, status: await statusOf(project), warnings: clash ? [clash] : [] };
  });

  router.add('DELETE', '/api/projects/:id', async ({ params, query }) => {
    const project = await loadProject(params.id);
    if (query.get('file') === '1') {
      const file = await outputFile(project.fileName);
      await backupFile(backupsDir, file, config.backupsPerFile);
      await fs.rm(file, { force: true });
    }
    await fs.rm(projectFile(project.id), { force: true });
    return { ok: true };
  });

  router.add('POST', '/api/projects/:id/duplicate', async ({ params }) => {
    const source = await loadProject(params.id);
    const taken = new Set((await allProjects()).map((p) => p.fileName));
    let fileName = `${source.fileName}_copy`.slice(0, 80);
    for (let i = 2; taken.has(fileName); i++) fileName = `${source.fileName}_copy${i}`.slice(0, 80);
    const frames = source.frames.map((f) => ({ ...f, id: newId('f') }));
    return saveNewProject({ ...source, name: `${source.name} (copy)`, fileName, frames });
  });

  router.add('POST', '/api/projects/:id/publish', async ({ req, params }) => {
    const body = await readJsonBody(req);
    const project = await loadProject(params.id);
    const settings = await getSettings();
    const nameError = validateFileName(project.fileName);
    if (nameError) throw new HttpError(400, nameError);
    const file = await outputFile(project.fileName);
    const current = projectHash(project);
    const existing = await readText(file);
    let backup = null;
    if (existing !== null) {
      const onDisk = fileHash(existing, project.board);
      const ours = onDisk && (onDisk === project.publishedHash || onDisk === current);
      if (!ours && !body.overwrite) {
        throw new HttpError(409, `${project.fileName}.rgba already exists in the output folder and wasn't written by this scheme`, { code: 'exists' });
      }
      if (onDisk !== current) backup = await backupFile(backupsDir, file, config.backupsPerFile);
    }
    const text = projectToRgba(project, { eol: eolOf(settings) });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeFileAtomic(file, text);
    project.publishedAt = new Date().toISOString();
    project.publishedHash = current;
    await writeJson(projectFile(project.id), project);
    return {
      status: 'published',
      publishedAt: project.publishedAt,
      file: `${project.fileName}.rgba`,
      bytes: Buffer.byteLength(text),
      backup: backup ? path.basename(backup) : null,
    };
  });

  router.add('GET', '/api/files', async () => {
    const layout = await getLayout();
    const board = getBoard(layout.board);
    const projects = await allProjects();
    const dir = await outputDir();
    const entries = await fs.readdir(dir).catch((err) => {
      if (err.code === 'ENOENT') return [];
      throw err;
    });
    const out = [];
    for (const entry of entries) {
      if (!entry.endsWith('.rgba') || entry.startsWith('.')) continue;
      const full = path.join(dir, entry);
      const stat = await fs.stat(full).catch(() => null);
      if (!stat?.isFile()) continue;
      const name = entry.slice(0, -5);
      const item = {
        name,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        linked: projects.filter((p) => p.fileName === name).map((p) => ({ id: p.id, name: p.name })),
      };
      try {
        const { frames, warnings } = parseRgba(await fs.readFile(full, 'utf8'));
        item.frameCount = frames.length;
        item.valuesPerFrame = [...new Set(frames.map((f) => f.values.length))];
        item.totalMs = frames.reduce((n, f) => n + f.delay, 0);
        item.thumb = expandToPins(frames[0].values, board.pinCount);
        item.warnings = warnings;
      } catch (err) {
        item.error = err.message;
      }
      out.push(item);
    }
    return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
  });

  router.add('GET', '/api/files/:name', async ({ params, query, res }) => {
    const name = looseFileName(params.name);
    const text = await readText(await outputFile(name));
    if (text === null) throw new HttpError(404, 'File not found');
    const headers = { 'Content-Type': 'application/xml; charset=utf-8' };
    if (query.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(name)}.rgba"`;
    send(res, 200, text, headers);
  });

  router.add('DELETE', '/api/files/:name', async ({ params }) => {
    const name = looseFileName(params.name);
    const file = await outputFile(name);
    if ((await readText(file)) === null) throw new HttpError(404, 'File not found');
    const backup = await backupFile(backupsDir, file, config.backupsPerFile);
    await fs.rm(file, { force: true });
    return { ok: true, backup: backup ? path.basename(backup) : null };
  });

  router.add('POST', '/api/files/:name/import', async ({ params }) => {
    const name = looseFileName(params.name);
    const text = await readText(await outputFile(name));
    if (text === null) throw new HttpError(404, 'File not found');
    const layout = await getLayout();
    const settings = await getSettings();
    const fileName = validateFileName(name) ? suggestFileName(name) : name;
    let imported;
    try {
      imported = projectFromRgba(text, { name: prettyName(name, settings.filePrefix), fileName, board: layout.board });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    // The file on disk counts as this scheme's own publish, so re-publishing
    // it doesn't ask for confirmation.
    const extra = fileName === name ? { publishedHash: fileHash(text, layout.board), publishedAt: new Date().toISOString() } : {};
    const result = await saveNewProject(imported.project, extra);
    return { ...result, warnings: [...imported.warnings, ...result.warnings] };
  });

  // --- backups ----------------------------------------------------------------
  // backups/<file>.rgba/<timestamp>_<file>.rgba, written whenever a file in the
  // output folder is replaced or deleted (see storage.backupFile).

  const BACKUP_NAME = /^[^/\\\0]+\.rgba$/;
  const backupPath = (file, id) => {
    if (!BACKUP_NAME.test(file) || file.startsWith('.')) throw new HttpError(404, 'Backup not found');
    if (id === undefined) return path.join(backupsDir, file);
    if (!BACKUP_NAME.test(id) || id.startsWith('.')) throw new HttpError(404, 'Backup not found');
    return path.join(backupsDir, file, id);
  };
  async function readBackup(file, id) {
    const text = await readText(backupPath(file, id));
    if (text === null) throw new HttpError(404, 'Backup not found');
    return text;
  }

  router.add('GET', '/api/backups', async () => {
    const board = getBoard((await getLayout()).board);
    const dir = await outputDir();
    const groups = [];
    for (const file of await fs.readdir(backupsDir).catch(() => [])) {
      if (!BACKUP_NAME.test(file) || file.startsWith('.')) continue;
      const folder = path.join(backupsDir, file);
      const versions = [];
      for (const id of await fs.readdir(folder).catch(() => [])) {
        if (!BACKUP_NAME.test(id) || id.startsWith('.')) continue;
        const full = path.join(folder, id);
        const stat = await fs.stat(full).catch(() => null);
        if (!stat?.isFile()) continue;
        const version = { id, savedAt: stat.mtime.toISOString(), size: stat.size };
        try {
          const { frames } = parseRgba(await fs.readFile(full, 'utf8'));
          version.frameCount = frames.length;
          version.totalMs = frames.reduce((n, f) => n + f.delay, 0);
          version.thumb = expandToPins(frames[0].values, board.pinCount);
        } catch (err) {
          version.error = err.message;
        }
        versions.push(version);
      }
      if (!versions.length) continue;
      versions.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
      groups.push({
        file,
        name: file.slice(0, -5),
        versions,
        size: versions.reduce((n, v) => n + v.size, 0),
        inOutput: (await readText(path.join(dir, file))) !== null,
      });
    }
    groups.sort((a, b) => b.versions[0].savedAt.localeCompare(a.versions[0].savedAt));
    return { keep: config.backupsPerFile, groups };
  });

  router.add('GET', '/api/backups/:file/:id', async ({ params, query, res }) => {
    const text = await readBackup(params.file, params.id);
    const headers = { 'Content-Type': 'application/xml; charset=utf-8' };
    if (query.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(params.file)}"`;
    send(res, 200, text, headers);
  });

  // Put a backed-up version back in the output folder. Whatever is there now is
  // backed up first, so this can be undone the same way.
  router.add('POST', '/api/backups/:file/:id/restore', async ({ params }) => {
    const text = await readBackup(params.file, params.id);
    try {
      parseRgba(text);
    } catch (err) {
      throw new HttpError(400, `That backup isn't a readable .rgba file: ${err.message}`);
    }
    const target = await outputFile(params.file.slice(0, -5));
    const existing = await readText(target);
    const backup = existing !== null && existing !== text ? await backupFile(backupsDir, target, config.backupsPerFile) : null;
    await fs.mkdir(path.dirname(target), { recursive: true });
    await writeFileAtomic(target, text);
    return { file: params.file, backup: backup ? path.basename(backup) : null };
  });

  router.add('POST', '/api/backups/:file/:id/import', async ({ req, params }) => {
    const body = await readJsonBody(req);
    const text = await readBackup(params.file, params.id);
    const name = params.file.slice(0, -5);
    const layout = await getLayout();
    const settings = await getSettings();
    const fileName = validateFileName(name) ? suggestFileName(name) : name;
    let imported;
    try {
      imported = projectFromRgba(text, { name: String(body.name || `${prettyName(name, settings.filePrefix)} (backup)`), fileName, board: layout.board });
    } catch (err) {
      throw new HttpError(400, err.message);
    }
    const result = await saveNewProject(imported.project);
    return { ...result, warnings: [...imported.warnings, ...result.warnings] };
  });

  router.add('DELETE', '/api/backups/:file/:id', async ({ params }) => {
    await readBackup(params.file, params.id);
    await fs.rm(backupPath(params.file, params.id), { force: true });
    await fs.rmdir(backupPath(params.file)).catch(() => {}); // only succeeds once the folder is empty
    return { ok: true };
  });

  router.add('DELETE', '/api/backups/:file', async ({ params }) => {
    await fs.rm(backupPath(params.file), { recursive: true, force: true });
    return { ok: true };
  });

  router.add('DELETE', '/api/backups', async () => {
    for (const entry of await fs.readdir(backupsDir).catch(() => [])) await fs.rm(path.join(backupsDir, entry), { recursive: true, force: true });
    return { ok: true };
  });

  return router;
}
