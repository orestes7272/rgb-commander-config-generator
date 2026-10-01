// Desktop entry point (what the AppImage runs). Starts the app on this computer,
// opens it in its own window and quits once that window has been closed.
//
//   rgb-commander-studio [--port N] [--host ADDR] [--output DIR] [--data DIR] [--no-open]
//   rgb-commander-studio --install | --uninstall

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { start } from './index.js';

const APP_ID = 'rgb-commander-studio';
const DEFAULT_PORT = 47821;
// The window checks in every 5 s. Minimised windows can be throttled to one timer
// a minute, so allow a few minutes of silence before giving up on it. Closing the
// window says goodbye, which cuts that to a few seconds: long enough for a reload
// to check back in.
const IDLE_MS = Number(process.env.RCS_IDLE_MS) || 180_000;
const BYE_MS = Number(process.env.RCS_BYE_MS) || 8_000;
// Browsers that can open a page as a standalone app window (--app=URL).
const APP_WINDOW_BROWSERS = ['chromium-browser', 'chromium', 'google-chrome-stable', 'google-chrome', 'brave-browser', 'brave', 'microsoft-edge-stable', 'microsoft-edge', 'vivaldi-stable', 'vivaldi'];

const home = os.homedir();
const xdgData = process.env.XDG_DATA_HOME || path.join(home, '.local/share');
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

const HELP = `RGB Commander Studio: design RGBcommander lighting files.

Usage: rgb-commander-studio [options]

  --port N       Port to use (default ${DEFAULT_PORT})
  --host ADDR    Address to listen on (default 127.0.0.1, this computer only).
                 Use 0.0.0.0 to let other devices in, ideally with AUTH_PASSWORD set.
  --output DIR   Publish .rgba files to DIR instead of the folder chosen in Settings
  --data DIR     Keep schemes and settings in DIR (default ${path.join(xdgData, APP_ID)})
  --no-open      Don't open a window; keep running until stopped with Ctrl+C
  --install      Add RGB Commander Studio to your applications menu
  --uninstall    Remove it from the menu again
  --help         Show this help
`;

function fail(message) {
  console.error(message);
  process.exit(2);
}

function parseArgs(argv) {
  const args = argv.flatMap((a) => (/^--\w[\w-]*=/.test(a) ? [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)] : [a]));
  const opts = { open: true };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => (i + 1 < args.length ? args[++i] : fail(`${arg} needs a value`));
    if (arg === '--port') opts.port = Number(value());
    else if (arg === '--host') opts.host = value();
    else if (arg === '--output') opts.output = value();
    else if (arg === '--data') opts.data = value();
    else if (arg === '--no-open') opts.open = false;
    else if (arg === '--install') opts.action = 'install';
    else if (arg === '--uninstall') opts.action = 'uninstall';
    else if (arg === '--help' || arg === '-h') opts.action = 'help';
    else fail(`Unknown option ${arg} (try --help)`);
  }
  if (opts.port !== undefined && !(Number.isInteger(opts.port) && opts.port >= 0 && opts.port <= 65535)) fail('--port must be a number from 0 to 65535');
  return opts;
}

function which(cmd) {
  if (cmd.includes('/')) return existsSync(cmd) ? cmd : null;
  for (const dir of (process.env.PATH || '').split(':')) {
    if (dir && existsSync(path.join(dir, cmd))) return path.join(dir, cmd);
  }
  return null;
}

function launch(cmd, args) {
  const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
  child.on('error', (err) => console.error(`Couldn't start ${cmd} (${err.message}). Open the address above in a browser.`));
  child.unref();
}

/** A standalone app window if a Chromium-family browser is installed, else the default browser. */
function openWindow(url, dataDir) {
  if (process.env.RCS_BROWSER) {
    const [cmd, ...args] = process.env.RCS_BROWSER.trim().split(/\s+/);
    return launch(cmd, [...args, url]);
  }
  for (const name of APP_WINDOW_BROWSERS) {
    const bin = which(name);
    if (!bin) continue;
    // Its own profile keeps the window separate from your normal browsing and
    // remembers the app's preferences between launches.
    return launch(bin, [`--app=${url}`, `--user-data-dir=${path.join(dataDir, 'window-profile')}`, '--no-first-run', '--no-default-browser-check', `--class=${APP_ID}`, '--window-size=1440,900']);
  }
  if (which('xdg-open')) return launch('xdg-open', [url]);
  console.log(`Open ${url} in your browser.`);
}

