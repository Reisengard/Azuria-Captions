/* Rework plan E1: timing rules in the store and the new commands
   (move / trim / split by time / delete / edit text / retime tokens / batch). ADR 0010. */
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
const clone = value => JSON.parse(JSON.stringify(value));
const transcript = J.importWordJson(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8'), { duration: 15 });
const code = fn => { try { fn(); } catch (error) { return error.code; } return null; };
const MAIN = J.CAPTION_PRIMARY_TRACK_ID, AT = '2026-09-28T00:00:00.000Z';

const base = (() => {
  const project = { schemaVersion: 3, generatorVersion: 'test', mode: 'video-captions', id: 'timing', media: { duration: 15, width: 1080, height: 1920 },
    transcript: clone(transcript), segments: [], plans: {}, safeZones: [], guides: [], seed: 3107, style: { preset: 'creator' }, settings: {}, createdAt: AT, updatedAt: AT };
  project.tracks = [J.defaultCaptionTrack(project)];
  const planned = J.planCaptions(project, project.media);
  project.segments = planned.segments; project.plans = planned.plans;
  return J.loadProject(clone(project));
})();
const storeOf = () => new J.CaptionStore(clone(base));
const run = (store, command) => store.execute(Object.assign({ updatedAt: AT }, command));
const exact = (store, fn) => {
  const before = store.snapshot(); fn(); const after = store.snapshot();
  assert.ok(store.undo()); assert.deepStrictEqual(store.snapshot(), before, 'undo must restore the project exactly');
  assert.ok(store.redo()); assert.deepStrictEqual(store.snapshot(), after, 'redo must reproduce the result exactly');
};
const refused = (store, command, expected) => {
  const before = store.serialize(), depth = store.undoStack.length;
  assert.equal(code(() => run(store, command)), expected, `${command.type} should be refused with ${expected}`);
  assert.equal(store.serialize(), before, `${expected} must leave the project untouched`); assert.equal(store.undoStack.length, depth, 'a refusal is not an undo step');
};
const seg = (store, id) => store.project.segments.find(segment => segment.id === id);
const tok = (store, id) => store.project.transcript.tokens.find(token => token.id === id);
const wordsOf = (store, id) => seg(store, id).tokenIds.map(tokenId => tok(store, tokenId));
const planJson = (store, ids) => JSON.stringify(ids.map(id => store.project.plans[id]));
const others = (store, except) => store.project.segments.map(segment => segment.id).filter(id => !except.includes(id));
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`);

/* ---- captionSegmentFits ---- */
{
  const store = storeOf(), project = store.project, s2 = seg(store, 'segment_000002');
  assert.deepStrictEqual(J.captionSegmentFits(project, s2, 3.4, 4.7, MAIN), { ok: true });
  assert.equal(J.captionSegmentFits(project, s2, 3.4, 3.45, MAIN, { fit: true }).code, 'SEGMENT_TIMING_INVALID', 'minimum length 0.1 s');
  assert.equal(J.captionSegmentFits(project, s2, 3.4, 15.5, MAIN, { fit: true }).code, 'SEGMENT_TIMING_INVALID', 'inside the video');
  assert.equal(J.captionSegmentFits(project, s2, -0.5, 4.7, MAIN).code, 'SEGMENT_TIMING_INVALID');
  const overlap = J.captionSegmentFits(project, s2, 2.0, 4.7, MAIN);
  assert.equal(overlap.code, 'TRACK_SEGMENT_OVERLAP'); assert.equal(overlap.otherSegmentId, 'segment_000001');
  assert.deepStrictEqual(J.captionSegmentFits(project, s2, 2.25, 4.7, MAIN), { ok: true }, 'touching is not overlapping');
  assert.equal(J.captionSegmentFits(project, s2, 3.5, 4.7, MAIN).code, 'SEGMENT_WORDS_OUTSIDE', 'the window must contain its words');
  assert.deepStrictEqual(J.captionSegmentFits(project, s2, 3.5, 4.7, MAIN, { fit: true }), { ok: true }, 'fit mode re-times the words');
  assert.deepStrictEqual(J.captionTrackOverlaps(project), [], 'a clean project has no overlap warnings');
}

/* ---- move-segment ---- */
{
  const store = storeOf(), others2 = others(store, ['segment_000002']);
  const plansBefore = planJson(store, others2), plan2 = JSON.stringify(store.project.plans.segment_000002);
  exact(store, () => run(store, { type: 'move-segment', segmentId: 'segment_000002', start: 4.4 }));
  const moved = seg(store, 'segment_000002'), after = wordsOf(store, 'segment_000002');
  near(moved.start, 4.4, 'start'); near(moved.end, 5.7, 'end keeps the length'); assert.equal(moved.boundarySource, 'manual');
  near(after[0].start, 4.4, 'first word moved with the caption'); near(after[3].end, 5.7, 'last word moved with the caption');
  near(after[1].start - after[0].start, 3.72 - 3.40, 'word spacing is unchanged'); assert.equal(after[0].timingQuality, 'word', 'a move does not downgrade timing quality');
  assert.equal(planJson(store, others2), plansBefore, 'other captions\' plans are byte-identical');
  assert.equal(JSON.stringify(store.project.plans.segment_000002), plan2, 'a pure time shift keeps the plan');
  assert.deepStrictEqual(store.project.segments.map(segment => segment.id), ['segment_000001', 'segment_000002', 'segment_000003', 'segment_000004', 'segment_000005', 'segment_000006']);
  assert.ok(store.project.transcript.tokens.every((token, i, all) => i === 0 || all[i - 1].start <= token.start), 'transcript stays ordered');

  refused(store, { type: 'move-segment', segmentId: 'segment_000002', start: 6.0 }, 'TRACK_SEGMENT_OVERLAP');   // runs into segment_000003 (6.10)
  refused(store, { type: 'move-segment', segmentId: 'segment_000001', start: -0.1 }, 'SEGMENT_TIMING_INVALID');
  refused(store, { type: 'move-segment', segmentId: 'segment_000006', start: 14.0 }, 'SEGMENT_TIMING_INVALID');   // past the end of the video
  refused(store, { type: 'move-segment', segmentId: 'segment_000001', start: 0.4 }, 'SEGMENT_MOVE_NOOP');
  refused(store, { type: 'move-segment', segmentId: 'nope', start: 1 }, 'SEGMENT_NOT_FOUND');
  refused(store, { type: 'move-segment', segmentId: 'segment_000001', start: 'x' }, 'SEGMENT_TIMING_INVALID');

  run(store, { type: 'set-field-lock', segmentId: 'segment_000004', field: 'timing' });
  refused(store, { type: 'move-segment', segmentId: 'segment_000004', start: 9.5 }, 'SEGMENT_FIELD_LOCKED');
}

/* ---- move-segment onto another track (spoken words may overlap across tracks) ---- */
{
  const store = storeOf();
  run(store, { type: 'add-track', trackId: 'track_2' });
  run(store, { type: 'create-text-block', segmentId: 'note', trackId: 'track_2', text: 'a note', start: 8.0, end: 9.0 });
  const rest = others(store, ['segment_000002']);
  const plansBefore = planJson(store, rest);
  exact(store, () => run(store, { type: 'move-segment', segmentId: 'segment_000002', start: 6.2, trackId: 'track_2' }));
  assert.equal(seg(store, 'segment_000002').trackId, 'track_2');
  assert.equal(store.project.plans.segment_000002.trackId, 'track_2', 'plan follows the caption');
  assert.equal(planJson(store, rest), plansBefore, 'only the moved caption is re-planned');
  // its words now overlap segment_000003's words in time (3: 6.10-7.72) — allowed because they are on different tracks
  near(wordsOf(store, 'segment_000002')[0].start, 6.2, 'words moved');
  J.validateProject(store.project);
  assert.deepStrictEqual(J.captionTrackOverlaps(store.project), [], 'different tracks never warn');
  // same track overlap is refused
  refused(store, { type: 'move-segment', segmentId: 'segment_000003', start: 8.3, trackId: 'track_2' }, 'TRACK_SEGMENT_OVERLAP');
  // a pure track change (same time)
  const solo = storeOf(); run(solo, { type: 'add-track', trackId: 'track_2' });
  exact(solo, () => run(solo, { type: 'move-segment', segmentId: 'segment_000004', start: 9.1, trackId: 'track_2' }));
  assert.equal(seg(solo, 'segment_000004').trackId, 'track_2'); near(seg(solo, 'segment_000004').start, 9.1, 'time unchanged');
  run(solo, { type: 'set-field-lock', segmentId: 'segment_000005', field: 'trackAssignment' });
  refused(solo, { type: 'move-segment', segmentId: 'segment_000005', start: 11.5, trackId: 'track_2' }, 'SEGMENT_FIELD_LOCKED');
  refused(solo, { type: 'move-segment', segmentId: 'segment_000005', start: 11.5, trackId: 'track_9' }, 'TRACK_NOT_FOUND');
}

/* ---- move-segment on a typed block ---- */
{
  const store = storeOf();
  run(store, { type: 'create-text-block', segmentId: 'title', text: 'Chapter one', start: 2.4, end: 3.3 });
  exact(store, () => run(store, { type: 'move-segment', segmentId: 'title', start: 2.5 }));
  near(seg(store, 'title').start, 2.5, 'block start'); near(seg(store, 'title').end, 3.4, 'block end');
  near(wordsOf(store, 'title')[0].start, 2.5, 'block words follow');
  refused(store, { type: 'move-segment', segmentId: 'title', start: 3.0 }, 'TRACK_SEGMENT_OVERLAP');   // onto segment_000002 (3.40)
}

/* ---- trim-segment ---- */
{
  const store = storeOf(), rest = others(store, ['segment_000002']), plansBefore = planJson(store, rest);
  exact(store, () => run(store, { type: 'trim-segment', segmentId: 'segment_000002', start: 3.0, end: 5.0 }));
  near(seg(store, 'segment_000002').start, 3.0, 'start'); near(seg(store, 'segment_000002').end, 5.0, 'end');
  near(wordsOf(store, 'segment_000002')[0].start, 3.4, 'words keep their times'); assert.equal(planJson(store, rest), plansBefore);
  refused(store, { type: 'trim-segment', segmentId: 'segment_000002', start: 3.5 }, 'SEGMENT_WORDS_OUTSIDE');
  refused(store, { type: 'trim-segment', segmentId: 'segment_000002', end: 4.5 }, 'SEGMENT_WORDS_OUTSIDE');
  refused(store, { type: 'trim-segment', segmentId: 'segment_000002', start: 2.0 }, 'TRACK_SEGMENT_OVERLAP');
  refused(store, { type: 'trim-segment', segmentId: 'segment_000002', end: 6.5 }, 'TRACK_SEGMENT_OVERLAP');
  refused(store, { type: 'trim-segment', segmentId: 'segment_000002', start: 5.0 }, 'SEGMENT_TIMING_INVALID');
  refused(store, { type: 'trim-segment', segmentId: 'segment_000002' }, 'SEGMENT_TRIM_EMPTY');
  refused(store, { type: 'trim-segment', segmentId: 'segment_000002', start: 3.0, words: 'stretch' }, 'SEGMENT_TRIM_MODE_INVALID');

  // fit: words are scaled into the new window
  const fit = storeOf(); const before = wordsOf(fit, 'segment_000004').map(token => ({ s: token.start, e: token.end }));
  exact(fit, () => run(fit, { type: 'trim-segment', segmentId: 'segment_000004', start: 9.5, end: 10.0, words: 'fit' }));
  const fitted = wordsOf(fit, 'segment_000004');
  near(seg(fit, 'segment_000004').start, 9.5, 'fit start'); near(fitted[0].start, 9.5, 'first word at the new start'); near(fitted[1].end, 10.0, 'last word at the new end');
  assert.ok(fitted.every(token => token.timingQuality === 'estimated'), 'fitted words are estimated');
  assert.ok(fitted[0].end <= fitted[1].start + 1e-9, 'fitted words stay in order');
  assert.notDeepEqual(before, fitted.map(token => ({ s: token.start, e: token.end })));
  // fit still respects neighbours
  refused(fit, { type: 'trim-segment', segmentId: 'segment_000004', start: 7.0, words: 'fit' }, 'TRACK_SEGMENT_OVERLAP');

  // the old command stays an alias with the same rules
  const alias = storeOf();
  exact(alias, () => run(alias, { type: 'set-segment-timing', segmentId: 'segment_000002', start: 3.2, end: 4.9, boundarySource: 'manual' }));
  refused(alias, { type: 'set-segment-timing', segmentId: 'segment_000002', start: 3.5 }, 'SEGMENT_WORDS_OUTSIDE');
  refused(alias, { type: 'set-segment-timing', segmentId: 'segment_000002', end: 7 }, 'TRACK_SEGMENT_OVERLAP');
  run(alias, { type: 'set-field-lock', segmentId: 'segment_000003', field: 'end' });
  refused(alias, { type: 'trim-segment', segmentId: 'segment_000003', end: 8.0 }, 'SEGMENT_FIELD_LOCKED');

  // typed block: always re-spread
  const blockStore = storeOf(); run(blockStore, { type: 'create-text-block', segmentId: 'b', text: 'one two', start: 2.4, end: 3.0 });
  exact(blockStore, () => run(blockStore, { type: 'trim-segment', segmentId: 'b', end: 3.3 }));
  near(wordsOf(blockStore, 'b')[1].end, 3.3, 'block words re-spread');
  refused(blockStore, { type: 'trim-segment', segmentId: 'b', end: 3.5 }, 'TRACK_SEGMENT_OVERLAP');
}

/* ---- split-segment by time ---- */
{
  const store = storeOf(), rest = others(store, ['segment_000001']), plansBefore = planJson(store, rest);
  // 1.04 -> 1.08 is the gap between "we" and "made"; 1.06 sits in it
  exact(store, () => run(store, { type: 'split-segment', segmentId: 'segment_000001', time: 1.06, newSegmentId: 'right' }));
  const left = seg(store, 'segment_000001'), right = seg(store, 'right');
  assert.equal(left.tokenIds.length, 2); assert.equal(right.tokenIds.length, 3);
  near(left.end, 1.06, 'split at the playhead'); near(right.start, 1.06, 'right half starts there'); near(right.end, 2.25, 'right half keeps the old end');
  assert.equal(planJson(store, rest), plansBefore);
  // inside a word -> nearest gap (middle of "made" 1.08-1.34, nearer to the 'made|42%' gap at 1.34-1.39)
  const inside = storeOf(); run(inside, { type: 'split-segment', segmentId: 'segment_000001', time: 1.30, newSegmentId: 'r2' });
  assert.equal(seg(inside, 'segment_000001').tokenIds.length, 3); const gap = seg(inside, 'segment_000001').end;
  assert.ok(gap >= 1.34 - 1e-9 && gap <= 1.39 + 1e-9, 'the split falls between the words');
  refused(store, { type: 'split-segment', segmentId: 'segment_000002', time: 3.0 }, 'SEGMENT_SPLIT_INVALID');   // before the caption
  refused(store, { type: 'split-segment', segmentId: 'segment_000002', time: 4.7 }, 'SEGMENT_SPLIT_INVALID');   // at its end
  // locked segmentation refuses
  run(store, { type: 'set-segment-lock', segmentId: 'segment_000002', lock: 'segmentation' });
  refused(store, { type: 'split-segment', segmentId: 'segment_000002', time: 4.0 }, 'SEGMENT_FIELD_LOCKED');
  // the original index / token form still works
  run(store, { type: 'split-segment', segmentId: 'segment_000005', beforeTokenId: wordsOf(store, 'segment_000005')[1].id, newSegmentId: 'old-form' });
  assert.equal(seg(store, 'old-form').tokenIds.length, 2);

  // a typed block can be split; each half is re-spread in its own window
  const typed = storeOf(); run(typed, { type: 'create-text-block', segmentId: 'blk', text: 'a b c d', start: 7.8, end: 9.0 });
  exact(typed, () => run(typed, { type: 'split-segment', segmentId: 'blk', time: 8.4, newSegmentId: 'blk2' }));
  assert.equal(seg(typed, 'blk').tokenIds.length, 2); assert.equal(seg(typed, 'blk2').tokenIds.length, 2);
  near(seg(typed, 'blk').end, 8.4, 'block left end'); near(wordsOf(typed, 'blk')[1].end, 8.4, 'left words re-spread'); near(wordsOf(typed, 'blk2')[0].start, 8.4, 'right words re-spread'); near(wordsOf(typed, 'blk2')[1].end, 9.0, 'right words end');
  assert.ok(J.isCaptionTextBlock(typed.project, seg(typed, 'blk2')));
  refused(typed, { type: 'split-segment', segmentId: 'blk', time: 7.85 }, 'SEGMENT_TIMING_INVALID');
}

/* ---- delete-segment ---- */
{
  const store = storeOf(), count = store.project.transcript.tokens.length, n = seg(store, 'segment_000003').tokenIds.length, rest = others(store, ['segment_000003']);
  const plansBefore = planJson(store, rest);
  exact(store, () => run(store, { type: 'delete-segment', segmentId: 'segment_000003' }));
  assert.equal(seg(store, 'segment_000003'), undefined); assert.equal(store.project.plans.segment_000003, undefined);
  assert.equal(store.project.transcript.tokens.length, count - n, 'its words leave the transcript');
  assert.equal(planJson(store, rest), plansBefore);
  refused(store, { type: 'delete-segment', segmentId: 'segment_000003' }, 'SEGMENT_NOT_FOUND');
  // the text-block command keeps refusing speech
  refused(store, { type: 'delete-text-block', segmentId: 'segment_000001' }, 'SEGMENT_NOT_TEXT_BLOCK');
  run(store, { type: 'create-text-block', segmentId: 'gone', text: 'bye', start: 7.8, end: 8.5 });
  run(store, { type: 'delete-segment', segmentId: 'gone' }); assert.equal(seg(store, 'gone'), undefined);
}

/* ---- edit-segment-text ---- */
{
  const store = storeOf(), idsBefore = seg(store, 'segment_000001').tokenIds.slice();
  // same word count: texts replaced, IDs / times / emphasis kept
  const emphasis = tok(store, idsBefore[3]); emphasis.manualEmphasis = { level: 2 };
  const timesBefore = wordsOf(store, 'segment_000001').map(token => [token.start, token.end]);
  exact(store, () => run(store, { type: 'edit-segment-text', segmentId: 'segment_000001', text: 'Wait, we made 43% more.' }));
  assert.deepStrictEqual(seg(store, 'segment_000001').tokenIds, idsBefore); assert.equal(tok(store, idsBefore[3]).text, '43%');
  assert.deepStrictEqual(wordsOf(store, 'segment_000001').map(token => [token.start, token.end]), timesBefore);
  assert.deepStrictEqual(tok(store, idsBefore[3]).manualEmphasis, { level: 2 }); assert.equal(tok(store, idsBefore[3]).normalizedText, J.normalizeTokenText('43%'));

  // fewer words: the changed run is re-spread in the time of the old run, unchanged words untouched
  const fewer = storeOf(), orig = wordsOf(fewer, 'segment_000001').map(token => ({ id: token.id, s: token.start, e: token.end }));
  exact(fewer, () => run(fewer, { type: 'edit-segment-text', segmentId: 'segment_000001', text: 'Wait, we made 42% more.'.replace('made 42%', 'gained') }));
  const now = wordsOf(fewer, 'segment_000001'); assert.deepStrictEqual(now.map(token => token.text), ['Wait,', 'we', 'gained', 'more.']);
  assert.deepStrictEqual([now[0].id, now[1].id, now[3].id], [orig[0].id, orig[1].id, orig[4].id], 'unchanged words keep IDs');
  assert.deepStrictEqual([now[0].start, now[1].end, now[3].end], [orig[0].s, orig[1].e, orig[4].e], 'unchanged words keep times');
  near(now[2].start, orig[2].s, 'run starts where the old run started'); near(now[2].end, orig[3].e, 'run ends where the old run ended'); assert.equal(now[2].timingQuality, 'estimated');
  assert.equal(fewer.project.transcript.tokens.filter(token => orig.some(o => o.id === token.id)).length, 4, 'the surplus word is gone from the transcript (the first of the run keeps its ID)');

  // more words in place of one
  const more = storeOf(); const o2 = wordsOf(more, 'segment_000002');
  exact(more, () => run(more, { type: 'edit-segment-text', segmentId: 'segment_000002', text: 'Now go go go go go!' }));
  const w2 = wordsOf(more, 'segment_000002'); assert.equal(w2.length, 6);
  near(w2[0].start, o2[0].start, 'first word untouched'); near(w2[5].end, o2[3].end, 'edit stays inside the old span');
  assert.ok(w2.every((token, i) => i === 0 || token.start >= w2[i - 1].end - 1e-9), 'words in order, no overlap');
  assert.equal(new Set(more.project.transcript.tokens.map(token => token.id)).size, more.project.transcript.tokens.length, 'IDs unique');
  J.validateProject(more.project);

  // pure insertion between tight words borrows the neighbour's time
  const insert = storeOf(); exact(insert, () => run(insert, { type: 'edit-segment-text', segmentId: 'segment_000003', text: 'Captions really stay in sync.' }));
  const w3 = wordsOf(insert, 'segment_000003'); assert.equal(w3.length, 5); assert.ok(w3.every(token => token.end - token.start > 0.04), 'every word has a visible duration');
  J.validateProject(insert.project);

  refused(store, { type: 'edit-segment-text', segmentId: 'segment_000001', text: '   ' }, 'TOKEN_TEXT_REQUIRED');
  run(store, { type: 'set-field-lock', segmentId: 'segment_000004', field: 'tokenText' });
  refused(store, { type: 'edit-segment-text', segmentId: 'segment_000004', text: 'Four layouts' }, 'SEGMENT_FIELD_LOCKED');

  // a typed block goes through edit-text-block
  const typed = storeOf(); run(typed, { type: 'create-text-block', segmentId: 'blk', text: 'one two', start: 7.8, end: 8.8 });
  exact(typed, () => run(typed, { type: 'edit-segment-text', segmentId: 'blk', text: 'one two three' }));
  assert.equal(seg(typed, 'blk').tokenIds.length, 3);
}

/* ---- retime-tokens ---- */
{
  const store = storeOf(), ids = seg(store, 'segment_000002').tokenIds;
  exact(store, () => run(store, { type: 'retime-tokens', segmentId: 'segment_000002', times: [{ tokenId: ids[0], start: 3.5, end: 3.7 }, { tokenId: ids[1], start: 3.75, end: 3.96 }] }));
  near(tok(store, ids[0]).start, 3.5, 'tap time applied'); near(seg(store, 'segment_000002').start, 3.4, 'window unchanged while the words fit');
  // the window grows when a word is retimed past it and the room is free
  const grow = storeOf();
  exact(grow, () => run(grow, { type: 'retime-tokens', segmentId: 'segment_000002', times: [{ tokenId: ids[3], start: 4.34, end: 5.2 }] }));
  near(seg(grow, 'segment_000002').end, 5.2, 'window grows to hold the word');
  refused(grow, { type: 'retime-tokens', segmentId: 'segment_000002', times: [{ tokenId: ids[3], start: 4.34, end: 6.5 }] }, 'TRACK_SEGMENT_OVERLAP');
  refused(grow, { type: 'retime-tokens', segmentId: 'segment_000002', times: [{ tokenId: ids[1], start: 3.3, end: 3.6 }] }, 'TOKEN_TIMING_OVERLAP');   // starts before the previous word ends
  refused(grow, { type: 'retime-tokens', segmentId: 'segment_000002', times: [{ tokenId: ids[1], start: 3.9, end: 3.8 }] }, 'TOKEN_TIMING_INVALID');
  refused(grow, { type: 'retime-tokens', segmentId: 'segment_000002', times: [{ tokenId: 'word_000001', start: 1, end: 2 }] }, 'TOKEN_NOT_IN_SEGMENT');
  refused(grow, { type: 'retime-tokens', segmentId: 'segment_000002', times: [] }, 'RETIME_EMPTY');
  run(grow, { type: 'set-field-lock', segmentId: 'segment_000003', field: 'timing' });
  refused(grow, { type: 'retime-tokens', segmentId: 'segment_000003', times: [{ tokenId: seg(grow, 'segment_000003').tokenIds[0], start: 6.2, end: 6.5 }] }, 'SEGMENT_FIELD_LOCKED');
}

/* ---- batch ---- */
{
  const store = storeOf(), start = store.serialize();
  exact(store, () => run(store, { type: 'batch', label: 'shift two', commands: [
    { type: 'move-segment', segmentId: 'segment_000002', start: 3.5 }, { type: 'move-segment', segmentId: 'segment_000003', start: 6.3 }] }));
  near(seg(store, 'segment_000002').start, 3.5, 'first command applied'); near(seg(store, 'segment_000003').start, 6.3, 'second command applied');
  assert.equal(store.undoStack.length, 1, 'one undo step');
  assert.ok(store.undo()); assert.equal(store.serialize().replace(/"updatedAt":"[^"]*"/, ''), start.replace(/"updatedAt":"[^"]*"/, ''), 'one undo restores both');
  // all or nothing: the second command fails, the first is rolled back
  const fresh = storeOf(), before = fresh.serialize();
  assert.equal(code(() => run(fresh, { type: 'batch', commands: [{ type: 'move-segment', segmentId: 'segment_000002', start: 3.5 }, { type: 'move-segment', segmentId: 'segment_000003', start: 3.5 }] })), 'TRACK_SEGMENT_OVERLAP');
  assert.equal(fresh.serialize(), before, 'a failed batch changes nothing'); assert.equal(fresh.undoStack.length, 0);
  // later commands see the earlier ones (swap room, then move into it)
  run(fresh, { type: 'batch', commands: [{ type: 'move-segment', segmentId: 'segment_000002', start: 4.5 }, { type: 'move-segment', segmentId: 'segment_000001', start: 2.5 }] });
  near(seg(fresh, 'segment_000001').start, 2.5, 'second command saw the first');
  assert.equal(code(() => run(fresh, { type: 'batch', commands: [] })), 'BATCH_EMPTY');
  assert.equal(code(() => run(fresh, { type: 'batch', commands: [{ type: 'batch', commands: [{ type: 'move-segment', segmentId: 'segment_000001', start: 2.4 }] }] })), 'BATCH_NESTED');
  assert.equal(code(() => run(fresh, { type: 'batch', commands: [{ nope: 1 }] })), 'COMMAND_INVALID');
}

/* ---- spoken words overlap per track (ADR 0010), load-time overlap is a warning ---- */
{
  const store = storeOf(); run(store, { type: 'add-track', trackId: 'track_2' });
  run(store, { type: 'move-segment', segmentId: 'segment_000002', start: 6.2, trackId: 'track_2' });
  const project = clone(store.project);
  J.validateTranscript(project.transcript, { segments: project.segments });   // different tracks: fine
  assert.equal(code(() => J.validateTranscript(project.transcript)), 'TOKEN_TIMING_OVERLAP', 'without track information the old shared rule still applies');
  // two spoken words overlapping on the same track are still an error
  const clash = clone(project); const t = clash.transcript.tokens.find(token => token.id === clash.segments.find(segment => segment.id === 'segment_000003').tokenIds[1]); t.start = t.start - 0.2;
  assert.equal(code(() => J.validateTranscript(clash.transcript, { segments: clash.segments })), 'TOKEN_TIMING_OVERLAP');
  assert.equal(code(() => J.loadProject(JSON.stringify(project))), null, 'a project with cross-track overlap loads');

  // an old file with overlapping captions on one track still loads; it is reported, not refused
  const old = clone(base); old.segments[1].start = 2.0; old.segments[1].end = 4.7;
  const loaded = J.loadProject(JSON.stringify(old));
  const warnings = J.captionTrackOverlaps(loaded);
  assert.equal(warnings.length, 1); assert.equal(warnings[0].code, 'track-segment-overlap'); assert.equal(warnings[0].segmentId, 'segment_000001'); assert.equal(warnings[0].otherSegmentId, 'segment_000002');
  assert.deepStrictEqual(loaded.segments.map(segment => [segment.start, segment.end]), old.segments.map(segment => [segment.start, segment.end]), 'loading moves nothing');
}

/* ---- determinism ---- */
{
  const replay = () => { const store = storeOf(); run(store, { type: 'add-track', trackId: 'track_2' });
    run(store, { type: 'move-segment', segmentId: 'segment_000002', start: 4.2, trackId: 'track_2' }); run(store, { type: 'split-segment', segmentId: 'segment_000001', time: 1.06, newSegmentId: 'r' });
    run(store, { type: 'edit-segment-text', segmentId: 'segment_000003', text: 'Captions stay in perfect sync.' }); return store.serialize(); };
  assert.equal(replay(), replay(), 'the same commands give the same project');
}

console.log('Caption timing command tests passed.');
