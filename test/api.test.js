import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { start } from '../server/index.js';

let server;
let base;
let tmp;
let outputDir;

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rgbcs-'));
  outputDir = path.join(tmp, 'output');
  ({ server } = await start({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: path.join(tmp, 'config'), OUTPUT_DIR: outputDir }));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  await fs.rm(tmp, { recursive: true, force: true });
});

async function api(method, url, body, headers = {}) {
  const res = await fetch(base + url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers };
}

const pins = (fill) => new Array(96).fill(fill);

test('health, info and defaults', async () => {
  assert.deepEqual((await api('GET', '/api/health')).body, { ok: true, app: 'rgb-commander-studio' });
  const info = (await api('GET', '/api/info')).body;
  assert.equal(info.outputWritable, true);
  const layout = (await api('GET', '/api/layout')).body;
  assert.equal(layout.board, 'ultimateio');
  assert.ok(layout.controls.length > 10);
  const settings = (await api('GET', '/api/settings')).body;
  assert.equal(settings.eol, 'crlf');
  assert.equal(settings.autosave, true);
});

test('autosave can be turned off and back on', async () => {
  assert.equal((await api('PUT', '/api/settings', { autosave: false })).body.autosave, false);
  assert.equal((await api('GET', '/api/settings')).body.autosave, false);
  assert.equal((await api('PUT', '/api/settings', { autosave: 'no' })).body.autosave, false);
  assert.equal((await api('PUT', '/api/settings', { autosave: true })).body.autosave, true);
});

test('serves the app shell but not files outside public/', async () => {
  const res = await fetch(base + '/');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.equal((await fetch(base + '/../package.json')).status, 404);
  assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);
  assert.equal((await fetch(base + '/js/../../server/index.js')).status, 404);
});

test('create, save, publish and re-import a scheme', async () => {
  const created = await api('POST', '/api/projects', {
    name: 'Test blue',
    fileName: 'custom_test_blue',
    board: 'ultimateio',
    frames: [{ ms: 200, pins: pins(64) }],
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const { project } = created.body;
  assert.equal(created.body.status, 'unpublished');

  const stale = await api('PUT', `/api/projects/${project.id}`, { ...project, rev: 99 });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'conflict');

  const saved = await api('PUT', `/api/projects/${project.id}`, { ...project, frames: [{ ms: 1000, pins: pins(10) }] });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.project.rev, 1);

  const published = await api('POST', `/api/projects/${project.id}/publish`, {});
  assert.equal(published.status, 200, JSON.stringify(published.body));
  const text = await fs.readFile(path.join(outputDir, 'custom_test_blue.rgba'), 'utf8');
  // A 1000 ms hold becomes four 250 ms frames.
  const frameLine = `\t<frm dec="${pins(10).join(',')}"/>\r\n`;
  assert.equal(text, `<anim>\r\n${frameLine.repeat(4)}\t<tms dec="250,250,250,250"/>\r\n</anim>\r\n`);
  assert.equal((await fs.readdir(outputDir)).filter((f) => f.endsWith('.tmp')).length, 0);

  const list = (await api('GET', '/api/projects')).body;
  assert.equal(list.find((p) => p.id === project.id).status, 'published');

  const files = (await api('GET', '/api/files')).body;
  const file = files.find((f) => f.name === 'custom_test_blue');
  assert.equal(file.frameCount, 4);
  assert.equal(file.thumb.length, 96);
  assert.deepEqual(file.linked, [{ id: project.id, name: 'Test blue' }]);

  const raw = await fetch(`${base}/api/files/custom_test_blue?download=1`);
  assert.match(raw.headers.get('content-disposition'), /attachment/);
  assert.equal(await raw.text(), text);

  const imported = await api('POST', '/api/files/custom_test_blue/import');
  assert.equal(imported.status, 200);
  assert.equal(imported.body.status, 'published');
  assert.equal(imported.body.project.frames.length, 4);
  assert.match(imported.body.warnings.join(' '), /also publishes/);
});

