/* ============================================================
   Azuria Sub — Video Captions workbench: shell (icon rail, one drawer at a time, top-bar menu, view preferences)
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb;
const { ui, $ } = W;

/* Each rail item opens one drawer; a drawer shows one or more of the existing panes (their ids and markup are unchanged). */
const DRAWERS = {
  captions: { title: '字幕', panes: ['captionLeftPane_transcript'] },
  text: { title: '文字', panes: ['captionStylePane_style'] },
  effects: { title: 'エフェクト', panes: ['captionStylePane_effects'] },
  tracks: { title: 'トラック', panes: ['captionStylePane_tracks'] },
  video: { title: '動画', panes: ['captionStylePane_video'] },
};
const DRAWER_OF_STYLE_TAB = { style: 'text', effects: 'effects', tracks: 'tracks', video: 'video' };
const DRAWER_OF_LEFT_TAB = { transcript: 'captions', roles: 'text' };
const PREF_KEY = 'jizura.captionShell', DEFAULT_DRAWER = 'captions';

/* View preference, kept per browser (not in the project). `drawer` is a drawer name, or '' when the preview has the whole width. */
function readPref() {
  try { const value = JSON.parse(localStorage.getItem(PREF_KEY) || 'null'); if (value && typeof value.drawer === 'string' && (value.drawer === '' || DRAWERS[value.drawer])) return value.drawer; } catch (error) {}
  return typeof matchMedia === 'function' && matchMedia('(max-width: 680px)').matches ? '' : DEFAULT_DRAWER;   // on a phone the preview comes first
}
function writePref(drawer) { try { localStorage.setItem(PREF_KEY, JSON.stringify({ drawer })); } catch (error) {} }

function setDrawer(name, options) {
  const drawer = DRAWERS[name] ? name : '';
  ui.drawer = drawer;
  const bench = document.querySelector('.caption-workbench'), panel = $('captionDrawer');
  if (bench) bench.dataset.drawer = drawer;
  if (panel) panel.hidden = !drawer;
  for (const button of document.querySelectorAll('#captionRail [data-drawer]')) button.setAttribute('aria-expanded', String(button.dataset.drawer === drawer));
  if (drawer) {
    $('captionDrawerTitle').textContent = DRAWERS[drawer].title;
    const shown = DRAWERS[drawer].panes;
    for (const pane of document.querySelectorAll('.caption-left-pane, .caption-style-pane')) pane.hidden = !shown.includes(pane.id);
    const styleTab = Object.keys(DRAWER_OF_STYLE_TAB).find(tab => DRAWER_OF_STYLE_TAB[tab] === drawer), leftTab = Object.keys(DRAWER_OF_LEFT_TAB).find(tab => DRAWER_OF_LEFT_TAB[tab] === drawer);
    if (styleTab) ui.styleTab = styleTab;
    if (leftTab) ui.leftTab = leftTab;
    if (drawer === 'effects' && J.refreshCaptionEffectPreviews) J.refreshCaptionEffectPreviews();
  }
  if (!options || options.persist !== false) writePref(drawer);
  if (W.onWorkbenchResize && options && options.layout !== false) W.onWorkbenchResize();   // the preview frame is re-fitted to the space that is left
}
const openDrawer = name => setDrawer(name);
const toggleDrawer = name => setDrawer(ui.drawer === name ? '' : name);
const selectStyleTab = tab => openDrawer(DRAWER_OF_STYLE_TAB[tab] || 'text');
const selectLeftTab = tab => openDrawer(DRAWER_OF_LEFT_TAB[tab] || 'captions');

/* ---- ⋯ menu: project and file actions that do not belong in the slim top bar ---- */
function menuIsOpen() { const menu = $('captionMenu'); return !!menu && !menu.hidden; }
function setMenu(open, restoreFocus) {
  const menu = $('captionMenu'), button = $('captionMenuButton'); if (!menu || !button) return;
  menu.hidden = !open; button.setAttribute('aria-expanded', String(open));
  if (open) { const first = menu.querySelector('button:not(:disabled), label.file'); if (first && first.focus) first.focus(); }
  else if (restoreFocus) button.focus();
}
function bindMenu() {
  const menu = $('captionMenu'), button = $('captionMenuButton'); if (!menu || !button) return;
  button.addEventListener('click', () => setMenu(!menuIsOpen()));
  menu.addEventListener('click', event => { if (event.target.closest('button')) setMenu(false); });
  menu.addEventListener('change', () => setMenu(false));
  document.addEventListener('pointerdown', event => { if (menuIsOpen() && !event.target.closest('.caption-menu-wrap')) setMenu(false); }, true);
  document.addEventListener('keydown', event => {
    if (!menuIsOpen()) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenu(false, true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const items = [...menu.querySelectorAll('button:not(:disabled)')], at = items.indexOf(document.activeElement);
      if (!items.length) return;
      event.preventDefault(); items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
    }
  }, true);
}

/* The Tracks item is only useful with a second track (the timeline headers cover add / rename / reorder / delete); Advanced always shows it. */
function syncTracksItem() {
  const item = $('captionRail_tracks'), workspace = $('videoCaptionsWorkspace'); if (!item) return;
  const hide = !!(workspace && workspace.classList && workspace.classList.contains && workspace.classList.contains('is-easy')) && W.trackCount() < 2;
  item.hidden = hide;
  if (hide && ui.drawer === 'tracks') setDrawer('text', { persist: false });
}

function init() {
  for (const button of document.querySelectorAll('#captionRail [data-drawer]')) button.addEventListener('click', () => toggleDrawer(button.dataset.drawer));
  $('captionDrawerClose').addEventListener('click', () => { setDrawer(''); const rail = document.querySelector('#captionRail [data-drawer]'); if (rail) rail.focus(); });
  $('captionDrawer').addEventListener('keydown', event => {   // Esc inside the drawer closes it and puts focus back on its rail item
    if (event.key !== 'Escape' || event.defaultPrevented || !ui.drawer || event.target.closest('[role=menu], .caption-popover')) return;
    const current = document.querySelector(`#captionRail [data-drawer="${ui.drawer}"]`);
    setDrawer(''); if (current) current.focus();
  });
  bindMenu();
  setDrawer(readPref(), { persist: false, layout: false });
  W.on('project', syncTracksItem, 5); syncTracksItem();
}

Object.assign(W, { openDrawer, toggleDrawer, closeDrawer: () => setDrawer(''), selectStyleTab, selectLeftTab, setMenu, syncTracksItem });
W.shell = Object.freeze({ drawers: Object.freeze(Object.keys(DRAWERS)), prefKey: PREF_KEY, defaultDrawer: DEFAULT_DRAWER });
W.inits.push(init);
})();
