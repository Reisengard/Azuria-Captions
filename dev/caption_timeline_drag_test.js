/* Rework plan T3: drag maths (snapping, move / trim resolution, refusals, nudge) and the drag wiring in the workbench source. */
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
const TL = J.captionTimeline, near = (a, b, note) => assert.ok(Math.abs(a - b) < 1e-6, `${note || ''} ${a} != ${b}`);

const seg = (id, start, end, trackId = 'main', extra = {}) => Object.assign({ id, start, end, trackId, firstWord: start + .1, lastWord: end - .1, block: false, locked: false, trackLocked: false }, extra);
const layout = () => ({ duration: 15, segments: [seg('a', 1, 2), seg('b', 3, 5), seg('c', 6, 7), seg('x', 2.5, 4, 'second')] });
const drag = (over) => TL.resolveDrag(Object.assign({ layout: layout(), mode: 'move', grab: 0, pps: 100, snap: false, targets: [] }, over));

// nearest snap: within 6 px only, closest pair wins, picks start or end of the dragged block
const targets = [{ time: 5, kind: 'playhead' }, { time: 8, kind: 'cut' }];
near(TL.nearestSnap([4.97], targets, 100).delta, .03); assert.equal(TL.nearestSnap([4.9], targets, 100), null);
near(TL.nearestSnap([6.5, 7.98], targets, 100).delta, .02); assert.equal(TL.nearestSnap([4.97], targets, 10).target.kind, 'playhead', 'the same gap snaps at a lower zoom');
assert.equal(TL.nearestSnap([4.97], [], 100), null);

// targets: both edges of the video, the playhead, loop, cuts, other captions (not the dragged one), word times
const list = TL.snapTargets({ duration: 15, playhead: 4, loop: { start: 1, end: 2 }, cuts: [9], segments: layout().segments, excludeId: 'b', wordTimes: [3.3] });
for (const kind of ['edge', 'playhead', 'loop', 'cut', 'caption', 'word']) assert.ok(list.some(item => item.kind === kind), kind);
assert.equal(list.filter(item => item.kind === 'caption').length, 6);

// move: shifts by the pointer, keeps the length, rounds to microseconds
{
  const r = drag({ segmentId: 'c', time: 8.02, grab: .02 });
  assert.ok(r.valid && r.changed); near(r.start, 8); near(r.end, 9); assert.equal(r.trackId, 'main'); assert.equal(r.snappedTo, null);
}
// move: a grab offset keeps the block under the pointer
{ const r = drag({ segmentId: 'c', time: 10, grab: .5 }); near(r.start, 9.5); near(r.end, 10.5); }
// move: stops edge to edge against a neighbour on the same track (no pushing, no jumping over)
{
  const r = drag({ segmentId: 'c', time: 4.0 }); assert.ok(r.valid); near(r.start, 5, 'stops at b'); assert.deepEqual(r.snappedTo, { time: 5, kind: 'caption' });
  const l = drag({ segmentId: 'a', time: 14 }); near(l.start, 2, 'stops at b?'); near(l.end, 3);
  const edge = drag({ segmentId: 'c', time: 99 }); near(edge.end, 15); assert.deepEqual(edge.snappedTo, { time: 15, kind: 'edge' });
  const start = drag({ segmentId: 'a', time: -4 }); near(start.start, 0); assert.deepEqual(start.snappedTo, { time: 0, kind: 'edge' });
}
// move: snaps the start or the end, whichever is closer; Alt (snap:false) turns it off
{
  const t = [{ time: 10, kind: 'playhead' }];
  const byEnd = drag({ segmentId: 'c', time: 8.97, snap: true, targets: t }); near(byEnd.end, 10); assert.equal(byEnd.snappedTo.kind, 'playhead');
  const byStart = drag({ segmentId: 'c', time: 10.03, snap: true, targets: t }); near(byStart.start, 10);
  const off = drag({ segmentId: 'c', time: 9.97, snap: false, targets: t }); near(off.end, 10.97); assert.equal(off.snappedTo, null);
}
// move to another track: free where it is free, refused where the space is taken (red ghost, no pushing)
{
  const free = drag({ segmentId: 'c', time: 6, trackId: 'second' }); assert.ok(free.valid && free.changed); assert.equal(free.trackId, 'second');
  const taken = drag({ segmentId: 'b', time: 3, trackId: 'second' }); assert.equal(taken.valid, false); assert.equal(taken.code, 'TRACK_SEGMENT_OVERLAP'); assert.equal(taken.otherSegmentId, 'x');
  const same = drag({ segmentId: 'c', time: 6 }); assert.equal(same.changed, false);
  const back = drag({ segmentId: 'x', time: 2.5, trackId: 'main' }); assert.equal(back.valid, false, 'x would overlap b on main');
}
// locks: a timing-locked caption never drags; a track lock only refuses a row change
{
  const locked = TL.resolveDrag({ layout: { duration: 15, segments: [seg('l', 1, 2, 'main', { locked: true })] }, segmentId: 'l', mode: 'move', time: 3, grab: 0, pps: 100 });
  assert.equal(locked.valid, false); assert.equal(locked.code, 'SEGMENT_FIELD_LOCKED');
  const lay = { duration: 15, segments: [seg('t', 1, 2, 'main', { trackLocked: true })] };
  assert.equal(TL.resolveDrag({ layout: lay, segmentId: 't', mode: 'move', time: 3, grab: 0, trackId: 'second', pps: 100 }).code, 'SEGMENT_FIELD_LOCKED');
  assert.ok(TL.resolveDrag({ layout: lay, segmentId: 't', mode: 'move', time: 3, grab: 0, pps: 100 }).valid);
}

