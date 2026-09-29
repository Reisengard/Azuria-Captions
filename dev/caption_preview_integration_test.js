'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add() {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({ measureText: text => ({ width: String(text).length * 30 }) }) }) };
for (const file of fs.readdirSync(path.join(root, 'src')).filter(file => file.endsWith('.js') && file !== '12_ui.js').sort()) vm.runInThisContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file });
// Only font measurement is simulated; use the real planner, layouts and compositor.
J.measure = ({ text, size }) => ({ w: Array.from(text).length * size * .55, h: size });
const transcript = J.importSrt('1\n00:00:00,000 --> 00:00:03,000\nHello 字幕\n', { timingQuality: 'estimated' });
const project = { media: { width: 1920, height: 1080, duration: 3 }, transcript, segments: [], plans: {}, seed: 3107, style: { preset: 'creator' } };
Object.assign(project, J.planCaptions(project, project.media));
let videoDraws = 0, textDraws = 0, saves = 0;
const ctx = { beginPath() {}, rect() {}, clip() {}, rotate() {}, transform() {}, setLineDash() {}, moveTo() {}, lineTo() {}, stroke() {}, globalAlpha: 1, save() { saves++; }, restore() { saves--; }, setTransform() {}, fillRect() {}, drawImage() { videoDraws++; }, translate() {}, scale() {}, strokeText() {}, fillText() { textDraws++; }, measureText(text) { return { width: text.length * 20 }; } };
const canvas = { width: 960, height: 540, clientWidth: 960, clientHeight: 540, getContext: () => ctx };
const video = { videoWidth: 1920, videoHeight: 1080, currentTime: .5, readyState: 1, paused: true, ended: false, listeners: {}, callbacks: new Map(), nextId: 0,
  addEventListener(name, fn) { this.listeners[name] = fn; }, removeEventListener(name) { delete this.listeners[name]; },
  requestVideoFrameCallback(fn) { const id = ++this.nextId; this.callbacks.set(id, fn); return id; }, cancelVideoFrameCallback(id) { this.callbacks.delete(id); },
  present(time) { const [id, fn] = this.callbacks.entries().next().value; this.callbacks.delete(id); fn(0, { mediaTime: time }); } };
const errors = [];
let failOnce = false;
const preview = new J.MediaPreviewController({ video, canvas, designWidth: 1920, designHeight: 1080,
  renderCaptions(context, time, info) { if (failOnce) { failOnce = false; throw new Error('test frame failure'); } return J.drawCaptionOverlay(context, project, time, info); }, onError: error => errors.push(error) });
preview.connect();
assert.equal(videoDraws, 0, 'metadata alone must not trigger drawImage');
video.readyState = 2; video.listeners.loadeddata();
assert.equal(errors.length, 0, 'real compositor failed: ' + errors.map(error => error.stack).join('\n'));
assert.ok(videoDraws > 0 && textDraws > 0, 'first decoded frame must draw both video and captions');
video.paused = false; video.listeners.play();
failOnce = true; video.present(1);
assert.equal(errors.length, 1);
assert.equal(video.callbacks.size, 1, 'a failed caption frame must not stop video updates');
const before = textDraws; video.present(1.5);
assert.ok(textDraws > before, 'captions must resume on the next frame');
assert.equal(saves, 0, 'canvas saves/restores must stay balanced');
// Export uses this same compositor with a different design size.
assert.ok(J.drawCaptionOverlay(ctx, project, 1, { designWidth: 1080, designHeight: 1920 }));
const saved = project.plans; project.plans = {};
assert.ok(J.drawCaptionOverlay(ctx, project, 1), 'default zone also needs an id and kind');
project.plans = saved;
preview.disconnect();
assert.equal(video.callbacks.size, 0);
console.log('Integrated video/caption drawing, zone scaling, decoded-frame readiness and recovery passed.');
