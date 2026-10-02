/* ============================================================
   JIZURA — Video Captions workbench: one small popover / menu / toast helper (no dependency, no load-time DOM access)
   ============================================================ */
(() => {
'use strict';
const P = J.captionPopover = {};
/* An anchor is an element or a rect-like { left, right, top, bottom }; `restore` is what gets focus when the popover closes. */
const rectOf = anchor => (anchor && typeof anchor.getBoundingClientRect === 'function' ? anchor.getBoundingClientRect() : anchor) || { left: 0, right: 0, top: 0, bottom: 0 };
const focusables = el => [...el.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])')];
let current = null;

/* Place `el` (position: fixed) under the anchor; flip above when it would run off the bottom, keep inside the viewport sideways. */
function place(el, anchor) {
  const rect = rectOf(anchor), box = el.getBoundingClientRect(), vw = window.innerWidth, vh = window.innerHeight;
  el.style.left = `${Math.max(4, Math.min(rect.left, vw - box.width - 4))}px`;
  el.style.top = `${rect.bottom + box.height + 4 > vh ? Math.max(4, rect.top - box.height - 4) : rect.bottom + 4}px`;
}
function close(restore) {
  if (!current) return; const { el, anchor, restoreFocus, onClose } = current; current = null; el.remove();
  document.removeEventListener('pointerdown', onOutside, true);
  if (restore && restoreFocus && restoreFocus.isConnected !== false && typeof restoreFocus.focus === 'function') restoreFocus.focus();
  else if (restore && anchor && anchor.isConnected && typeof anchor.focus === 'function') anchor.focus();
  if (onClose) onClose();
}
function onOutside(event) { if (current && !current.el.contains(event.target)) close(false); }
/* options: role ('menu' | 'dialog'), className, label, restoreFocus, onClose, focus (element to focus first). Returns the element. */
P.open = function open(anchor, content, options) {
  const opts = options || {}; close(false);
  const el = document.createElement('div'); el.className = opts.className || 'caption-popover'; el.setAttribute('role', opts.role || 'dialog');
  if (opts.label) el.setAttribute('aria-label', opts.label);
  el.append(...[].concat(content));
  el.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab' && el.getAttribute('role') === 'menu') { close(false); return; }
    if (el.getAttribute('role') === 'menu' && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      const list = focusables(el), at = list.indexOf(document.activeElement); event.preventDefault(); event.stopPropagation();
      if (list.length) list[(at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus();
    }
  });
  document.body.appendChild(el); current = { el, anchor, restoreFocus: opts.restoreFocus, onClose: opts.onClose };
  place(el, anchor); document.addEventListener('pointerdown', onOutside, true);
  const first = opts.focus || focusables(el)[0]; if (first) first.focus();
  return el;
};
P.close = close;
P.isOpen = () => !!current;
P.place = place;
/* items: [{ label, disabled, run }]; choosing one closes the menu first, returns focus, then runs it. */
P.menu = function menu(anchor, items, options) {
  const buttons = items.map(item => {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'caption-menu-item'; button.setAttribute('role', 'menuitem'); button.textContent = item.label; button.disabled = !!item.disabled;
    button.addEventListener('click', () => { close(true); item.run(); }); return button;
  });
  return P.open(anchor, buttons, Object.assign({ role: 'menu', className: 'caption-menu' }, options));
};

/* Toasts: short result messages in `host`, bottom-centre. `action` = { label, run } adds a button (Undo). One toast at a time; it replaces the last. */
let toast = null;
P.dismissToast = function dismissToast() { if (!toast) return; clearTimeout(toast.timer); toast.el.remove(); toast = null; };
P.toast = function showToast(host, message, action, options) {
  P.dismissToast(); if (!host) return null;
  const el = document.createElement('div'); el.className = 'caption-toast'; el.setAttribute('role', 'group');
  const text = document.createElement('span'); text.textContent = message; el.appendChild(text);
  if (action) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'caption-toast-action'; button.textContent = action.label;
    button.addEventListener('click', () => { P.dismissToast(); action.run(); }); el.appendChild(button);
  }
  host.appendChild(el); toast = { el, timer: setTimeout(P.dismissToast, (options && options.ms) || 6000) };
  return el;
};
})();
