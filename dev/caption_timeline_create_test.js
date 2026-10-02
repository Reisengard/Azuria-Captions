/* Rework plan T5: create and multi-select. Pure model maths (free gaps, create range, marquee, group move), the store's duplicate-segment and
   batch moves / deletes (one undo step), the new keys, and the wiring in the workbench source. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({ measureText: text => ({ width: Array.from(String(text)).length * 57 }) }) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js' && name !== '12c_caption_workbench.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}
const TL = J.captionTimeline, near = (a, b, note) => assert.ok(Math.abs(a - b) < 1e-6, `${note || ''} ${a} != ${b}`);

/* ---- model ---- */
const seg = (id, start, end, trackId = 'main', extra = {}) => Object.assign({ id, start, end, trackId, firstWord: start, lastWord: end, block: false, locked: false, trackLocked: false }, extra);
const layout = () => ({ duration: 15, segments: [seg('a', 1, 2), seg('b', 3, 5), seg('c', 6, 7), seg('x', 2.5, 4, 'second')] });

// free gap: the empty stretch between neighbours; null inside a caption
assert.deepEqual(TL.freeGap(layout(), 'main', 2.5), { start: 2, end: 3 });
assert.deepEqual(TL.freeGap(layout(), 'main', .5), { start: 0, end: 1 });
assert.deepEqual(TL.freeGap(layout(), 'main', 10), { start: 7, end: 15 });
assert.equal(TL.freeGap(layout(), 'main', 4), null);
assert.deepEqual(TL.freeGap(layout(), 'main', 3), { start: 2, end: 3 }, 'a caption edge is not inside it');
assert.deepEqual(TL.freeGap(layout(), 'second', 1), { start: 0, end: 2.5 }, 'tracks are independent');
assert.deepEqual(TL.freeGap(layout(), 'main', 4, ['b']), { start: 2, end: 6 }, 'ignored ids do not block');

// new block at a point: up to 2 s, shortened to the free space, never inside a caption
assert.deepEqual(TL.newBlockRange(layout(), 'main', 8), { start: 8, end: 10, trackId: 'main' });
assert.deepEqual(TL.newBlockRange(layout(), 'main', 2.5), { start: 2.5, end: 3, trackId: 'main' });
assert.equal(TL.newBlockRange(layout(), 'main', 2.95), null, 'under 0.1 s of room');
assert.equal(TL.newBlockRange(layout(), 'main', 4), null);
assert.deepEqual(TL.newBlockRange(layout(), 'main', 14.5), { start: 14.5, end: 15, trackId: 'main' });

// create by dragging: stays inside the free gap around the start, either direction
const create = over => TL.createRange(Object.assign({ layout: layout(), trackId: 'main', a: 8, b: 9.5, pps: 100, snap: false, targets: [] }, over));
{
  const r = create({}); assert.ok(r.valid); near(r.start, 8); near(r.end, 9.5);
  const back = create({ b: 7.5 }); assert.ok(back.valid); near(back.start, 7.5); near(back.end, 8);
  const wall = create({ a: 2.2, b: 4.5 }); assert.ok(wall.valid); near(wall.start, 2.2); near(wall.end, 3, 'stops at the next caption');
  const left = create({ a: 2.8, b: .5 }); near(left.start, 2, 'stops at the previous caption'); near(left.end, 2.8);
  const end = create({ a: 14, b: 99 }); near(end.end, 15);
  const tiny = create({ b: 8.05 }); assert.ok(!tiny.valid); assert.equal(tiny.code, 'SEGMENT_TIMING_INVALID');
  const inside = create({ a: 4, b: 4.8 }); assert.ok(!inside.valid); assert.equal(inside.code, 'TRACK_SEGMENT_OVERLAP');
  const snapped = create({ b: 9.97, snap: true, targets: [{ time: 10, kind: 'playhead' }] }); near(snapped.end, 10); assert.deepEqual(snapped.snappedTo, { time: 10, kind: 'playhead' });
  const off = create({ b: 9.97, snap: false, targets: [{ time: 10, kind: 'playhead' }] }); near(off.end, 9.97); assert.equal(off.snappedTo, null);
}

