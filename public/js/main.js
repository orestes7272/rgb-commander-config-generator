import { h, icon } from './dom.js';
import { store } from './store.js';
import { EditorView, showShortcuts } from './views/editor.js';
import { LayoutView } from './views/layout.js';
import { FilesView } from './views/files.js';
import { SettingsView } from './views/settings.js';
import { closeMenu } from './ui/menu.js';
import { api } from './api.js';

const root = document.getElementById('app');
const nav = document.getElementById('nav');
let current = null;
let currentName = null;

const VIEWS = {
  editor: () => new EditorView(),
  layout: () => new LayoutView(),
  files: () => new FilesView(),
  settings: () => new SettingsView(),
};

function renderNav(active) {
  const links = [
    ['editor', 'Editor', 'paint', `#/editor${store.project ? '/' + store.project.id : ''}`],
    ['layout', 'Panel layout', 'grid', '#/layout'],
    ['files', 'Files', 'folder', '#/files'],
    ['settings', 'Settings', 'settings', '#/settings'],
  ];
  const info = store.info;
  const blocked = info && (!info.outputWritable || !info.dataWritable);
  nav.replaceChildren(
    ...links.map(([id, label, ic, href]) => h('a.nav-link', { href, 'aria-current': id === active ? 'page' : null }, icon(ic, { size: 16 }), h('span', label))),
    blocked
      ? h(
          'a.nav-warn',
          { href: '#/settings', title: `The app (running as ${info.user}) can't write to ${!info.outputWritable ? info.outputDir : info.dataDir}. Open Settings for the fix.` },
          icon('alert', { size: 16 }),
          h('span', !info.outputWritable ? 'Output folder not writable' : 'Data folder not writable'),
        )
      : null,
    h('button.btn.icon-only.ghost.nav-help', { type: 'button', title: 'Keyboard shortcuts (?)', 'aria-label': 'Keyboard shortcuts', onclick: () => showShortcuts() }, icon('keyboard')),
  );
}

async function route() {
  closeMenu();
  const [, name = 'editor', arg] = (location.hash || '#/editor').split('/');
  const viewName = VIEWS[name] ? name : 'editor';
  if (current && currentName === viewName && viewName === 'editor') {
    await current.open(arg ? decodeURIComponent(arg) : null);
    renderNav(viewName);
    return;
  }
  if (currentName === 'editor' || currentName === 'layout') await store.flushSave().catch(() => {});
  current?.unmount?.();
  current = VIEWS[viewName]();
  currentName = viewName;
  renderNav(viewName);
  await current.mount(root, arg ? decodeURIComponent(arg) : null);
  document.body.dataset.view = viewName;
  refreshInfo();
}

/** Folder permissions can be fixed while the app is open, so re-check on navigation. */
async function refreshInfo() {
  try {
    const info = await api.info();
    const changed = JSON.stringify(info) !== JSON.stringify(store.info);
    store.info = info;
    if (changed) {
      renderNav(currentName);
      store.emit('info');
    }
  } catch {
    // the next navigation tries again
  }
}

async function boot() {
  root.replaceChildren(h('div.boot', h('div.boot-leds', [1, 2, 3].map(() => h('span'))), h('p', 'Loading…')));
  try {
    await store.boot();
  } catch (err) {
    root.replaceChildren(
      h(
        'div.boot.error',
        icon('alert', { size: 32 }),
        h('h2', 'Can’t load the app'),
        h('p', err.message),
        h('button.btn.primary', { type: 'button', onclick: () => boot() }, 'Try again'),
      ),
    );
    return;
  }
  window.addEventListener('hashchange', route);
  store.on('project', () => renderNav(currentName));
  await route();
}

window.addEventListener('beforeunload', (e) => {
  if (store.saveState === 'dirty' || store.saveState === 'saving') {
    store.flushSave();
    e.preventDefault();
    e.returnValue = '';
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.flushSave().catch(() => {});
});

// Mouse clicks shouldn't leave buttons focused: Space/Enter would re-trigger them
// instead of reaching the editor shortcuts. Keyboard activation (detail 0) keeps focus.
document.addEventListener('click', (e) => {
  const control = e.target.closest?.('button, a.btn, .nav-link');
  if (control && e.detail > 0 && !control.closest('dialog')) setTimeout(() => control.blur(), 0);
});

document.addEventListener('keydown', (e) => {
  if (e.key === '?' && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !document.querySelector('dialog[open]') && currentName !== 'editor') showShortcuts();
});

boot();
