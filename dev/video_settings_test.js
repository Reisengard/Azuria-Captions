/* Video settings rework: fill mode (fit / fill / blurred background), bar colour, re-plan on a new output shape. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
// A recording 2D context; the small canvas used for the blurred background gets one too.
const recorder = () => { const calls = []; return { calls, ctx: { calls, save() {}, restore() {}, setTransform() {}, fillRect(...args) { calls.push(['fillRect', ...args]); }, drawImage(...args) { calls.push(['drawImage', ...args]); }, measureText: text => ({ width: Array.from(String(text)).length * 57 }) } }; };
const small = recorder();
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ width: 0, height: 0, getContext: () => small.ctx }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js' && name !== '12c_caption_workbench.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}
const clone = value => JSON.parse(JSON.stringify(value));
const base = { format: 'shorts', clips: [], panels: [], notes: [] };

// Validation: fit and background are optional; old edits stay valid.
J.validateVideoEdits(base, 10);
for (const fit of J.VIDEO_FITS) J.validateVideoEdits({ ...base, fit }, 10);
J.validateVideoEdits({ ...base, fit: 'contain', background: '#12ab34' }, 10);
assert.throws(() => J.validateVideoEdits({ ...base, fit: 'stretch' }, 10));
assert.throws(() => J.validateVideoEdits({ ...base, background: 'red' }, 10));

// Which fill applies: the edit's own choice, else the old project-level sourceFit, else contain (unchanged rendering).
assert.equal(J.videoEditFit({ settings: {} }), 'contain');
assert.equal(J.videoEditFit({ settings: { sourceFit: 'cover' } }), 'cover');
assert.equal(J.videoEditFit({ settings: { sourceFit: 'cover', videoEdit: { ...base, fit: 'blur' } } }), 'blur');
assert.equal(J.videoEditFit({ settings: { videoEdit: { ...base } } }), 'contain');

// Drawing a 16:9 source into a 9:16 frame.
const video = { videoWidth: 1920, videoHeight: 1080 };
const draw = edit => { const out = recorder(); small.calls.length = 0; J.drawVideoEdit(out.ctx, video, 1080, 1920, { settings: edit ? { videoEdit: edit } : {} }); return out.calls; };
const images = calls => calls.filter(call => call[0] === 'drawImage').map(call => call.slice(2).map(n => Math.round(n)));
assert.deepEqual(images(draw(null)), [[0, 656, 1080, 608]], 'a project without edits still draws the whole video with bars');
assert.deepEqual(images(draw({ ...base, fit: 'contain' })), [[0, 656, 1080, 608]]);
assert.deepEqual(images(draw({ ...base, fit: 'cover' })), [[-1167, 0, 3413, 1920]], 'fill crops the sides');
{
  const calls = draw({ ...base, fit: 'contain', background: '#224466' }), bars = calls.find(call => call[0] === 'fillRect');
  assert.deepEqual(bars.slice(1), [0, 0, 1080, 1920]);
}
{
  const calls = draw({ ...base, fit: 'blur' }), drawn = calls.filter(call => call[0] === 'drawImage');
  assert.equal(drawn.length, 2, 'blurred background: the small blurred copy, then the whole video');
  assert.deepEqual(drawn[0].slice(2).map(Math.round), [0, 0, 1080, 1920], 'the blurred copy covers the frame');
  assert.deepEqual(drawn[1].slice(2).map(Math.round), [0, 656, 1080, 608], 'the video is drawn whole on top');
  assert.ok(images(small.calls).length >= 1, 'the small canvas received the cover crop');
  assert.ok(calls.some(call => call[0] === 'fillRect' && call[1] === 0 && call[3] === 1080), 'the copy is darkened');
}
// Panels ignore the fill mode (each panel crops to fill its area).
assert.equal(images(draw({ ...base, fit: 'blur', panels: [{ source: { x: 0, y: 0, w: 1, h: 1 }, target: { x: 0, y: 0, w: 1, h: .5 } }] })).length, 1);

// Store: a new output shape re-plans (fit is measured in the output frame); the same shape does not; undo is exact.
const transcript = J.importWordJson(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8'), { duration: 15 });
const project = { schemaVersion: 3, generatorVersion: 'test', mode: 'video-captions', id: 'video-settings', media: { duration: 15, width: 1080, height: 1920 },
  transcript: clone(transcript), segments: [], plans: {}, safeZones: [], guides: [], seed: 41, style: { preset: 'creator' }, settings: {}, createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z' };
project.tracks = [J.defaultCaptionTrack(project)];
const planned = J.planCaptions(project, project.media); project.segments = planned.segments; project.plans = planned.plans;
const store = new J.CaptionStore(J.loadProject(clone(project)));
const plans = () => JSON.stringify(store.project.plans);
const before = plans();
store.execute({ type: 'set-video-edits', value: { ...base, fit: 'blur' } });
assert.equal(plans(), before, 'the same output shape keeps every plan');
store.execute({ type: 'set-video-edits', value: { ...base, format: 'reels', fit: 'blur' } });
assert.equal(plans(), before, 'Shorts and Reels have the same frame');
store.execute({ type: 'set-video-edits', value: { ...base, format: 'youtube', fit: 'blur' } });
assert.notEqual(plans(), before, 'a new output shape re-plans');
const zone = J.captionResolvedPlan(Object.values(store.project.plans)[0]).zone;
assert.ok(zone.width > 1080, 'plans are measured in the 16:9 output frame');
store.undo(); assert.equal(plans(), before, 'undo restores the plans exactly');
const saved = store.serialize(), loaded = J.loadProject(saved);
assert.equal(loaded.settings.videoEdit.fit, 'blur');
assert.throws(() => store.execute({ type: 'set-video-edits', value: { ...base, fit: 'zoom' } }));
assert.equal(store.serialize(), saved, 'an invalid edit leaves the project untouched');

console.log('Video settings: fill modes, bar colour, drawing, re-plan on a new shape, undo and persistence passed.');