// trim: moves one edge only; the other edge and the track stay
{
  const r = drag({ segmentId: 'b', mode: 'trim-end', time: 5.5 }); assert.ok(r.valid && r.changed); near(r.start, 3); near(r.end, 5.5); assert.equal(r.words, 'keep');
  const s = drag({ segmentId: 'b', mode: 'trim-start', time: 2.5 }); assert.ok(s.valid); near(s.start, 2.5); near(s.end, 5);
}
// trim: an edge stops at the word it would cut (a snap, not an error), at the neighbour, and at the 0.1 s minimum
{
  const word = drag({ segmentId: 'b', mode: 'trim-end', time: 3.2 }); near(word.end, 4.9, 'last word ends at 4.9'); assert.deepEqual(word.snappedTo, { time: 4.9, kind: 'word' });
  const startWord = drag({ segmentId: 'b', mode: 'trim-start', time: 4.5 }); near(startWord.start, 3.1); assert.equal(startWord.snappedTo.kind, 'word');
  const wall = drag({ segmentId: 'b', mode: 'trim-end', time: 6.5 }); near(wall.end, 6); assert.deepEqual(wall.snappedTo, { time: 6, kind: 'caption' });
  const wallStart = drag({ segmentId: 'b', mode: 'trim-start', time: 0 }); near(wallStart.start, 2); assert.deepEqual(wallStart.snappedTo, { time: 2, kind: 'caption' });
  const tail = drag({ segmentId: 'c', mode: 'trim-end', time: 99 }); near(tail.end, 15); assert.deepEqual(tail.snappedTo, { time: 15, kind: 'edge' });
  const head = drag({ segmentId: 'a', mode: 'trim-start', time: -3 }); near(head.start, 0);
  const tiny = TL.resolveDrag({ layout: { duration: 15, segments: [seg('s', 1, 1.5, 'main', { firstWord: NaN, lastWord: NaN })] }, segmentId: 's', mode: 'trim-end', time: 1.0, grab: 0, pps: 100 });
  near(tiny.end, 1.1, 'minimum length'); assert.ok(tiny.valid); assert.equal(tiny.snappedTo, null);
}
// trim with Shift fits the words: nothing stops at them; text blocks always re-spread so they are never stopped either
{
  const fit = drag({ segmentId: 'b', mode: 'trim-end', time: 3.2, shift: true }); assert.ok(fit.valid); near(fit.end, 3.2); assert.equal(fit.words, 'fit');
  const block = TL.resolveDrag({ layout: { duration: 15, segments: [seg('t', 1, 4, 'main', { block: true })] }, segmentId: 't', mode: 'trim-end', time: 1.5, grab: 0, pps: 100, shift: true });
  near(block.end, 1.5); assert.equal(block.words, 'keep', 'a block has no word-fit mode');
}
// trim snaps to targets, grab offset respected, and snapping never lets it cross a wall
{
  const r = drag({ segmentId: 'b', mode: 'trim-end', time: 5.57, grab: .02, snap: true, targets: [{ time: 5.6, kind: 'playhead' }] }); near(r.end, 5.6); assert.equal(r.snappedTo.kind, 'playhead');
  const past = drag({ segmentId: 'b', mode: 'trim-end', time: 5.99, snap: true, targets: [{ time: 6.04, kind: 'cut' }] }); near(past.end, 6, 'snap beyond the neighbour is clamped back');
}

