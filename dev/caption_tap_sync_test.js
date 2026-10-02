/* Rework plan C4: tap-sync maths (scope, windows from taps / holds, reaction offset) and the wiring of the session in the workbench source. */
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

// offset: 0 – 0.3 s, default 0.12, junk = default
assert.equal(TL.REACTION_DEFAULT, .12); assert.equal(TL.clampReaction(.5), .3); assert.equal(TL.clampReaction(-1), 0); assert.equal(TL.clampReaction('x'), .12); assert.equal(TL.clampReaction('0.2'), .2);

// scope: from the selected caption to the end of its track; a marked range takes the captions starting inside it; locked captions are skipped
const seg = (id, start, end, extra) => Object.assign({ id, trackId: 'a', start, end, locked: false }, extra);
const segments = [seg('s1', 0, 1), seg('s2', 2, 3), seg('s3', 4, 5, { locked: true }), seg('s4', 6, 7), seg('o1', 2.5, 3.5, { trackId: 'b' })];
let scope = TL.tapSyncScope(segments, { trackId: 'a', fromId: 's2' });
assert.deepEqual(scope.items.map(item => item.id), ['s2', 's4']); assert.equal(scope.skipped, 1); assert.equal(scope.floor, 1); assert.equal(scope.after, null);
scope = TL.tapSyncScope(segments, { trackId: 'a', region: { start: 1.5, end: 4.5 } });
assert.deepEqual(scope.items.map(item => item.id), ['s2']); assert.equal(scope.skipped, 1); assert.equal(scope.floor, 1); assert.equal(scope.after, 6);
assert.deepEqual(TL.tapSyncScope(segments, { trackId: 'a', fromId: 'nope' }).items, []);

// windows: a tap ends where the next one starts; the last tapped keeps its length; the offset is subtracted
const items = [{ id: 'a', start: 10, end: 12 }, { id: 'b', start: 13, end: 14 }, { id: 'c', start: 15, end: 16.5 }];
let out = TL.tapSyncWindows(items, [{ down: 10.5, up: 10.6 }, { down: 12.5, up: 12.6 }], { offset: .1, duration: 60 });
near(out[0].start, 10.4); near(out[0].end, 12.4); near(out[1].start, 12.4); near(out[1].end, 13.4 + 0 - 0 + 0);   // b keeps its 1 s
assert.equal(out.length, 2);
// a hold ends on release
out = TL.tapSyncWindows(items, [{ down: 10.5, up: 11.5 }, { down: 12.5, up: 12.6 }], { offset: .1, duration: 60 });
near(out[0].start, 10.4); near(out[0].end, 11.4); near(out[1].start, 12.4);
// a hold longer than the gap to the next tap is cut at the next start
out = TL.tapSyncWindows(items, [{ down: 10.5, up: 13.5 }, { down: 12.5, up: null }], { offset: 0, duration: 60 });
near(out[0].end, 12.5); near(out[1].start, 12.5);
// no overlap and a minimum length even for taps closer than 0.1 s; the next caption is pushed after it
out = TL.tapSyncWindows(items, [{ down: 10, up: null }, { down: 10.04, up: null }, { down: 10.05, up: null }], { offset: 0, duration: 60 });
for (let i = 0; i < out.length; i++) { assert.ok(out[i].end - out[i].start >= TL.MIN_SEGMENT - 1e-9); if (i) assert.ok(out[i].start >= out[i - 1].end - 1e-9); }
// floor: never before the previous caption's end; ceiling: the last tapped never runs into the first untapped caption
out = TL.tapSyncWindows(items, [{ down: 9, up: null }], { offset: 0, floor: 9.5, duration: 60 });
near(out[0].start, 9.5);
out = TL.tapSyncWindows(items, [{ down: 10, up: null }], { offset: 0, duration: 60 });
assert.ok(out[0].end <= 13 + 1e-9, 'stops at the start of the next untapped caption');
out = TL.tapSyncWindows([items[0]], [{ down: 59.5, up: null }], { offset: 0, duration: 60 });
near(out[0].start, 59.5); near(out[0].end, 60);
assert.deepEqual(TL.tapSyncWindows(items, [], {}), []);

// wiring: the session file, the key hook, the loop wrap bypass, the button and its localized copy
const src = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const sync = src('12bs_caption_sync.js'), transport = src('12br_caption_transport.js'), body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
assert.match(sync, /type: 'batch'/); assert.match(sync, /label: 'tap sync'/); assert.match(sync, /tapSyncWindows/); assert.match(sync, /localStorage/);
assert.match(transport, /W\.syncKey/); assert.match(transport, /!tr\.syncing/);
assert.match(body, /id="captionSync"/);
console.log('Caption tap sync tests passed.');
