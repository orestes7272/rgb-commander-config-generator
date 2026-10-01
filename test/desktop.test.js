import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let tmp;
let browserLog;
const children = new Set();

before(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rgbcs-desktop-'));
  browserLog = path.join(tmp, 'browser.log');
  // Stands in for the browser: records what it was asked to open.
  await fs.writeFile(path.join(tmp, 'browser.sh'), `#!/bin/sh\necho "$@" >> "${browserLog}"\n`, { mode: 0o755 });
});

after(async () => {
  for (const child of children) child.kill('SIGKILL');
  await fs.rm(tmp, { recursive: true, force: true });
});

function launch(args, env = {}) {
  const child = spawn(process.execPath, [path.join(root, 'server/desktop.js'), ...args], {
    env: {
      ...process.env,
      HOME: tmp,
      XDG_DATA_HOME: path.join(tmp, 'xdg'),
      RCS_BROWSER: path.join(tmp, 'browser.sh'),
      RCS_IDLE_MS: '1500',
      RCS_BYE_MS: '600',
      ...env,
    },
  });
  children.add(child);
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  const exited = new Promise((resolve) => child.on('exit', (code) => (children.delete(child), resolve(code))));
  const url = async () => {
    for (let i = 0; i < 100; i++) {
      const m = /running at (http:\/\/\S+)/.exec(output);
      if (m) return m[1];
      if (child.exitCode !== null) throw new Error(`exited early: ${output}`);
      await sleep(50);
    }
    throw new Error(`no URL printed: ${output}`);
  };
  return { child, url, exited, output: () => output };
}

const post = (url, route) => fetch(new URL(route, url), { method: 'POST' });
const freePort = () =>
  new Promise((resolve) => {
    const srv = net.createServer().listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
const exitWithin = (exited, ms) => Promise.race([exited, sleep(ms).then(() => 'still running')]);

test('--help explains the options', async () => {
  const app = launch(['--help']);
  assert.equal(await app.exited, 0);
  assert.match(app.output(), /--no-open/);
});

test('unknown options are refused', async () => {
  const app = launch(['--frobnicate']);
  assert.equal(await app.exited, 2);
  assert.match(app.output(), /Unknown option --frobnicate/);
});

test('opens a window and quits once the window stops checking in', async () => {
  const app = launch(['--port', '0']);
  const url = await app.url();
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  for (let i = 0; i < 40 && !(await fs.readFile(browserLog, 'utf8').catch(() => '')).includes(url); i++) await sleep(50);
  assert.ok((await fs.readFile(browserLog, 'utf8')).includes(url), 'the browser was asked to open the app');

  const info = await (await fetch(new URL('api/info', url))).json();
  assert.equal(info.desktop, true);
  assert.equal(info.outputDir, path.join(tmp, 'rgbcommander', 'rgba'));
  assert.equal(info.dataDir, path.join(tmp, 'xdg', 'rgb-commander-studio'));

  await sleep(1800);
  assert.equal(app.child.exitCode, null, 'keeps running until the window has checked in at least once');
  assert.equal((await post(url, 'api/desktop/ping')).status, 200);
  assert.equal(await exitWithin(app.exited, 4000), 0, 'stops after the idle timeout');
});

test('closing the window (goodbye) stops it quickly, but a reload does not', async () => {
  const app = launch(['--port', '0'], { RCS_IDLE_MS: '60000' });
  const url = await app.url();
  await post(url, 'api/desktop/ping');
  await post(url, 'api/desktop/bye');
  await post(url, 'api/desktop/ping'); // the reloaded page checking back in
  await sleep(1000);
  assert.equal(app.child.exitCode, null, 'a reload keeps it alive');
  await post(url, 'api/desktop/bye');
  assert.equal(await exitWithin(app.exited, 2500), 0);
});

test('--no-open keeps running with no window', async () => {
  const app = launch(['--port', '0', '--no-open']);
  const url = await app.url();
  assert.equal((await post(url, 'api/desktop/ping')).status, 404, 'no heartbeat without a window');
  await sleep(2000);
  assert.equal(app.child.exitCode, null);
  app.child.kill('SIGTERM');
  assert.equal(await app.exited, 0);
});

test('a second launch reuses the running app', async () => {
  const port = String(await freePort());
  const first = launch(['--port', port]);
  const url = await first.url();
  await post(url, 'api/desktop/ping');
  await fs.rm(browserLog, { force: true });
  const second = launch(['--port', port]);
  assert.equal(await exitWithin(second.exited, 3000), 0);
  assert.match(second.output(), /already running/);
  for (let i = 0; i < 40 && !(await fs.readFile(browserLog, 'utf8').catch(() => '')); i++) await sleep(50);
  assert.ok((await fs.readFile(browserLog, 'utf8')).includes(`127.0.0.1:${port}`), 'opened another window on the running app');
  first.child.kill('SIGTERM');
  await first.exited;
});

test('--install needs the AppImage', async () => {
  const app = launch(['--install'], { APPIMAGE: '' });
  assert.equal(await app.exited, 2);
  const installed = launch(['--install'], { APPIMAGE: '/opt/apps/RGB Commander.AppImage' });
  assert.equal(await installed.exited, 0);
  const entry = await fs.readFile(path.join(tmp, 'xdg', 'applications', 'rgb-commander-studio.desktop'), 'utf8');
  assert.match(entry, /^Exec="\/opt\/apps\/RGB Commander.AppImage"$/m);
  assert.ok(await fs.stat(path.join(tmp, 'xdg', 'icons/hicolor/256x256/apps/rgb-commander-studio.png')));
  assert.equal(await launch(['--uninstall']).exited, 0);
  await assert.rejects(fs.stat(path.join(tmp, 'xdg', 'applications', 'rgb-commander-studio.desktop')));
});
