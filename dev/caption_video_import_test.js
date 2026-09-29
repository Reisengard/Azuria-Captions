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
  get childElementCount() { return 0; }
}
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
  document: { querySelectorAll: () => [], getElementById: el, createElement: tag => tag === 'video' ? new Video() : new Element() },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  J: { captionStyleProfileId: () => 'creator', resolveCaptionLook: () => ({ look: {}, explicit: {} }), captionTrackProjectStyle: style => style, captionLookOptions: () => [], CAPTION_STANDARD_LOOKS: { creator: {} },
    CAPTION_LOOK_KEYS: ['layout', 'enter', 'hold', 'exit', 'active'], CAPTION_LOOK_FIELDS: { layout: { group: 'layout', plan: 'layout' }, enter: { group: 'enter', plan: 'entrance' }, hold: { group: 'hold', plan: 'hold' }, exit: { group: 'exit', plan: 'exit' }, active: { group: 'active', plan: 'activeWordTreatment' } },
    defaultCaptionTrack: () => ({ id: 'track_main', primary: true }), captionTrack: () => null, captionEffectiveBox: () => null, captionBoxWarnings: () => [], captionSyncDefaultBoxes: project => project, captionSyncTrackBoxes: project => project, captionBoxCollisions: () => [], captionTrackSegments: () => [], captionTrackNeighbor: () => null, captionSegmentsAt: () => [], CAPTION_MAX_TRACKS: 3, CAPTION_PRIMARY_TRACK_ID: 'track_main', CAPTION_FONTS: [], FONTS: {}, CAPTION_ACTIVE: {}, captionRoleFonts: () => [], captionFontStatus: () => [], CaptionStore: class { constructor(project) { this.project = project; } canUndo() { return false; } canRedo() { return false; } },
    MediaPreviewController: class { constructor(options) { this.video = options.video; } connect() { previews++; return this; } renderNow() {} disconnect() {} } },
  addEventListener() {}
});
context.window = context;
for (const file of ['10a_video_edits.js', '10c_media_import.js', '12c_caption_workbench.js']) vm.runInContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), context);
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