test('publishing over a file the scheme did not write needs confirmation and keeps a backup', async () => {
  const foreign = '<anim>\r\n\t<frm dec="0,0,64"/>\r\n\t<tms dec="200"/>\r\n</anim>\r\n';
  await fs.writeFile(path.join(outputDir, 'custom_existing.rgba'), foreign);
  const { project } = (await api('POST', '/api/projects', { name: 'x', fileName: 'custom_existing', frames: [{ ms: 100, pins: pins(1) }] })).body;
  assert.equal((await api('GET', `/api/projects/${project.id}`)).body.status, 'foreign');

  const refused = await api('POST', `/api/projects/${project.id}/publish`, {});
  assert.equal(refused.status, 409);
  assert.equal(refused.body.code, 'exists');
  assert.equal(await fs.readFile(path.join(outputDir, 'custom_existing.rgba'), 'utf8'), foreign);

  const forced = await api('POST', `/api/projects/${project.id}/publish`, { overwrite: true });
  assert.equal(forced.status, 200);
  assert.ok(forced.body.backup);
  const backups = await fs.readdir(path.join(tmp, 'config', 'backups', 'custom_existing.rgba'));
  assert.equal(backups.length, 1);

  // Once published, later edits publish without asking again.
  await api('PUT', `/api/projects/${project.id}`, { ...project, rev: undefined, frames: [{ ms: 100, pins: pins(2) }] });
  assert.equal((await api('GET', `/api/projects/${project.id}`)).body.status, 'changed');
  assert.equal((await api('POST', `/api/projects/${project.id}/publish`, {})).status, 200);
});

test('validates input', async () => {
  assert.equal((await api('POST', '/api/projects', { name: 'x', fileName: '../../etc/passwd', frames: [{ ms: 1, pins: pins(0) }] })).status, 400);
  assert.equal((await api('POST', '/api/projects', { name: 'x', fileName: 'ok', frames: [{ ms: 1, pins: pins(300) }] })).status, 400);
  assert.equal((await api('PUT', '/api/layout', { controls: 'nope' })).status, 400);
  assert.equal((await api('PUT', '/api/settings', { filePrefix: '../' })).status, 400);
  assert.equal((await api('GET', '/api/files/..%2F..%2Fetc%2Fpasswd')).status, 400);
  assert.equal((await api('GET', '/api/projects/../../x')).status, 404);
  assert.equal((await api('GET', '/api/files/%E0%A4%A')).status, 400);
  const wrongType = await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
  assert.equal(wrongType.status, 415);
});