// nudge: 0.05 s steps, stops at neighbours, refuses locked ones
{
  near(TL.nudge(layout(), 'c', 1).start, 6.05); near(TL.nudge(layout(), 'c', -1).start, 5.95);
  const wall = TL.nudge({ duration: 15, segments: [seg('p', 1, 2), seg('q', 2.02, 3)] }, 'q', -1); assert.equal(wall.changed, true); near(wall.start, 2, 'stops edge to edge');
  const stuck = TL.nudge({ duration: 15, segments: [seg('p', 1, 2), seg('q', 2, 3)] }, 'q', -1); assert.equal(stuck.changed, false);
  assert.equal(TL.nudge({ duration: 15, segments: [seg('p', 0, 1)] }, 'p', -1).changed, false, 'cannot go before 0');
  assert.equal(TL.nudge({ duration: 15, segments: [seg('p', 1, 2, 'main', { locked: true })] }, 'p', 1).code, 'SEGMENT_FIELD_LOCKED');
  assert.equal(TL.nudge(layout(), 'nope', 1), null);
}
// keys
const key = (k, extra = {}) => TL.keyAction(Object.assign({ code: k === ',' ? 'Comma' : 'Period', key: k }, extra));
assert.equal(key(','), 'nudge-back'); assert.equal(key('.'), 'nudge-forward'); assert.equal(key(',', { ctrlKey: true }), null);

// wiring: the view drags with a ghost / snap line / readout and sends move-segment / trim-segment; markup and copy exist
const src = name => fs.readFileSync(path.join(root, 'src', name), 'utf8');
const view = src('12bq_caption_timeline_view.js'), transport = src('12br_caption_transport.js'), body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app', 'style.css'), 'utf8'), english = fs.readFileSync(path.join(root, 'app', 'english.py'), 'utf8');
assert.match(view, /resolveDrag/); assert.match(view, /type: 'move-segment'/); assert.match(view, /type: 'trim-segment'/); assert.match(view, /setPointerCapture/); assert.match(view, /pointercancel/);
assert.match(view, /event\.key === 'Escape' && ui\.drag/); assert.match(view, /caption-lock-badge/); assert.match(view, /data-trim|dataset\.trim/);
assert.doesNotMatch(view.slice(view.indexOf('function finishSegmentDrag'), view.indexOf('function cancelSegmentDrag')), /store\.execute/, 'the view must go through runCommand');
assert.match(transport, /nudgeSegment/); assert.match(transport, /captionSnap/); assert.match(body, /id="captionSnap"/);
for (const selector of ['caption-drag-ghost', 'caption-drag-snap', 'caption-drag-readout', 'caption-trim-handle', 'caption-lock-badge']) assert.match(css, new RegExp(`\\.${selector}`));
assert.match(english, />Snap'/);
console.log('Caption timeline drag tests passed.');
