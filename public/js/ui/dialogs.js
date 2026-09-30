import { h, icon } from '../dom.js';

/**
 * Modal dialog built on <dialog>. Actions: [{ label, value, kind, onClick }]
 * where onClick may return false to keep the dialog open.
 * Returns { el, body, close(value), result: Promise }.
 */
export function openDialog({ title, subtitle, body, actions = [], size = 'md', onClose }) {
  let resolveResult;
  const result = new Promise((r) => (resolveResult = r));
  let closed = false;
  const bodyEl = h('div.modal-body', body);
  const footer = h('footer.modal-actions');
  const dlg = h(
    'dialog.modal.size-' + size,
    { 'aria-label': title },
    h(
      'header.modal-head',
      h('div', h('h2', title), subtitle ? h('p.modal-sub', subtitle) : null),
      h('button.btn.icon-only.ghost', { type: 'button', 'aria-label': 'Close', onclick: (e) => ((viaPointer = e.detail > 0), close(undefined)) }, icon('x')),
    ),
    bodyEl,
    actions.length ? footer : null,
  );

  let viaPointer = false;
  function close(value) {
    if (closed) return;
    closed = true;
    onClose?.(value);
    dlg.close();
    dlg.remove();
    // <dialog> hands focus back to its opener. After a mouse close that would
    // leave e.g. the Effects button focused, and Space would reopen it.
    if (viaPointer) document.activeElement?.blur?.();
    resolveResult(value);
  }

  for (const a of actions) {
    const btn = h(
      'button.btn' + (a.kind ? '.' + a.kind : ''),
      {
        type: 'button',
        disabled: a.disabled,
        onclick: async (e) => {
          viaPointer = e.detail > 0;
          if (a.onClick) {
            btn.disabled = true;
            try {
              const keep = (await a.onClick()) === false;
              if (keep) return;
            } finally {
              btn.disabled = false;
            }
          }
          close(a.value);
        },
      },
      a.icon ? icon(a.icon) : null,
      h('span', a.label),
    );
    if (a.ref) a.ref(btn);
    footer.append(btn);
  }

  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    close(undefined);
  });
  dlg.addEventListener('mousedown', (e) => {
    if (e.target === dlg) {
      viaPointer = true;
      close(undefined);
    }
  });
  document.body.append(dlg);
  dlg.showModal();
  const focusable = dlg.querySelector('[autofocus]') || bodyEl.querySelector('input, select, textarea') || footer.querySelector('.primary');
  focusable?.focus();
  return { el: dlg, body: bodyEl, close, result };
}

export function confirmDialog({ title, message, confirm = 'OK', cancel = 'Cancel', danger = false, extra }) {
  return openDialog({
    title,
    size: 'sm',
    body: [typeof message === 'string' ? h('p', message) : message, extra],
    actions: [
      { label: cancel, value: false, kind: 'ghost' },
      { label: confirm, value: true, kind: danger ? 'danger' : 'primary' },
    ],
  }).result.then((v) => v === true);
}

const toastHost = () => document.getElementById('toasts');

export function toast(message, { kind = 'info', timeout = 4500, action } = {}) {
  const icons = { info: 'info', success: 'check', error: 'alert', warn: 'alert' };
  const el = h(
    'div.toast.' + kind,
    { role: kind === 'error' ? 'alert' : 'status' },
    icon(icons[kind] || 'info'),
    h('div.toast-text', typeof message === 'string' ? message : message),
    action ? h('button.btn.small.ghost', { type: 'button', onclick: () => (action.onClick(), dismiss()) }, action.label) : null,
    h('button.toast-x', { type: 'button', 'aria-label': 'Dismiss', onclick: () => dismiss() }, icon('x', { size: 14 })),
  );
  toastHost().append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  let t = timeout ? setTimeout(dismiss, timeout) : null;
  el.addEventListener('mouseenter', () => clearTimeout(t));
  el.addEventListener('mouseleave', () => {
    if (timeout) t = setTimeout(dismiss, 2000);
  });
  function dismiss() {
    clearTimeout(t);
    el.classList.remove('in');
    setTimeout(() => el.remove(), 250);
  }
  return dismiss;
}

export function errorToast(err, prefix) {
  const msg = err?.message || String(err);
  toast(prefix ? `${prefix}: ${msg}` : msg, { kind: 'error', timeout: 8000 });
}
