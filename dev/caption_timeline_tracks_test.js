/* Rework plan T4: track helpers of the timeline model and the header wiring (rename, reorder, menu, + track, Alt+arrows). */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
vm.runInThisContext('var J = globalThis.J = globalThis.J || {};');
const filename = path.join(root, 'src', '12bp_caption_timeline_model.js');
vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
const TL = J.captionTimeline;

const tracks = [{ id: 'main' }, { id: 'second' }, { id: 'third' }];
assert.equal(TL.adjacentTrackId(tracks, 'second', -1), 'main'); assert.equal(TL.adjacentTrackId(tracks, 'second', 1), 'third');
assert.equal(TL.adjacentTrackId(tracks, 'main', -1), null); assert.equal(TL.adjacentTrackId(tracks, 'third', 1), null); assert.equal(TL.adjacentTrackId(tracks, 'nope', 1), null);

// the header lands on the nearest row, but never before the primary track
assert.equal(TL.reorderIndex([10, 40, 70], 72), 2); assert.equal(TL.reorderIndex([10, 40, 70], 38), 1);
assert.equal(TL.reorderIndex([10, 40, 70], -50), 1, 'index 0 is the primary track and stays first');

const src = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const view = src('12bq_caption_timeline_view.js'), transport = src('12br_caption_transport.js'), panel = src('12bw_caption_panels_tracks.js');
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8'), css = fs.readFileSync(path.join(root, 'app', 'style.css'), 'utf8'), english = fs.readFileSync(path.join(root, 'app', 'english.py'), 'utf8');
assert.match(view, /data-track-grip|dataset\.trackGrip/); assert.match(view, /role', 'menu'/); assert.match(view, /type: 'move-segment'[^}]*trackId: target/);
assert.match(view, /W\.reorderTrack\(drag\.to - from, drag\.id\)/); assert.match(view, /W\.renameTrack/); assert.match(view, /captionTrackAddInline/);
assert.doesNotMatch(view, /store\.execute/, 'the view must go through runCommand');
assert.match(transport, /track-up/); assert.match(transport, /moveSelectedTrack/);
assert.match(panel, /rename-track/); assert.match(panel, /function reorderTrack\(step, trackId\)/);
assert.match(body, /id="captionTrackAddInline"/); assert.match(body, /Alt\+↑ \/ ↓/);
for (const selector of ['caption-track-grip', 'caption-track-more', 'caption-track-drop', 'caption-track-add', 'caption-menu']) assert.match(css, new RegExp(`\.${selector}`));
assert.match(english, /\+ Track/); assert.match(english, /Rename/);
console.log('Caption timeline track tests passed.');