test('rejects cross-site writes', async () => {
  const res = await api('PUT', '/api/settings', { eol: 'lf' }, { Origin: 'http://evil.example' });
  assert.equal(res.status, 403);
  const site = await api('PUT', '/api/settings', { eol: 'lf' }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(site.status, 403);
  assert.equal((await api('GET', '/api/settings')).body.eol, 'crlf');
});

test('optional password protection', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rgbcs-auth-'));
  const { server: s } = await start({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: path.join(dir, 'c'), OUTPUT_DIR: path.join(dir, 'o'), AUTH_PASSWORD: 'hunter2' });
  const url = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.equal((await fetch(url + '/api/settings')).status, 401);
    assert.equal((await fetch(url + '/api/health')).status, 200);
    const auth = { Authorization: 'Basic ' + Buffer.from('admin:hunter2').toString('base64') };
    assert.equal((await fetch(url + '/api/settings', { headers: auth })).status, 200);
    const wrong = { Authorization: 'Basic ' + Buffer.from('admin:nope').toString('base64') };
    assert.equal((await fetch(url + '/api/settings', { headers: wrong })).status, 401);
  } finally {
    await new Promise((r) => s.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('raw HTTP path traversal is refused', async () => {
  const status = await new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/../../../etc/passwd', method: 'GET' }, (res) => {
      res.resume();
      resolve(res.statusCode);
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(status, 404);
});

test('explains permission problems instead of failing with a bare error', { skip: process.getuid?.() === 0 && 'root ignores folder permissions' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rgbcs-ro-'));
  const out = path.join(dir, 'o');
  await fs.mkdir(out);
  const { server: s } = await start({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: path.join(dir, 'c'), OUTPUT_DIR: out });
  const url = `http://127.0.0.1:${s.address().port}`;
  try {
    await fs.chmod(out, 0o555);
    const post = (u, body) => fetch(url + u, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => [r.status, await r.json()]);
    const [, created] = await post('/api/projects', { name: 'x', fileName: 'custom_x', frames: [{ ms: 1, pins: pins(0) }] });
    const info = await (await fetch(url + '/api/info')).json();
    assert.equal(info.outputWritable, false);
    const [status, body] = await post(`/api/projects/${created.project.id}/publish`, {});
    assert.equal(status, 500);
    assert.equal(body.code, 'not-writable');
    assert.match(body.error, /Can't write to .*the app runs as \d+:\d+\. It belongs to \d+:\d+ with mode 555/);
  } finally {
    await fs.chmod(out, 0o755);
    await new Promise((r) => s.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('without OUTPUT_DIR the output folder can be changed in Settings', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'rgbcs-edit-'));
  const { server: s } = await start({ PORT: '0', HOST: '127.0.0.1', DATA_DIR: path.join(dir, 'c'), DEFAULT_OUTPUT_DIR: path.join(dir, 'default'), RCS_DESKTOP: '1' });
  const url = `http://127.0.0.1:${s.address().port}`;
  const call = (method, u, body) =>
    fetch(url + u, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined }).then(async (r) => [r.status, await r.json()]);
  try {
    let [, info] = await call('GET', '/api/info');
    assert.equal(info.outputEditable, true);
    assert.equal(info.desktop, true);
    assert.equal(info.outputDir, path.join(dir, 'default'));
    assert.equal(info.outputWritable, true, 'a missing folder that can be created counts as writable');
    await assert.rejects(fs.stat(path.join(dir, 'default')), 'the default folder is only created when used');

    const chosen = path.join(dir, 'sync', 'rgbcommander', 'rgba');
    const [status, settings] = await call('PUT', '/api/settings', { outputDir: chosen });
    assert.equal(status, 200);
    assert.equal(settings.outputDir, chosen);
    assert.ok((await fs.stat(chosen)).isDirectory());
    [, info] = await call('GET', '/api/info');
    assert.equal(info.outputDir, chosen);

    const [, created] = await call('POST', '/api/projects', { name: 'x', fileName: 'custom_x', frames: [{ ms: 1, pins: pins(5) }] });
    assert.equal((await call('POST', `/api/projects/${created.project.id}/publish`, {}))[0], 200);
    assert.ok(await fs.readFile(path.join(chosen, 'custom_x.rgba'), 'utf8'));

    assert.equal((await call('PUT', '/api/settings', { outputDir: 'relative/path' }))[0], 400);
    assert.equal((await call('PUT', '/api/settings', { outputDir: '' }))[1].outputDir, '');
    assert.equal((await call('GET', '/api/info'))[1].outputDir, path.join(dir, 'default'));
    assert.equal((await call('POST', '/api/desktop/ping'))[0], 404, 'heartbeat only exists when the launcher asks for it');
  } finally {
    await new Promise((r) => s.close(r));
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('OUTPUT_DIR (the Docker volume) cannot be changed from Settings', async () => {
  const changed = await api('PUT', '/api/settings', { outputDir: path.join(tmp, 'elsewhere') });
  assert.equal(changed.status, 400);
  assert.match(changed.body.error, /OUTPUT_DIR/);
  const info = (await api('GET', '/api/info')).body;
  assert.equal(info.outputEditable, false);
  // Saving other settings sends the unchanged (empty) folder back, which is fine.
  assert.equal((await api('PUT', '/api/settings', { ...(await api('GET', '/api/settings')).body, showPorts: true })).status, 200);
});

test('a server bound to localhost only answers requests for localhost', async () => {
  const get = (host) =>
    new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/api/health', headers: { Host: host } }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
  assert.equal(await get(`127.0.0.1:${server.address().port}`), 200);
  assert.equal(await get(`localhost:${server.address().port}`), 200);
  assert.equal(await get('rebind.evil.example'), 403);
});

test('the custom scheme order is saved and validated', async () => {
  const projects = (await api('GET', '/api/projects')).body;
  const order = projects.map((p) => p.id).reverse();
  const saved = await api('PUT', '/api/settings', { schemeOrder: [...order, order[0]] });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.schemeOrder, order, 'duplicates dropped');
  assert.equal((await api('PUT', '/api/settings', { schemeOrder: ['../etc/passwd'] })).status, 400);
  assert.equal((await api('PUT', '/api/settings', { schemeOrder: 'p_abc' })).status, 400);
});

test('backups can be listed, previewed, put back, opened and deleted', async () => {
  const file = path.join(outputDir, 'custom_backup_test.rgba');
  const version = (v) => `<anim>\r\n\t<frm dec="${pins(v).join(',')}"/>\r\n\t<tms dec="100"/>\r\n</anim>\r\n`;
  await fs.writeFile(file, version(1));
  const { project } = (await api('POST', '/api/projects', { name: 'Backup test', fileName: 'custom_backup_test', frames: [{ ms: 100, pins: pins(2) }] })).body;
  assert.equal((await api('POST', `/api/projects/${project.id}/publish`, { overwrite: true })).status, 200); // backs up version 1
  await fs.writeFile(file, version(3));
  assert.equal((await api('DELETE', '/api/files/custom_backup_test')).status, 200); // backs up version 3

  let list = (await api('GET', '/api/backups')).body;
  assert.equal(list.keep, 10);
  let group = list.groups.find((g) => g.file === 'custom_backup_test.rgba');
  assert.equal(group.versions.length, 2);
  assert.equal(group.inOutput, false);
  const [newest, oldest] = group.versions;
  assert.equal(newest.thumb[0], 3);
  assert.equal(oldest.thumb[0], 1);
  assert.equal(newest.frameCount, 1);

  const raw = await fetch(`${base}/api/backups/custom_backup_test.rgba/${encodeURIComponent(oldest.id)}?download=1`);
  assert.match(raw.headers.get('content-disposition'), /attachment/);
  assert.equal(await raw.text(), version(1));

  // Put the oldest version back: the output folder gets it; nothing to back up since the file was deleted.
  const restored = await api('POST', `/api/backups/custom_backup_test.rgba/${encodeURIComponent(oldest.id)}/restore`, {});
  assert.equal(restored.status, 200);
  assert.equal(restored.body.backup, null);
  assert.equal(await fs.readFile(file, 'utf8'), version(1));
  // Putting back another version keeps a copy of the one being replaced.
  const again = await api('POST', `/api/backups/custom_backup_test.rgba/${encodeURIComponent(newest.id)}/restore`, {});
  assert.ok(again.body.backup);
  assert.equal(await fs.readFile(file, 'utf8'), version(3));
  group = (await api('GET', '/api/backups')).body.groups.find((g) => g.file === 'custom_backup_test.rgba');
  assert.equal(group.versions.length, 3);
  assert.equal(group.inOutput, true);

  const opened = await api('POST', `/api/backups/custom_backup_test.rgba/${encodeURIComponent(oldest.id)}/import`, { name: 'From a backup' });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.project.name, 'From a backup');
  assert.equal(opened.body.project.fileName, 'custom_backup_test');
  assert.equal(opened.body.project.frames[0].pins[0], 1);

  assert.equal((await api('DELETE', `/api/backups/custom_backup_test.rgba/${encodeURIComponent(oldest.id)}`)).status, 200);
  group = (await api('GET', '/api/backups')).body.groups.find((g) => g.file === 'custom_backup_test.rgba');
  assert.equal(group.versions.length, 2);
  assert.equal((await api('DELETE', '/api/backups/custom_backup_test.rgba')).status, 200);
  list = (await api('GET', '/api/backups')).body;
  assert.ok(!list.groups.some((g) => g.file === 'custom_backup_test.rgba'));
  assert.ok(list.groups.length > 0, 'other files keep their backups');
  assert.equal((await api('DELETE', '/api/backups')).status, 200);
  assert.deepEqual((await api('GET', '/api/backups')).body.groups, []);
  assert.equal(await fs.readFile(file, 'utf8'), version(3), 'deleting backups never touches the output folder');
});

test('backup routes refuse paths outside the backups folder', async () => {
  for (const url of ['/api/backups/..%2F..%2Fpackage.json/x.rgba', '/api/backups/x.rgba/..%2F..%2F..%2Fpackage.json', '/api/backups/.hidden.rgba/a.rgba', '/api/backups/x.txt/a.rgba']) {
    assert.equal((await api('GET', url)).status, 404, url);
  }
  assert.equal((await api('DELETE', '/api/backups/..%2Fprojects')).status, 404);
  assert.ok((await fs.readdir(path.join(tmp, 'config', 'projects'))).length > 0, 'the projects folder survived');
});
