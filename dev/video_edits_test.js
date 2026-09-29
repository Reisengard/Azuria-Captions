'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const context = vm.createContext({ J: {}, console });
for (const file of ['08a_project.js', '08g_caption_zones.js', '10a_video_edits.js', '10d_media_preview.js', '11d_media_audio.js', '12b_caption_store.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
const J = context.J;
const project = { schemaVersion: 2, generatorVersion: 'test', mode: 'video-captions', id: 'edits', media: { duration: 10, width: 1920, height: 1080 }, transcript: { tokens: [] }, segments: [], plans: {}, settings: {} };
const edits = { format: 'youtube', clips: [{ start: 1, end: 3 }, { start: 5, end: 8 }], panels: [], notes: [] };
assert.equal(J.videoEditDuration(edits.clips), 5);
assert.equal(J.videoSourceTime(edits.clips, 0), 1);
assert.equal(J.videoSourceTime(edits.clips, 2), 5, 'cut boundary must use the next kept section');
assert.equal(J.videoSourceTime(edits.clips, 4.5), 7.5);
const store = new J.CaptionStore(project);
store.execute({ type: 'set-video-edits', value: edits });
assert.equal(J.videoOutputSize(store.project).width, 1920);
const saved = store.serialize();
assert.equal(J.loadProject(saved).settings.videoEdit.clips.length, 2);
store.undo(); assert.equal(store.project.settings.videoEdit, undefined);
store.redo(); assert.equal(store.serialize(), saved);
for (const clips of [[{ start: 2, end: 1 }], [{ start: 1, end: 11 }], [{ start: 0, end: 3 }, { start: 2, end: 4 }]]) {
  assert.throws(() => store.execute({ type: 'set-video-edits', value: { ...edits, clips } }));
  assert.equal(store.serialize(), saved, 'invalid edits must leave history and project intact');
}
const note = { text: 'Note', start: 1, end: 3, x: .5, y: .2, size: 4, color: '#ffffff' };
edits.notes = [note, { ...note, text: 'Second note', y: .4 }];
store.execute({ type: 'set-video-edits', value: edits });
const text = [], calls = [], ctx = { save() {}, restore() {}, setTransform() {}, fillRect() {}, drawImage(...args) { calls.push(args); }, measureText(s) { return { width: s.length * 10 }; }, strokeText() {}, fillText(s) { text.push(s); } };
J.drawVideoNotes(ctx, store.project, 2, { designWidth: 1080, designHeight: 1920 });
assert.deepEqual(text, ['Note', 'Second note'], 'all overlapping notes must draw');
text.length = 0; J.drawVideoNotes(ctx, store.project, 3, { designWidth: 1080, designHeight: 1920 }); assert.equal(text.length, 0);
edits.panels = [{ source: { x: .5, y: 0, w: .5, h: 1 }, target: { x: 0, y: 0, w: 1, h: .5 } }];
store.execute({ type: 'set-video-edits', value: edits });
J.drawVideoEdit(ctx, { width: 1920, height: 1080 }, 1080, 1920, store.project);
const draw = calls[0]; assert.equal(draw.length, 9); assert.ok(draw[1] >= 960); assert.ok(Math.abs(draw[3] / draw[4] - draw[7] / draw[8]) < 1e-9, 'crop must preserve the source aspect ratio');
assert.throws(() => J.validateVideoEdits({ ...edits, panels: [{ source: { x: .9, y: 0, w: .5, h: 1 }, target: { x: 0, y: 0, w: 1, h: 1 } }] }, 10));
console.log('Video edits: time mapping, validation, history, persistence, overlapping notes, and aspect-preserving crops passed.');

// Overlays (transparent PNG frames/templates)
{
  const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const overlay = { id: 'overlay_1', name: 'frame.png', src: PNG, x: 0, y: 0, w: 1, h: 1, opacity: 1, layer: 'below' };
  const base = { format: 'shorts', clips: [], panels: [], notes: [] };
  J.validateVideoEdits(base, 10);                                       // old edits without overlays stay valid
  J.validateVideoEdits({ ...base, overlays: [overlay] }, 10);
  for (const bad of [{ src: 'data:text/html;base64,AA==' }, { opacity: 2 }, { w: 0 }, { layer: 'middle' }, { id: '' }])
    assert.throws(() => J.validateVideoEdits({ ...base, overlays: [{ ...overlay, ...bad }] }, 10), undefined, JSON.stringify(bad));
  assert.throws(() => J.validateVideoEdits({ ...base, overlays: Array.from({ length: 5 }, (_, i) => ({ ...overlay, id: 'o' + i })) }, 10));
  const calls = [], ctx = { save() {}, restore() {}, globalAlpha: 1, drawImage: (...args) => calls.push(args) };
  const project = { settings: { videoEdit: { ...base, overlays: [overlay, { ...overlay, id: 'overlay_2', layer: 'above', x: .5, w: .5, opacity: .5 }] } } };
  J.drawVideoOverlays(ctx, project, 'below', { designWidth: 1080, designHeight: 1920 });
  assert.equal(calls.length, 0, 'an image that is not decoded yet is skipped, not a crash');
}
