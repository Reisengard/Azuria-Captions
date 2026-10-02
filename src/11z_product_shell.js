/* ============================================================
   JIZURA — two-mode product shell (Gate 5.1)
   ============================================================ */
(() => {
'use strict';

if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;

const STORAGE_KEY = 'jizura.productMode.v1';
/* Lyric Motion is hidden while the captions editor is reworked. Its code, markup and
   tests stay; set to true to bring the mode switch and the Lyric Motion surface back. */
const LYRIC_MOTION_ENABLED = false;
const ALL_MODES = Object.freeze(['video-captions', 'lyrics']);
const MODES = LYRIC_MOTION_ENABLED ? ALL_MODES : Object.freeze(['video-captions']);
const DEFAULT_MODE = LYRIC_MOTION_ENABLED ? 'lyrics' : 'video-captions';
const SURFACES = Object.freeze({
  'video-captions': 'videoCaptionsWorkspace',
  lyrics: 'lyricMotionWorkspace',
});
let current = DEFAULT_MODE;

const validMode = mode => MODES.includes(mode) ? mode : DEFAULT_MODE;

function apply(mode, options) {
  const root = document.getElementById('app');
  if (!root) return DEFAULT_MODE;
  current = validMode(mode);
  root.dataset.productMode = current;

  for (const candidate of ALL_MODES) {
    const button = root.querySelector(`[data-product-mode="${candidate}"]`);
    const surface = document.getElementById(SURFACES[candidate]);
    const active = candidate === current;
    if (button) {
      button.hidden = !LYRIC_MOTION_ENABLED;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    }
    if (surface) surface.hidden = !active;
  }

  if (!options || options.persist !== false) {
    try { localStorage.setItem(STORAGE_KEY, current); } catch (error) {}
  }
  root.dispatchEvent(new CustomEvent('jizura:product-mode', { detail: { mode: current } }));
  return current;
}

function init() {
  const group = document.getElementById('productModes');
  if (!group) return;
  const nav = group.closest('.product-shell');
  if (nav) nav.hidden = !LYRIC_MOTION_ENABLED;
  let saved = DEFAULT_MODE;
  try { saved = localStorage.getItem(STORAGE_KEY) || saved; } catch (error) {}
  apply(saved, { persist: false });

  group.addEventListener('click', event => {
    const button = event.target.closest('[data-product-mode]');
    if (button) apply(button.dataset.productMode);
  });
  group.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const at = Math.max(0, MODES.indexOf(current));
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? MODES.length - 1
      : (at + (event.key === 'ArrowRight' ? 1 : -1) + MODES.length) % MODES.length;
    apply(MODES[next]);
    const button = group.querySelector(`[data-product-mode="${MODES[next]}"]`);
    if (button) button.focus();
  });
}

J.productMode = Object.freeze({
  modes: MODES,
  lyricMotionEnabled: LYRIC_MOTION_ENABLED,
  get current() { return current; },
  select: apply,
});

/* The assembled script is emitted after app/body.html, so the shell markup is
   already available even while document.readyState still reports "loading". */
init();
})();