// marquee: rectangles that meet the box, in any drag direction
{
  const rects = [{ id: 'a', left: 10, top: 0, right: 50, bottom: 28 }, { id: 'b', left: 60, top: 0, right: 100, bottom: 28 }, { id: 'x', left: 60, top: 32, right: 100, bottom: 60 }];
  assert.deepEqual(TL.marqueeHits(rects, { left: 40, top: 5, right: 70, bottom: 20 }), ['a', 'b']);
  assert.deepEqual(TL.marqueeHits(rects, { left: 70, top: 50, right: 20, bottom: 10 }), ['a', 'b', 'x'], 'dragging up and left works too');
  assert.deepEqual(TL.marqueeHits(rects, { left: 51, top: 5, right: 59, bottom: 20 }), [], 'the gap between captions selects nothing');
}

// group move: one shift for all, clamped by the video edges and by captions that are not in the group
const group = over => TL.resolveGroupMove(Object.assign({ layout: layout(), ids: ['b', 'c'], delta: 1, pps: 100, snap: false, targets: [] }, over));
{
  const r = group({}); assert.ok(r.valid && r.changed); near(r.delta, 1);
  assert.deepEqual(r.moves.map(move => [move.id, move.start, move.end]), [['b', 4, 6], ['c', 7, 8]]);
  near(group({ delta: 99 }).delta, 8, 'stops at the end of the video (c ends at 15)');
  near(group({ delta: -99 }).delta, -1, 'b may go back to the end of a (2): -1');
  near(group({ ids: ['a', 'b'], delta: -99 }).delta, -1, 'the left edge of the video limits a');
  near(group({ ids: ['a', 'b'], delta: 99 }).delta, 1, 'b stops at c (6): 5 -> 6');
  assert.equal(group({ ids: ['b', 'x'], delta: 99 }).moves.length, 2, 'members on other tracks move too');
  const stuck = group({ ids: ['a', 'c'], delta: 5 }); near(stuck.delta, 1, 'a runs into b first');
  const locked = TL.resolveGroupMove({ layout: Object.assign(layout(), { segments: layout().segments.map(item => item.id === 'c' ? Object.assign(item, { locked: true }) : item) }), ids: ['b', 'c'], delta: 1, pps: 100, snap: false });
  assert.ok(!locked.valid); assert.equal(locked.code, 'SEGMENT_FIELD_LOCKED');
  const snap = group({ delta: .97, snap: true, targets: [{ time: 8, kind: 'playhead' }] });
  near(snap.delta, 1, 'snaps to the playhead (c ends at 8)'); assert.equal(snap.snappedTo.kind, 'playhead');
  assert.equal(TL.snapTargets({ duration: 15, segments: layout().segments, excludeId: ['b', 'c'] }).filter(target => target.kind === 'caption').length, 4, 'a whole group is left out of the snap targets');
  assert.ok(!group({ ids: ['nope'] }).valid);
}
// batches apply last-first when moving right (first-first when moving left) so members never run over each other
assert.deepEqual(TL.groupMoveOrder([{ id: 'b', start: 4 }, { id: 'c', start: 7 }], 1).map(move => move.id), ['c', 'b']);
assert.deepEqual(TL.groupMoveOrder([{ id: 'b', start: 3 }, { id: 'c', start: 6 }], -1).map(move => move.id), ['b', 'c']);

// keys
const key = (code, extra) => TL.keyAction(Object.assign({ code, key: code }, extra));
assert.equal(key('KeyN'), 'new'); assert.equal(key('KeyS'), 'split'); assert.equal(key('Delete'), 'delete'); assert.equal(key('Backspace'), 'delete');
assert.equal(key('KeyN', { ctrlKey: true }), null, 'Ctrl+N is the browser\'s'); assert.equal(key('KeyS', { ctrlKey: true }), null); assert.equal(key('KeyS', { shiftKey: true }), null);

