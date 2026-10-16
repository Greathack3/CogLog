/* Cognitive Evolution Tracker — UI primitives: toasts, modals, confirmations, image viewer. */
window.UI = (function () {
  'use strict';
  const { el, esc } = U;

  /* ---------------- toasts ---------------- */

  function toast(msg, kind) {
    const root = document.getElementById('toast-root');
    const t = el('<div class="toast toast-' + (kind || 'info') + '" role="status">' + esc(msg) + '</div>');
    root.appendChild(t);
    requestAnimationFrame(() => t.classList.add('show'));
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 350);
    }, kind === 'error' ? 5200 : 3200);
  }

  /* ---------------- modal ---------------- */

  let openCount = 0;

  function modal(opts) {
    // opts: { title, body (HTMLElement|string), footer (HTMLElement|string), wide, onClose, dismissable }
    const root = document.getElementById('modal-root');
    const backdrop = el('<div class="modal-backdrop"></div>');
    const box = el('<div class="modal' + (opts.wide ? ' modal-wide' : '') + '" role="dialog" aria-modal="true"></div>');
    const head = el('<div class="modal-head"><h2>' + esc(opts.title || '') + '</h2>' +
      (opts.dismissable === false ? '' : '<button class="icon-btn" data-close title="Close" aria-label="Close">✕</button>') + '</div>');
    const body = el('<div class="modal-body"></div>');
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    const foot = el('<div class="modal-foot"></div>');
    if (typeof opts.footer === 'string') foot.innerHTML = opts.footer; else if (opts.footer) foot.appendChild(opts.footer);
    box.appendChild(head); box.appendChild(body); box.appendChild(foot);
    backdrop.appendChild(box);
    root.appendChild(backdrop);
    openCount++;

    function close() {
      if (!backdrop.isConnected) return;
      backdrop.remove();
      openCount--;
      document.removeEventListener('keydown', onKey);
      if (opts.onClose) opts.onClose();
    }
    function onKey(e) {
      if (e.key === 'Escape' && opts.dismissable !== false && openCount === 1) { e.stopPropagation(); close(); }
    }
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('mousedown', (e) => {
      if (e.target === backdrop && opts.dismissable !== false) close();
    });
    head.querySelector('[data-close]') && head.querySelector('[data-close]').addEventListener('click', close);
    return { close, body, foot, box };
  }

  /** Confirmation dialog. Resolves true when confirmed. */
  function confirm(opts) {
    return new Promise((resolve) => {
      const body = el('<div class="confirm-body">' +
        (opts.messageHtml || esc(opts.message || 'Are you sure?')) + '</div>');
      const f = el('<div class="confirm-actions">' +
        '<button class="btn" data-cancel>' + esc(opts.cancelLabel || 'Cancel') + '</button>' +
        '<button class="btn ' + (opts.danger === false ? 'primary' : 'danger') + '" data-ok>' + esc(opts.okLabel || 'Confirm') + '</button>' +
        '</div>');
      const m = modal({ title: opts.title || 'Please confirm', body, footer: f, wide: !!opts.wide });
      f.querySelector('[data-cancel]').addEventListener('click', () => { m.close(); resolve(false); });
      f.querySelector('[data-ok]').addEventListener('click', () => { m.close(); resolve(true); });
    });
  }

  /** Prompt for a single text value. Resolves string or null. */
  function promptText(opts) {
    return new Promise((resolve) => {
      const body = el('<div class="field"><label>' + esc(opts.label || 'Value') + '</label>' +
        '<input type="' + (opts.type || 'text') + '" value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '"></div>');
      const input = body.querySelector('input');
      const f = el('<div class="confirm-actions"><button class="btn" data-cancel>Cancel</button>' +
        '<button class="btn primary" data-ok>' + esc(opts.okLabel || 'Save') + '</button></div>');
      const m = modal({ title: opts.title || 'Enter value', body, footer: f });
      const done = (v) => { m.close(); resolve(v); };
      f.querySelector('[data-cancel]').addEventListener('click', () => done(null));
      f.querySelector('[data-ok]').addEventListener('click', () => done(input.value.trim() || null));
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(input.value.trim() || null); });
      setTimeout(() => input.focus(), 40);
    });
  }

  /* ---------------- image viewer ---------------- */

  function viewImage(dataUrl, name) {
    const body = el('<div class="image-viewer"><img src="' + dataUrl + '" alt="' + esc(name || 'Attachment') + '"></div>');
    modal({ title: name || 'Attachment', body, wide: true });
  }

  /* ---------------- small builders ---------------- */

  function field(label, innerHtml, hint) {
    return el('<div class="field"><label>' + esc(label) + '</label>' + innerHtml +
      (hint ? '<div class="hint">' + hint + '</div>' : '') + '</div>');
  }

  function chip(text, color, cls) {
    return '<span class="chip ' + (cls || '') + '">' +
      (color ? '<i class="dot" style="background:' + esc(color) + '"></i>' : '') + esc(text) + '</span>';
  }

  return { toast, modal, confirm, promptText, viewImage, field, chip };
})();
