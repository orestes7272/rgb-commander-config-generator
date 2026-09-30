import fs from 'node:fs/promises';
import path from 'node:path';
import { Router, HttpError, send, readJsonBody } from './http.js';
import { readJson, writeJson, readText, writeFileAtomic, backupFile } from './storage.js';
import { isWritable, ownerOf, currentUser } from './system.js';
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
  return s;
}

const PROJECT_ID = /^p_[a-z0-9]{6,40}$/;

// Existing files may predate our naming rules, so reads are looser than writes.
function looseFileName(name) {
  if (!name || name.length > 200 || name.startsWith('.') || /[/\\\0]/.test(name)) throw new HttpError(400, 'Invalid file name');
  return name;
}

export function createApi(config) {
  const router = new Router();
  const projectsDir = path.join(config.dataDir, 'projects');
  const backupsDir = path.join(config.dataDir, 'backups');
  const settingsFile = path.join(config.dataDir, 'settings.json');
  const layoutFile = path.join(config.dataDir, 'layout.json');
  const outputFile = (name) => path.join(config.outputDir, `${name}.rgba`);

  const getSettings = async () => ({ ...DEFAULT_SETTINGS, ...(await readJson(settingsFile, {})) });
  const eolOf = (settings) => (settings.eol === 'lf' ? '\n' : '\r\n');

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
  async function statusOf(project) {
    const text = await readText(outputFile(project.fileName));
    if (text === null) return 'unpublished';
    const onDisk = fileHash(text, project.board);
    if (onDisk === projectHash(project)) return 'published';
    return onDisk && onDisk === project.publishedHash ? 'changed' : 'foreign';
  }

  async function summary(project) {
    return {
      id: project.id,
      name: project.name,
      fileName: project.fileName,
      board: project.board,
      frameCount: project.frames.length,
      totalMs: totalMs(project),
      updatedAt: project.updatedAt,
      publishedAt: project.publishedAt,
      status: await statusOf(project),
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

  router.add('GET', '/api/health', async () => ({ ok: true }));

  router.add('GET', '/api/info', async () => ({
    version: config.version,
    dataDir: config.dataDir,
    outputDir: config.outputDir,
    outputWritable: await isWritable(config.outputDir),
    dataWritable: await isWritable(config.dataDir),
    outputOwner: (await ownerOf(config.outputDir))?.owner ?? null,
    user: currentUser(),
    auth: Boolean(config.authPassword),
  }));

  router.add('GET', '/api/settings', getSettings);
  router.add('PUT', '/api/settings', async ({ req }) => {
    const next = sanitizeSettings(await readJsonBody(req), await getSettings());
    await writeJson(settingsFile, next);
    return next;
  });

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

  router.add('GET', '/api/projects', async () => Promise.all((await allProjects()).map(summary)));

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
      const file = outputFile(project.fileName);
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
    const file = outputFile(project.fileName);
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
    const out = [];
    for (const entry of await fs.readdir(config.outputDir)) {
      if (!entry.endsWith('.rgba') || entry.startsWith('.')) continue;
      const full = path.join(config.outputDir, entry);
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
    const text = await readText(outputFile(name));
    if (text === null) throw new HttpError(404, 'File not found');
    const headers = { 'Content-Type': 'application/xml; charset=utf-8' };
    if (query.get('download') === '1') headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(name)}.rgba"`;
    send(res, 200, text, headers);
  });

  router.add('DELETE', '/api/files/:name', async ({ params }) => {
    const name = looseFileName(params.name);
    const file = outputFile(name);
    if ((await readText(file)) === null) throw new HttpError(404, 'File not found');
    const backup = await backupFile(backupsDir, file, config.backupsPerFile);
    await fs.rm(file, { force: true });
    return { ok: true, backup: backup ? path.basename(backup) : null };
  });

  router.add('POST', '/api/files/:name/import', async ({ params }) => {
    const name = looseFileName(params.name);
    const text = await readText(outputFile(name));
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

  return router;
}
