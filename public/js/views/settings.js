import { h, icon } from '../dom.js';
import { store } from '../store.js';
import { toast, errorToast } from '../ui/dialogs.js';
import { BackupsCard } from '../ui/backups-card.js';

export class SettingsView {
  constructor() {
    this.el = h('div.page.settings-view');
  }

  mount(container, section) {
    container.replaceChildren(this.el);
    document.title = 'Settings · RGB Commander Studio';
    this.backups = new BackupsCard();
    this.render();
    if (section === 'backups') this.backups.el.scrollIntoView({ block: 'start' });
  }

  unmount() {
    this.unsub?.();
  }

  async save(patch, message = 'Saved') {
    try {
      await store.saveSettings(patch);
      toast(message, { kind: 'success', timeout: 1200 });
      this.render();
    } catch (err) {
      errorToast(err, 'Could not save settings');
      this.render();
    }
  }

  async saveOutput(value) {
    const dir = value.trim();
    try {
      await store.saveSettings({ outputDir: dir });
      await store.refreshInfo();
      toast(dir ? `Publishing to ${store.info.outputDir}` : 'Back to the default folder', { kind: 'success', timeout: 2500 });
    } catch (err) {
      errorToast(err, 'Could not use that folder');
    }
    this.render();
  }

  outputRow(info, s) {
    const badge = h('span.badge.' + (info.outputWritable ? 'ok' : 'error'), icon(info.outputWritable ? 'check' : 'alert', { size: 14 }), info.outputWritable ? 'writable' : 'not writable');
    if (!info.outputEditable) {
      return h(
        'div.setting.stacked',
        h('div', h('strong', 'Output folder'), h('p', 'Published .rgba files land here (the path inside the container). Map it to the share Syncthing sends to your cabinet.')),
        h('div.path-row', h('code.path', info.outputDir), badge),
        info.outputWritable ? null : permissionHelp(info.outputDir, info),
      );
    }
    return h(
      'div.setting.stacked',
      h(
        'div',
        h('strong', 'Output folder'),
        h('p', 'Published .rgba files land here. Point it at a folder Syncthing shares with your cabinet, or at a mounted Unraid share. It’s created if it doesn’t exist yet.'),
      ),
      h(
        'div.path-row',
        h('input.mono.path-input', { type: 'text', value: info.outputDir, spellcheck: 'false', 'aria-label': 'Output folder', onchange: (e) => this.saveOutput(e.target.value) }),
        badge,
      ),
      s.outputDir ? h('div', h('button.btn.small.ghost', { type: 'button', onclick: () => this.saveOutput('') }, 'Use the default folder')) : null,
      info.outputWritable ? null : h('p.field-msg.error', 'The app can’t write to this folder. Choose another one, or fix its permissions.'),
    );
  }

  mountInfoListener() {
    this.unsub ??= store.on('info', () => this.render());
  }