/** Is our app already answering on this port? */
async function runningHere(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    return (await res.json())?.app === APP_ID;
  } catch {
    return false;
  }
}

/** Double-quote a path for a .desktop Exec= line. */
const execQuote = (p) => `"${p.replace(/(["`$\\])/g, '\\$1')}"`;

async function install() {
  const appimage = process.env.APPIMAGE;
  if (!appimage) fail('--install adds the AppImage to your menu, so run it from the AppImage file.');
  const appsDir = path.join(xdgData, 'applications');
  const iconDir = path.join(xdgData, 'icons/hicolor/256x256/apps');
  await fs.mkdir(appsDir, { recursive: true });
  await fs.mkdir(iconDir, { recursive: true });
  await fs.copyFile(path.join(publicDir, 'icon-256.png'), path.join(iconDir, `${APP_ID}.png`));
  const entry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=RGB Commander Studio',
    'Comment=Design RGBcommander button lighting for Ultimarc LED boards',
    `Exec=${execQuote(appimage)}`,
    `TryExec=${appimage}`,
    `Icon=${APP_ID}`,
    'Terminal=false',
    'Categories=Utility;',
    'Keywords=arcade;LED;RGB;Ultimarc;RGBcommander;',
    `StartupWMClass=${APP_ID}`,
    '',
  ].join('\n');
  const file = path.join(appsDir, `${APP_ID}.desktop`);
  await fs.writeFile(file, entry);
  console.log(`Added RGB Commander Studio to your applications menu (${file}).`);
  console.log('If you move the AppImage, run it with --install again.');
}

async function uninstall() {
  await fs.rm(path.join(xdgData, 'applications', `${APP_ID}.desktop`), { force: true });
  await fs.rm(path.join(xdgData, 'icons/hicolor/256x256/apps', `${APP_ID}.png`), { force: true });
  console.log('Removed RGB Commander Studio from your applications menu. Your schemes are untouched.');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.action === 'help') return console.log(HELP);
  if (opts.action === 'install') return install();
  if (opts.action === 'uninstall') return uninstall();

  const dataDir = path.resolve(opts.data || process.env.DATA_DIR || path.join(xdgData, APP_ID));
  const host = opts.host || process.env.HOST || '127.0.0.1';
  const fixedPort = opts.port ?? (process.env.PORT ? Number(process.env.PORT) : undefined);
  const port = fixedPort ?? DEFAULT_PORT;

  // Launched again while running: just bring up another window.
  if (await runningHere(port)) {
    const url = `http://127.0.0.1:${port}/`;
    console.log(`RGB Commander Studio is already running at ${url}`);
    if (opts.open) openWindow(url, dataDir);
    return;
  }

  let deadline = Infinity;
  const hooks = opts.open
    ? {
        onPing: () => (deadline = performance.now() + IDLE_MS),
        onBye: () => (deadline = Math.min(deadline, performance.now() + BYE_MS)),
      }
    : {};
  const env = { ...process.env, HOST: host, PORT: String(port), DATA_DIR: dataDir, RCS_DESKTOP: '1', PUID: '', PGID: '' };
  if (opts.output) env.OUTPUT_DIR = path.resolve(opts.output);
  else if (!process.env.OUTPUT_DIR) env.DEFAULT_OUTPUT_DIR = path.join(home, 'rgbcommander', 'rgba');

  let server;
  try {
    ({ server } = await start(env, hooks));
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    if (fixedPort !== undefined) fail(`Port ${port} is already in use; pick another with --port.`);
    // Something else has our usual port: take any free one.
    ({ server } = await start({ ...env, PORT: '0' }, hooks));
  }

  const shown = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host.includes(':') ? `[${host}]` : host;
  const url = `http://${shown}:${server.address().port}/`;
  console.log(`\nRGB Commander Studio is running at ${url}`);

  const stop = () => {
    server.close();
    process.exit(0);
  };
  for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, stop);

  if (opts.open) {
    console.log('Close the app window to quit, or press Ctrl+C here.\n');
    openWindow(url, dataDir);
    setInterval(() => {
      if (performance.now() > deadline) {
        console.log('The app window was closed; stopping.');
        stop();
      }
    }, 1000);
  } else {
    console.log('Press Ctrl+C to stop.\n');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
