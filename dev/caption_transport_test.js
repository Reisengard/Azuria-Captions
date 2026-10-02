/* Rework plan T2: transport maths (loop, speed, stepping, caption neighbours, key map) and the loop / speed wiring in the workbench source. */
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
const TL = J.captionTimeline, near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

// speed cycles 1 -> .75 -> .5 -> 1
assert.deepEqual(TL.SPEEDS, [1, .75, .5]);
assert.equal(TL.nextSpeed(1), .75); assert.equal(TL.nextSpeed(.75), .5); assert.equal(TL.nextSpeed(.5), 1); assert.equal(TL.nextSpeed(3), .75);

// marked region: ordered, clamped, too-short = none
assert.deepEqual(TL.markRegion(5, 2, 15), { start: 2, end: 5 });
assert.deepEqual(TL.markRegion(-3, 20, 15), { start: 0, end: 15 });
assert.equal(TL.markRegion(4, 4.05, 15), null);

// L loops the marked region, else the selected caption with a 0.3 s lead
assert.deepEqual(TL.loopRegion({ start: 1, end: 3 }, { start: 5, end: 6 }, 15), { start: 1, end: 3 });
assert.deepEqual(TL.loopRegion(null, { start: 5, end: 6 }, 15), { start: 4.7, end: 6.3 });
assert.deepEqual(TL.loopRegion(null, { start: .1, end: 14.9 }, 15), { start: 0, end: 15 });
assert.equal(TL.loopRegion(null, null, 15), null);

// the per-frame hook wraps only once the end has been reached
const region = { start: 4.7, end: 6.3 };
assert.equal(TL.loopSeek(6.29, region), null); assert.equal(TL.loopSeek(6.3, region), 4.7); assert.equal(TL.loopSeek(9, region), 4.7);
assert.equal(TL.loopSeek(9, null), null);

// frame and second steps stay on the 30 fps grid and inside the video
near(TL.stepTime(1, 1, {}, 15), 1 + 1 / 30); near(TL.stepTime(1, -1, {}, 15), 1 - 1 / 30);
near(TL.stepTime(1.016, -1, {}, 15), 1); near(TL.stepTime(1.016, 1, {}, 15), 1 + 1 / 30);
near(TL.stepTime(0, -1, {}, 15), 0); near(TL.stepTime(15, 1, {}, 15), 15);
near(TL.stepTime(3.5, 1, { seconds: 1 }, 15), 4.5); near(TL.stepTime(.4, -1, { seconds: 1 }, 15), 0); near(TL.stepTime(14.5, 1, { seconds: 1 }, 15), 15);

// previous / next caption across tracks, relative to the playhead
const segments = [{ id: 'b', start: 4, end: 5 }, { id: 'a', start: 1, end: 2 }, { id: 'c', start: 4, end: 6 }, { id: 'd', start: 9, end: 10 }];
assert.equal(TL.adjacentSegment(segments, 0, 1).id, 'a'); assert.equal(TL.adjacentSegment(segments, 1, 1).id, 'b'); assert.equal(TL.adjacentSegment(segments, 4, 1).id, 'd');
assert.equal(TL.adjacentSegment(segments, 9, 1), null); assert.equal(TL.adjacentSegment(segments, 9, -1).id, 'c'); assert.equal(TL.adjacentSegment(segments, 1, -1), null);

// keyboard map
const key = (code, extra = {}) => TL.keyAction(Object.assign({ code, key: code }, extra));
assert.equal(key('Space'), 'play'); assert.equal(key('KeyL'), 'loop'); assert.equal(key('Escape'), 'escape');
assert.equal(key('ArrowLeft'), 'back-frame'); assert.equal(key('ArrowRight', { shiftKey: true }), 'forward-1s');
assert.equal(key('ArrowUp'), 'prev-caption'); assert.equal(key('ArrowDown'), 'next-caption'); assert.equal(key('Home'), 'start'); assert.equal(key('End'), 'end');
assert.equal(key('Equal', { key: '+' }), 'zoom-in'); assert.equal(key('Minus', { key: '-' }), 'zoom-out'); assert.equal(key('Digit0', { key: '0' }), 'zoom-fit');
assert.equal(key('KeyZ', { ctrlKey: true }), null); assert.equal(key('ArrowLeft', { altKey: true }), null); assert.equal(key('KeyL', { metaKey: true }), null); assert.equal(key('KeyQ'), null);

// wiring: the transport owns the loop/speed/key handler; the view marks the region; markup + localized copy exist
const src = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const transport = src('12br_caption_transport.js'), view = src('12bq_caption_timeline_view.js'), body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
assert.match(transport, /loopSeek/); assert.match(transport, /playbackRate/); assert.match(transport, /addEventListener\('keydown', onKey, true\)/);
assert.match(view, /setMarked/); assert.match(view, /placeLoop/);
for (const id of ['captionLoop', 'captionSpeed', 'captionLoopRegion']) assert.match(body, new RegExp(`id="${id}"`));
console.log('Caption transport tests passed.');