/* ---- store ---- */
const clone = value => JSON.parse(JSON.stringify(value));
const AT = '2026-09-28T00:00:00.000Z';
const transcript = J.importWordJson(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8'), { duration: 15 });
const base = (() => {
  const project = { schemaVersion: 3, generatorVersion: 'test', mode: 'video-captions', id: 'create', media: { duration: 15, width: 1080, height: 1920 },
    transcript: clone(transcript), segments: [], plans: {}, safeZones: [], guides: [], seed: 3107, style: { preset: 'creator' }, settings: {}, createdAt: AT, updatedAt: AT };
  project.tracks = [J.defaultCaptionTrack(project)];
  const planned = J.planCaptions(project, project.media); project.segments = planned.segments; project.plans = planned.plans;
  return J.loadProject(clone(project));
})();
const storeOf = () => new J.CaptionStore(clone(base));
const run = (store, command) => store.execute(Object.assign({ updatedAt: AT }, command));
const code = fn => { try { fn(); } catch (error) { return error.code; } return null; };
const exact = (store, fn) => {
  const before = store.snapshot(); fn(); const after = store.snapshot();
  assert.ok(store.undo()); assert.deepStrictEqual(store.snapshot(), before, 'undo must restore the project exactly');
  assert.ok(store.redo()); assert.deepStrictEqual(store.snapshot(), after, 'redo must reproduce the result exactly');
};
const textOf = (store, segment) => segment.tokenIds.map(id => store.project.transcript.tokens.find(token => token.id === id).text).join(' ');

// duplicate: a typed copy in the first free gap after the original (shortened when the gap is shorter), new ids, own undo step
{
  const store = storeOf(), first = store.project.segments[0], count = store.project.segments.length, depth = store.undoStack.length;
  exact(store, () => run(store, { type: 'duplicate-segment', segmentId: first.id }));
  assert.equal(store.project.segments.length, count + 1); assert.equal(store.undoStack.length, depth + 1);
  const copy = store.project.segments.find(item => !base.segments.some(old => old.id === item.id));
  assert.equal(textOf(store, copy), textOf(store, first), 'same text'); assert.ok(J.isCaptionTextBlock(store.project, copy), 'a copy is a typed block');
  near(copy.start, first.end, 'starts where the original ends (the gap after it is 1.15 s)'); near(copy.end, 3.4, 'shortened to the gap: the original is 1.85 s, the next caption starts at 3.4');
  assert.ok(copy.tokenIds.every(id => !first.tokenIds.includes(id)), 'new word ids');
  assert.deepEqual(J.captionTrackOverlaps(store.project), [], 'the copy lands in free space');
  assert.ok(store.project.segments.every((item, i, all) => !i || all[i - 1].start <= item.start + 1e-9), 'segments stay in time order');
  // a gap that fits keeps the full length
  const roomy = storeOf(), s2 = roomy.project.segments[1]; run(roomy, { type: 'duplicate-segment', segmentId: s2.id });
  const full = roomy.project.segments.find(item => !base.segments.some(old => old.id === item.id)); near(full.end - full.start, s2.end - s2.start, 'full length when it fits'); near(full.start, s2.end);
}
// duplicate: another track copies in place; no room after the original refuses
{
  const store = storeOf(), s1 = store.project.segments[0];
  run(store, { type: 'add-track' }); const second = store.project.tracks[1].id;
  run(store, { type: 'duplicate-segment', segmentId: s1.id, trackId: second });
  const copy = store.project.segments.find(item => item.trackId === second); assert.ok(copy); near(copy.start, s1.start, 'same time on the other track'); near(copy.end, s1.end);
  const tight = storeOf(), last = tight.project.segments[tight.project.segments.length - 1];
  run(tight, { type: 'trim-segment', segmentId: last.id, end: 15, words: 'fit' });
  assert.equal(code(() => run(tight, { type: 'duplicate-segment', segmentId: last.id })), 'TRACK_SEGMENT_OVERLAP', 'no room after the last caption');
  assert.equal(code(() => run(tight, { type: 'duplicate-segment', segmentId: 'nope' })), 'SEGMENT_NOT_FOUND');
}
// group move as one batch: all members shift, one undo step, a refusal leaves everything as it was
{
  const store = storeOf(), ids = store.project.segments.slice(0, 3).map(item => item.id), before = store.project.segments.map(item => [item.id, item.start, item.end]);
  const members = store.project.segments.filter(item => ids.includes(item.id)), delta = .2;
  exact(store, () => run(store, { type: 'batch', commands: TL.groupMoveOrder(members.map(item => ({ id: item.id, start: item.start + delta, end: item.end + delta })), delta).map(move => ({ type: 'move-segment', segmentId: move.id, start: move.start })) }));
  for (const [id, start] of before.filter(entry => ids.includes(entry[0]))) near(store.project.segments.find(item => item.id === id).start, start + delta, `${id} moved`);
  assert.equal(store.undoStack.length, 1, 'the whole group is one undo step');
  const back = storeOf(), snapshot = back.serialize(), [a, b] = back.project.segments;
  assert.equal(code(() => run(back, { type: 'batch', commands: [{ type: 'move-segment', segmentId: b.id, start: b.start - 5 }, { type: 'move-segment', segmentId: a.id, start: a.start + .1 }] })) !== null, true);
  assert.equal(back.serialize(), snapshot, 'a failing member rolls the whole batch back');
}
// batch delete and split at a time
{
  const store = storeOf(), ids = store.project.segments.slice(0, 2).map(item => item.id), count = store.project.segments.length;
  exact(store, () => run(store, { type: 'batch', commands: ids.map(segmentId => ({ type: 'delete-segment', segmentId })) }));
  assert.equal(store.project.segments.length, count - 2); assert.ok(ids.every(id => !store.project.segments.some(item => item.id === id)));
  assert.equal(store.undoStack.length, 1);
  const split = storeOf(), target = split.project.segments.find(item => item.tokenIds.length > 1), mid = (target.start + target.end) / 2;
  exact(split, () => run(split, { type: 'split-segment', segmentId: target.id, time: mid, newSegmentId: split.nextSegmentId(), boundarySource: 'manual' }));
  assert.equal(split.project.segments.length, base.segments.length + 1);
}

/* ---- wiring in the workbench source ---- */
const src = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const view = src('12bq_caption_timeline_view.js'), transport = src('12br_caption_transport.js'), edit = src('12bt_caption_edit.js');
const css = fs.readFileSync(path.join(root, 'app', 'style.css'), 'utf8'), english = fs.readFileSync(path.join(root, 'app', 'english.py'), 'utf8');
assert.match(view, /function startEmptyGesture/); assert.match(view, /TL\.createRange\(/); assert.match(view, /TL\.marqueeHits\(/); assert.match(view, /type: 'create-text-block'/);
assert.match(view, /addEventListener\('contextmenu', openCaptionMenu\)/); assert.match(view, /addEventListener\('dblclick'[\s\S]{0,200}TL\.newBlockRange/);
assert.match(view, /shiftKey \|\| event\.ctrlKey \|\| event\.metaKey\)\) \{ W\.toggleSelect/, 'shift / ctrl click toggles');
assert.match(view, /type: 'batch'[^}]*label: 'move captions'/); assert.match(view, /type: 'duplicate-segment'/); assert.match(view, /type: 'delete-segment'/); assert.match(view, /type: 'split-segment', segmentId: segment\.id, time:/);
assert.match(view, /swallowClick/, 'the click after a drag must not collapse the selection');
assert.match(view, /ui\.gesture && cancelGesture\(\)/, 'Esc cancels a create / marquee drag'); assert.match(view, /cancelGesture\(\); \}\);/, 'pointercancel too');
assert.match(transport, /case 'new': return W\.newCaptionAtPlayhead/); assert.match(transport, /case 'split': return W\.splitAtPlayhead/); assert.match(transport, /case 'delete': return W\.deleteSelected/);
assert.match(edit, /captionEditText'\)\.addEventListener\('keydown'/, 'Enter commits a freshly typed block');
assert.match(css, /\.caption-marquee/); assert.match(css, /is-marquee-hit/);
for (const text of ['再生ヘッドで分割', '前の字幕と結合', '次の字幕と結合', '新しい字幕']) assert.ok(english.includes(`'${text}'`), `${text} has an English entry`);

console.log('caption_timeline_create_test: ok');
