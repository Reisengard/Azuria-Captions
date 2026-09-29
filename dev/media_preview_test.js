/* Dependency-free tests for Gate 4.3 synchronized source-video preview. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', '01_util.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', '10d_media_preview.js'), 'utf8'));

class FakeVideo {
  constructor() { this.videoWidth = 1920; this.videoHeight = 1080; this.currentTime = 0; this.paused = true; this.ended = false; this.listeners = {}; this.callbacks = new Map(); this.nextId = 1; this.cancelled = []; }
  addEventListener(name, fn) { (this.listeners[name] ||= new Set()).add(fn); }
  removeEventListener(name, fn) { this.listeners[name] && this.listeners[name].delete(fn); }
  emit(name) { for (const fn of this.listeners[name] || []) fn(); }
  requestVideoFrameCallback(fn) { const id = this.nextId++; this.callbacks.set(id, fn); return id; }
  cancelVideoFrameCallback(id) { this.cancelled.push(id); this.callbacks.delete(id); }
  present(metadata) { const [id, fn] = this.callbacks.entries().next().value; this.callbacks.delete(id); fn(0, metadata); }
}
const calls = [];
const ctx = { canvas: null, save() { calls.push(['save']); }, restore() { calls.push(['restore']); }, setTransform(...v) { calls.push(['transform', ...v]); },
  fillRect(...v) { calls.push(['fill', ...v]); }, drawImage(...v) { calls.push(['draw', ...v]); }, globalAlpha: 1, globalCompositeOperation: '', filter: '', fillStyle: '' };
const canvas = { width: 0, height: 0, clientWidth: 540, clientHeight: 960, getContext: () => ctx }; ctx.canvas = canvas;
const video = new FakeVideo(), captionTimes = [], frames = [];
const preview = new J.MediaPreviewController({ video, canvas, env: { devicePixelRatio: 2 }, designWidth: 1080, designHeight: 1920,
  maxPixels: 1080 * 1920, renderCaptions: (context, time, info) => { captionTimes.push(time); assert.equal(info.designWidth, 1080); }, onFrame: frame => frames.push(frame) });

assert.deepStrictEqual(J.sourceFrameRect(1920, 1080, 1080, 1920, 'contain'), { x: 0, y: 656.25, width: 1080, height: 607.5, scale: 0.5625, fit: 'contain' });
const cover = J.sourceFrameRect(1920, 1080, 1080, 1920, 'cover');
assert.equal(cover.height, 1920); assert.ok(cover.x < 0);
const exportFrameRect = J.drawSourceVideo(ctx, { width: 1920, height: 1080 }, 1080, 1920, 'contain');
assert.deepStrictEqual(exportFrameRect, { x: 0, y: 656.25, width: 1080, height: 607.5, scale: 0.5625, fit: 'contain' },
  'decoded canvas frames must use width/height during export');
preview.connect();
assert.equal(captionTimes.at(-1), 0);
assert.equal(canvas.width, 1080); assert.equal(canvas.height, 1920);

video.paused = false; video.emit('play');
assert.equal(video.callbacks.size, 1);
video.currentTime = 1.05;
video.present({ mediaTime: 1, expectedDisplayTime: 25, presentedFrames: 1 });
assert.equal(captionTimes.at(-1), 1, 'captions did not receive the presented media time');
assert.equal(preview.diagnostics.lastMediaTime, 1);
video.present({ mediaTime: 1.5, expectedDisplayTime: 42, presentedFrames: 4 });
assert.equal(preview.diagnostics.droppedCallbacks, 2);

video.currentTime = 7.25; video.emit('seeking');
assert.equal(captionTimes.at(-1), 7.25, 'seek did not immediately use video.currentTime');
video.paused = true; video.emit('pause');
assert.ok(video.cancelled.length >= 1, 'pause did not cancel the frame callback');
assert.equal(video.callbacks.size, 0);

preview.setFit('cover');
assert.equal(frames.at(-1).sourceRect.fit, 'cover');
preview.disconnect();
assert.equal([...Object.values(video.listeners)].reduce((n, set) => n + set.size, 0), 0, 'disconnect leaked video listeners');
assert.throws(() => J.sourceFrameRect(1, 1, 1, 1, 'stretch'), error => error.code === 'MEDIA_PREVIEW_FIT_INVALID');
console.log('Gate 4.3 media preview tests passed.');
