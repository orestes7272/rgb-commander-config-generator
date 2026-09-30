import { h, icon } from '../dom.js';
import { store } from '../store.js';
import { api } from '../api.js';
import { openDialog, toast, errorToast } from './dialogs.js';
import { STARTERS, buildStarter } from '../core/effects.js';
import { validateFileName, suggestFileName, prettyName } from '../core/rgba.js';
import { projectFromRgba } from '../core/project.js';

function nameFields({ name = '', fileName = '' } = {}) {
  const prefix = store.settings.filePrefix;
  const nameInput = h('input', { type: 'text', value: name, maxlength: 80, placeholder: 'e.g. Mike blue', autofocus: true, 'aria-label': 'Scheme name' });
  const fileInput = h('input.mono', { type: 'text', value: fileName || suggestFileName(name, prefix), maxlength: 80, spellcheck: 'false', 'aria-label': 'File name' });
  const msg = h('p.field-msg');
  let touched = Boolean(fileName);
  const check = () => {
    const err = validateFileName(fileInput.value);
    const clash = store.projects.find((p) => p.fileName === fileInput.value);
    msg.textContent = err || (clash ? `“${clash.name}” already publishes to this file name.` : `Saved as ${fileInput.value}.rgba`);
    msg.className = 'field-msg' + (err ? ' error' : clash ? ' warn' : '');
    return !err;
  };
  nameInput.addEventListener('input', () => {
    if (!touched) fileInput.value = suggestFileName(nameInput.value, prefix);
    check();
  });
  fileInput.addEventListener('input', () => {
    touched = true;
    check();
  });
  check();
  const el = h(
    'div.form-grid',
    h('label', h('span', 'Name'), nameInput),
    h('label', h('span', 'File name'), h('div.input-suffix', fileInput, h('span', '.rgba')), msg),
  );
  return { el, nameInput, fileInput, check };
}

async function createAndOpen(body, warnings = []) {
  const res = await api.createProject(body);
  store.projects.unshift({ ...res.project, status: res.status, thumb: res.project.frames[0].pins, frameCount: res.project.frames.length });
  store.emit('projects');
  location.hash = `#/editor/${res.project.id}`;
  const all = [...warnings, ...(res.warnings || [])];
  if (all.length) toast(h('div', h('strong', 'Imported with notes'), h('ul', all.map((w) => h('li', w)))), { kind: 'warn', timeout: 12000 });
  return res.project;
}

export function openNewSchemeDialog() {
  const fields = nameFields({ name: '' });
  let starter = 'blank';
  const board = store.board;
  const cards = h(
    'div.starter-grid',
    { role: 'radiogroup', 'aria-label': 'Start from' },
    STARTERS.map((s) =>
      h(
        'label.starter',
        h('input', { type: 'radio', name: 'starter', value: s.id, checked: s.id === starter, onchange: () => (starter = s.id) }),
        h('strong', s.name),
        h('span', s.blurb),
      ),
    ),
  );
  const fileInput = h('input', { type: 'file', accept: '.rgba,.xml,text/xml,application/xml', hidden: true });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    if (!file) return;
    dialog.close();
    await importLocalFile(file);
  });

  const dialog = openDialog({
    title: 'New lighting scheme',
    size: 'md',
    body: [
      fields.el,
      h('h4', 'Start from'),
      cards,
      h(
        'div.import-row',
        icon('upload'),
        h('span', 'Already have a file? '),
        h('button.btn.link', { type: 'button', onclick: () => fileInput.click() }, 'Import a .rgba from this computer'),
        h('span', ' or open one from the '),
        h('a', { href: '#/files', onclick: () => dialog.close() }, 'Files tab'),
        '.',
        fileInput,
      ),
    ],
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Create scheme',
        kind: 'primary',
        onClick: async () => {
          if (!fields.check()) return false;
          const frames = buildStarter(starter, {
            controls: store.controls,
            pinCount: board.pinCount,
            portCount: board.portCount,
            portPins: (p) => board.portPins(p),
            color: store.color,
          });
          try {
            await createAndOpen({ name: fields.nameInput.value.trim() || 'Untitled scheme', fileName: fields.fileInput.value, board: board.id, frames });
          } catch (err) {
            errorToast(err, 'Could not create the scheme');
            return false;
          }
        },
      },
    ],
  });
  return dialog;
}

export async function importLocalFile(file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    return errorToast(err, 'Could not read the file');
  }
  const base = file.name.replace(/\.(rgba|xml)$/i, '');
  const fileName = validateFileName(base) ? suggestFileName(base) : base;
  let imported;
  try {
    imported = projectFromRgba(text, { name: prettyName(base, store.settings.filePrefix), fileName, board: store.board.id });
  } catch (err) {
    return errorToast(err, `${file.name} isn’t a usable .rgba file`);
  }
  try {
    const { project } = imported;
    await createAndOpen({ name: project.name, fileName: project.fileName, board: project.board, frames: project.frames }, imported.warnings);
    toast(`Imported ${file.name}. Publish it to send it to the cabinet.`, { kind: 'success' });
  } catch (err) {
    errorToast(err, 'Import failed');
  }
}

export function openRenameDialog() {
  const project = store.project;
  const fields = nameFields({ name: project.name, fileName: project.fileName });
  return openDialog({
    title: 'Rename scheme',
    size: 'sm',
    body: [fields.el, h('p.hint', 'Changing the file name publishes to a new file next time; the old file stays in the output folder until you delete it on the Files tab.')],
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Save',
        kind: 'primary',
        onClick: () => {
          if (!fields.check()) return false;
          store.setMeta({ name: fields.nameInput.value.trim() || project.name, fileName: fields.fileInput.value });
        },
      },
    ],
  });
}