  render() {
    this.mountInfoListener();
    const s = store.settings;
    const info = store.info;
    const toggle = (key, label, hint) =>
      h('label.setting.check', h('input', { type: 'checkbox', checked: s[key], onchange: (e) => this.save({ [key]: e.target.checked }) }), h('div', h('strong', label), h('p', hint)));
    const number = (key, label, hint, min, max, unit) =>
      h(
        'label.setting',
        h('div', h('strong', label), h('p', hint)),
        h('div.input-suffix', h('input.num', { type: 'number', min, max, value: s[key], onchange: (e) => this.save({ [key]: Number(e.target.value) }) }), unit ? h('span', unit) : null),
      );
    this.el.replaceChildren(
      h('header.page-head', h('div', h('h1', 'Settings'), h('p', 'Stored in the app’s data folder and shared by every browser.'))),
      h(
        'section.card',
        h('h2', 'Output'),
        this.outputRow(info, s),
        info.dataWritable ? null : h('div.setting.stacked', h('div', h('strong', 'Data folder'), h('code.path', info.dataDir)), permissionHelp(info.dataDir, info)),
        h(
          'label.setting',
          h('div', h('strong', 'File name prefix'), h('p', 'Suggested at the start of new file names, so your files sort apart from the stock Pattern01_32 ones.')),
          h('input.mono', { type: 'text', value: s.filePrefix, maxlength: 20, onchange: (e) => this.save({ filePrefix: e.target.value.trim() }) }),
        ),
        h(
          'label.setting',
          h('div', h('strong', 'Line endings'), h('p', 'The files that ship with RGBcommander use Windows (CRLF) line endings. RGBcommander reads either.')),
          h(
            'select',
            { onchange: (e) => this.save({ eol: e.target.value }) },
            h('option', { value: 'crlf', selected: s.eol === 'crlf' }, 'CRLF (like the stock files)'),
            h('option', { value: 'lf', selected: s.eol === 'lf' }, 'LF'),
          ),
        ),
      ),
      h(
        'section.card',
        h('h2', 'Preview'),
        h(
          'label.setting.check',
          h('input', { type: 'checkbox', checked: s.previewMode === 'led', onchange: (e) => this.save({ previewMode: e.target.checked ? 'led' : 'raw' }) }),
          h(
            'div',
            h('strong', 'Show colours the way the LEDs glow'),
            h('p', 'LED values are PWM duty cycles, so 64 out of 255 is a quarter of the light, which looks far brighter than rgb(0,0,64) on a screen. Turn off to see the raw numbers as screen colours.'),
          ),
        ),
        toggle('simulateHardware', 'Simulate hardware timing', 'Plays animations at the speed the cabinet will: RGBcommander writes every pin over USB before each frame’s delay starts.'),
        number(
          'frameWriteMs',
          'USB write time per frame',
          'Rough estimate. Community measurements put a 255 ms frame at about 440 ms on real hardware. To calibrate, time a 20-frame, 0 ms animation on the cabinet and divide by 20.',
          0,
          2000,
          'ms',
        ),
        number('defaultFrameMs', 'Default frame duration', 'Used for blank frames you add. RGBcommander allows 0–255 ms per frame; longer holds are split automatically.', 0, 255, 'ms'),
        toggle('showPorts', 'Show LED port numbers', 'Little badges on each button with the port it’s wired to.'),
      ),
      this.backups.el,
      h(
        'section.card',
        h('h2', 'About'),
        h(
          'dl.about',
          h('dt', 'Version'),
          h('dd', info.version),
          h('dt', 'Data folder'),
          h('dd', h('code', info.dataDir)),
          h('dt', 'Password'),
          h('dd', info.auth ? 'On (AUTH_PASSWORD is set)' : info.desktop ? 'Off. Set AUTH_PASSWORD before starting the app to require one.' : 'Off. Set AUTH_PASSWORD on the container to require one.'),
        ),
        h(
          'p.hint',
          'RGBcommander only reads new animations when it restarts; the README has a small helper that restarts it whenever Syncthing delivers files.',
        ),
      ),
    );
  }
}

function permissionHelp(dir, info) {
  const [uid, gid] = String(info.user || '99:100').split(':');
  return h(
    'div.callout.error',
    icon('alert'),
    h(
      'div',
      h('p', `The app runs as ${info.user}${dir === info.outputDir && info.outputOwner ? `, but this folder belongs to ${info.outputOwner}` : ''}, so it can't write here. Either:`),
      h(
        'ul',
        h('li', 'Set the container’s PUID/PGID to the folder’s owner', dir === info.outputDir && info.outputOwner ? ` (${info.outputOwner.replace(':', ' / ')})` : '', ', or'),
        h('li', 'give the app’s user access on the Unraid terminal: ', h('code', `chown -R ${uid}:${gid} <host folder>`), ' (Tools → Docker Safe New Perms does the same for whole shares).'),
      ),
      h('p.hint', 'Reload this page after fixing it.'),
    ),
  );
}

