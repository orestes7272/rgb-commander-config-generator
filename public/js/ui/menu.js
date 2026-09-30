import { h, icon } from '../dom.js';

let open = null;

/** Popover menu under an anchor. items: [{ label, icon, onClick, danger, disabled, hint } | 'sep'] */
export function showMenu(anchor, items) {
  closeMenu();
  const menu = h(
    'div.menu',
    { role: 'menu' },
    items.map((item) =>
      item === 'sep'
        ? h('div.menu-sep', { role: 'separator' })
        : h(
            'button.menu-item' + (item.danger ? '.danger' : ''),
            {
              type: 'button',
              role: 'menuitem',
              disabled: item.disabled,
              onclick: () => {
                closeMenu();
                item.onClick();
              },
            },
            item.icon ? icon(item.icon, { size: 16 }) : h('span.menu-icon-space'),
            h('span.menu-label', item.label),
            item.hint ? h('span.menu-hint', item.hint) : null,
          ),
    ),
  );
  document.body.append(menu);
  const a = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  const left = Math.min(window.innerWidth - m.width - 8, Math.max(8, a.right - m.width));
  const below = a.bottom + 6 + m.height < window.innerHeight;
  menu.style.left = `${left}px`;
  menu.style.top = `${below ? a.bottom + 6 : a.top - m.height - 6}px`;
  anchor.setAttribute('aria-expanded', 'true');
  const onDoc = (e) => {
    if (!menu.contains(e.target) && e.target !== anchor && !anchor.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      closeMenu();
      anchor.focus();
    }
  };
  setTimeout(() => document.addEventListener('pointerdown', onDoc), 0);
  document.addEventListener('keydown', onKey);
  open = {
    close() {
      menu.remove();
      anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    },
  };
  menu.querySelector('.menu-item:not([disabled])')?.focus();
}

export function closeMenu() {
  open?.close();
  open = null;
}
