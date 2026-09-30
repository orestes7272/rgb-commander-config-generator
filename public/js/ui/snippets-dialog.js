import { h, icon, clear } from '../dom.js';
import { store } from '../store.js';
import { openDialog, toast } from './dialogs.js';
import { ledboardSnippet, animationUsageSnippet, coloursSnippet } from '../core/snippets.js';

function codeBlock(text, label) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(`${label} copied`, { kind: 'success', timeout: 1800 });
    } catch {
      toast('Copy failed; select the text and copy it manually', { kind: 'warn' });
    }
  };
  return h('div.code-block', h('pre', h('code', text)), h('button.btn.small.copy-btn', { type: 'button', onclick: copy }, icon('copy', { size: 14 }), h('span', 'Copy')));
}

export function openSnippetsDialog(initialTab = 'play') {
  const project = store.project;
  const tabs = [
    ['play', 'Play this file'],
    ['static', 'Static colours'],
    ['hardware', 'Hardware section'],
  ];
  let active = initialTab;
  const tabBar = h('div.tabs-inline', { role: 'tablist' });
  const panel = h('div.snippet-panel');

  function render() {
    clear(tabBar);
    for (const [id, label] of tabs) {
      tabBar.append(
        h('button.tab-inline', { type: 'button', role: 'tab', 'aria-selected': String(id === active), onclick: () => ((active = id), render()) }, label),
      );
    }
    clear(panel);
    if (active === 'play') {
      if (!project) {
        panel.append(h('p', 'Open a scheme first.'));
        return;
      }
      panel.append(
        h('p', 'RGBcommander finds animations by file name, without the .rgba extension. Point it at ', h('code', project.fileName), ' in rgbcmdd.xml:'),
        codeBlock(animationUsageSnippet(project.fileName), 'Snippet'),
        h(
          'ul.notes',
          h('li', 'The file has to be in RGBcommander’s rgba folder (', h('code', '/usr/sbin/rgbcommander/rgba'), ' on RetroPie).'),
          h('li', 'RGBcommander only reads animations when it starts, so restart it after new files arrive: ', h('code', 'sudo systemctl restart rgbcommander'), '. The auto-reload helper in the README does this for you.'),
          h('li', 'Speed quirk in 0.4.0.5: any speed from 100 to 150 plays at normal speed, and anything below 100 skips the frame delays entirely. Leave it at 100.'),
          h('li', 'rgbadefault="RANDOM" picks from every file in the folder, including this one.'),
        ),
      );
    } else if (active === 'static') {
      if (!project) {
        panel.append(h('p', 'Open a scheme first.'));
        return;
      }
      const { colours, rom, map } = coloursSnippet(store.layout, store.frame.pins, project.fileName);
      panel.append(
        h('p', `Use frame ${store.frameIndex + 1} as fixed button colours instead of an animation, e.g. for one emulator or as the frontend’s static map. Colours that already exist in the stock list are reused by name.`),
        h('h4', '1 · Add to <colours>'),
        codeBlock(colours, 'Colours'),
        h('h4', '2a · In-game colours: put inside an <emulator> (or rename the id to a ROM name)'),
        codeBlock(rom, 'ROM block'),
        h('h4', '2b · Or show it while the frontend runs: inside <mappings><mapping name="static">, with rgbadefault="STATIC"'),
        codeBlock(map, 'Map block'),
      );
    } else {
      const { xml, warnings } = ledboardSnippet(store.layout);
      panel.append(
        h('p', 'Tells RGBcommander which pins each named button uses. Generated from the Panel layout tab; replaces the matching ', h('code', '<ledboard>'), ' in <hardware><ledboards>.'),
        warnings.length ? h('div.callout.warn', icon('alert'), h('ul', warnings.map((w) => h('li', w)))) : null,
        codeBlock(xml, 'Ledboard block'),
        h('p.hint', 'Pins are listed R,G,B. On the Ultimate I/O the second header (pins 49–96) is wired B,G,R, so those triplets count down, just like RGBcommander’s own example.'),
      );
    }
  }

  render();
  return openDialog({
    title: 'Use in rgbcmdd.xml',
    subtitle: 'Copy-paste snippets for RGBcommander’s config file. Remember: the file is case sensitive and spells it “colour”.',
    size: 'lg',
    body: [tabBar, panel],
    actions: [{ label: 'Done', kind: 'primary' }],
  });
}
