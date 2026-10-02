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

// words (C5): taps mark word starts, the last word of the caption runs to the caption end, offset subtracted, holds end on release
const words = [{ id: 'w1', start: 1, end: 1.4 }, { id: 'w2', start: 1.4, end: 1.8 }, { id: 'w3', start: 1.8, end: 2 }];
let wt = TL.wordSyncTimes(words, [{ down: 1.1, up: 1.15 }, { down: 1.6, up: 1.65 }, { down: 1.9, up: 1.95 }], { offset: .1, start: 1, end: 2.5 });
assert.equal(wt.length, 3); near(wt[0].start, 1); near(wt[0].end, 1.5); near(wt[1].start, 1.5); near(wt[1].end, 1.8); near(wt[2].start, 1.8); near(wt[2].end, 2.5);
wt = TL.wordSyncTimes(words, [{ down: 1.2, up: 1.5 }, { down: 1.7, up: null }], { offset: 0, start: 1, end: 2.5 });   // hold on word 1 ends on release; the last tapped keeps its length, capped by the untapped word
near(wt[0].end, 1.5); near(wt[1].start, 1.7); assert.ok(wt[1].end <= 1.8 + 1e-9 || wt[1].end - wt[1].start <= TL.MIN_WORD + 1e-9);
wt = TL.wordSyncTimes(words, [{ down: .5, up: null }, { down: .6, up: null }, { down: .61, up: null }], { offset: 0, start: 1, end: 2 });   // before the caption, crowded: clamped, ordered, minimum length
for (let i = 0; i < wt.length; i++) { assert.ok(wt[i].start >= 1 - 1e-9 && wt[i].end <= 2 + 1e-9); assert.ok(wt[i].end - wt[i].start >= TL.MIN_WORD - 1e-9); if (i) assert.ok(wt[i].start >= wt[i - 1].end - 1e-9); }
wt = TL.wordSyncTimes(words, [{ down: 9, up: null }, { down: 9, up: null }, { down: 9, up: null }], { offset: 0, start: 1, end: 2 });   // after the caption: still inside it
assert.ok(wt.every(item => item.end <= 2 + 1e-9 && item.start < item.end));
assert.deepEqual(TL.wordSyncTimes(words, [], {}), []);

// wiring: the session file, the key hook, the loop wrap bypass, the button and its localized copy
const src = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const sync = src('12bs_caption_sync.js'), transport = src('12br_caption_transport.js'), body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
assert.match(sync, /type: 'batch'/); assert.match(sync, /label: 'tap sync'/); assert.match(sync, /tapSyncWindows/); assert.match(sync, /localStorage/);
assert.match(transport, /W\.syncKey/); assert.match(transport, /!tr\.syncing/);
assert.match(body, /id="captionSync"/); assert.match(body, /id="captionSyncWords"/); assert.match(sync, /type: 'retime-tokens'/); assert.match(sync, /wordSyncTimes/);
// C6 paste a script: lines, span, even windows
assert.deepEqual(TL.scriptLines('  one '+String.fromCharCode(10,10)+' two'+String.fromCharCode(13,10)+'   '+String.fromCharCode(10)+'three'+String.fromCharCode(13)+'four'), ['one', 'two', 'three', 'four']); assert.deepEqual(TL.scriptLines(''), []); assert.deepEqual(TL.scriptLines(null), []);
const layout = { duration: 20, segments: [{ id: 'a', trackId: 't', start: 12, end: 14 }, { id: 'b', trackId: 't', start: 2, end: 3 }, { id: 'o', trackId: 'u', start: 5, end: 6 }] };
assert.deepEqual(TL.scriptSpan(layout, 't', 4, null), { start: 4, end: 12, trackId: 't' });          // up to the next caption on that track
assert.deepEqual(TL.scriptSpan(layout, 'u', 4, null), { start: 4, end: 5, trackId: 'u' });
assert.deepEqual(TL.scriptSpan(layout, 't', 15, null), { start: 15, end: 20, trackId: 't' });
assert.deepEqual(TL.scriptSpan(layout, 't', 15, { start: 16, end: 18 }), { start: 16, end: 18, trackId: 't' });   // a marked range wins
assert.equal(TL.scriptSpan(layout, 't', 2.5, null), null);                                           // inside a caption
let script = TL.scriptRanges(['a', 'b', 'c', 'd'], { start: 4, end: 12 });
assert.ok(script.ok); assert.deepEqual(script.ranges.map(item => [item.start, item.end]), [[4, 6], [6, 8], [8, 10], [10, 12]]);
script = TL.scriptRanges(['a', 'b', 'c'], { start: 0, end: 1 }); assert.ok(script.ok); near(script.ranges[2].end, 1); near(script.ranges[0].start, 0);
assert.equal(TL.scriptRanges(['a', 'b'], { start: 0, end: .15 }).code, 'SCRIPT_NO_ROOM'); assert.equal(TL.scriptRanges(['a'], null).code, 'SCRIPT_NO_ROOM');
assert.equal(TL.scriptRanges([], { start: 0, end: 5 }).code, 'SCRIPT_EMPTY'); assert.equal(TL.scriptRanges(new Array(TL.SCRIPT_MAX_LINES + 1).fill('x'), { start: 0, end: 500 }).code, 'SCRIPT_TOO_LONG');
const edit = src('12bt_caption_edit.js');
assert.match(edit, /label: 'paste script'/); assert.match(edit, /pasteScript/); assert.match(body, /id="captionScriptAdd"/); assert.match(body, /id="captionScriptText"/);
console.log('Caption tap sync tests passed.');
