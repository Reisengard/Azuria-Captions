'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
class Element {
  constructor() { this.listeners = {}; this.style = {}; this.dataset = {}; this.value = ''; this.options = []; this.selectedIndex = -1; this.classList = { toggle() {} }; }
  addEventListener(name, fn) { (this.listeners[name] ||= new Set()).add(fn); }
  removeEventListener(name, fn) { this.listeners[name]?.delete(fn); }
  emit(name, extra = {}) { for (const fn of this.listeners[name] || []) fn({ target: this, ...extra }); }
  replaceChildren() {}
  setAttribute() {}
  appendChild(child) { return child; }
  append() {}
  querySelectorAll() { return []; }
  closest() { return null; }
  get childElementCount() { return 0; }
}
// Only for font measurement while the modules load; page elements have no 2D context, so canvas painting is skipped.
class Canvas extends Element { getContext() { return { measureText: text => ({ width: String(text).length * 30 }) }; } }
class Video extends Element {
  constructor() { super(); this.duration = 15; this.videoWidth = 1920; this.videoHeight = 1080; this.currentTime = 0; this.paused = true; }
  load() { if (this.src) queueMicrotask(() => this.emit('loadedmetadata')); }
  play() { this.paused = false; this.emit('play'); return Promise.resolve(); }
  pause() { this.paused = true; this.emit('pause'); }
  removeAttribute() { this.src = ''; }
}
const elements = new Map();
const el = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
let previews = 0;
const context = vm.createContext({ console, Uint8Array, Set, Map, queueMicrotask,
  document: { querySelector: () => null, querySelectorAll: () => [], getElementById: el, createElement: tag => tag === 'video' ? new Video() : tag === 'canvas' ? new Canvas() : new Element() },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  J: {},
  addEventListener() {}
});
context.window = context;
/* The real modules (store, planner, looks, boxes, tracks) so the workbench never runs against a stale hand-made J.
   Left out: the Lyric Motion UI, the product shell and the video editor panel (DOM-heavy, not under test here).
   Only the preview controller is replaced: it needs a real canvas and video frames. */
for (const file of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && !/^(12_ui|11z_product_shell|12a_video_edit_ui|12c_caption_workbench)\.js$/.test(name)).sort()) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), context, { filename: file });
}
context.J.MediaPreviewController = class { constructor(options) { this.video = options.video; } connect() { previews++; return this; } renderNow() {} disconnect() {} };
vm.runInContext(fs.readFileSync(path.join(root, 'src', '12c_caption_workbench.js'), 'utf8'), context, { filename: '12c_caption_workbench.js' });
const file = { name: 'clip.mp4', type: 'video/mp4', size: 1, lastModified: 1, slice: () => ({ arrayBuffer: async () => new ArrayBuffer(1) }) };
async function select(id, selected) { el(id).files = [selected]; el(id).emit('change'); await new Promise(resolve => setImmediate(resolve)); }
(async () => {
  await select('captionVideoFile', file);
  assert.equal(previews, 1, 'selecting a video must reach preview connection');
  assert.equal(el('captionPreviewEmpty').hidden, true);
  assert.equal(el('captionPlay').disabled, false);
  assert.equal(el('captionDuration').textContent, '00:15.00');
  const video = context.J.captionWorkbench.media.current.video;
  el('captionPlay').emit('click'); assert.equal(video.paused, false);
  el('captionScrub').value = 500; el('captionScrub').emit('input'); assert.equal(video.currentTime, 7.5);
  el('app').emit('jizura:product-mode', { detail: { mode: 'lyric' } }); assert.equal(video.paused, true);
  await select('captionVideoFile', { ...file, type: 'text/plain' });
  assert.match(el('captionStatus').textContent, /not identified as a video/);
  await select('captionVideoFile', file); assert.equal(previews, 2, 'retry must connect preview');
  el('captionNew').emit('click');
  el('captionPlay').emit('click'); el('captionScrub').emit('input');
  assert.equal(context.J.captionWorkbench.media, null);
  console.log('Caption video selection, playback, retry, and reset passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
