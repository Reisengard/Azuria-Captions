/* Step 7: manual text blocks (create / edit / move / delete, overlap rules, locks, re-planning, undo). */
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

const fresh = () => {
  const project = { schemaVersion: 3, generatorVersion: 'test', mode: 'video-captions', id: 'blocks', media: { duration: 15, width: 1080, height: 1920 },
    transcript: clone(transcript), segments: [], plans: {}, safeZones: [], guides: [], seed: 3107, style: { preset: 'creator' }, settings: {}, createdAt: AT, updatedAt: AT };
  project.tracks = [J.defaultCaptionTrack(project)];
  const planned = J.planCaptions(project, project.media);
  project.segments = planned.segments; project.plans = planned.plans;
  return J.loadProject(clone(project));
};
const base = fresh();
const storeOf = () => new J.CaptionStore(clone(base));
const run = (store, command) => store.execute(Object.assign({ updatedAt: AT }, command));
const exact = (store, fn) => {
  const before = store.snapshot(); fn(); const after = store.snapshot();
  assert.ok(store.undo()); assert.deepStrictEqual(store.snapshot(), before, 'undo must restore the project exactly');
  assert.ok(store.redo()); assert.deepStrictEqual(store.snapshot(), after, 'redo must reproduce the result exactly');
};
const unchanged = (store, fn, expected) => { const before = store.serialize(); assert.equal(code(fn), expected); assert.equal(store.serialize(), before, `${expected} must leave the project untouched`); };
const block = (store, id) => store.project.segments.find(segment => segment.id === id);
const words = (store, segment) => segment.tokenIds.map(id => store.project.transcript.tokens.find(token => token.id === id));
const speechPlans = (store, ids) => Object.fromEntries(ids.map(id => [id, store.project.plans[id]]));
const speechIds = base.segments.map(segment => segment.id);

/* ---- create on the primary track (empty time) ---- */
const main = storeOf();
exact(main, () => run(main, { type: 'create-text-block', segmentId: 'title', text: 'Chapter one begins', start: 2.4, end: 3.3 }));
const title = block(main, 'title');
assert.equal(title.trackId, MAIN, 'no track given = primary track');
assert.equal(title.locks.segmentation, true, 'segmentation is locked by default');
assert.equal(title.boundarySource, 'manual');
assert.ok(J.isCaptionTextBlock(main.project, title));
assert.ok(!J.isCaptionTextBlock(main.project, block(main, 'segment_000001')), 'speech captions are not text blocks');
const titleWords = words(main, title);
assert.deepStrictEqual(titleWords.map(token => token.text), ['Chapter', 'one', 'begins']);
assert.ok(titleWords.every(token => token.source === 'manual' && token.timingQuality === 'estimated'));
assert.deepStrictEqual(titleWords.map(token => +token.start.toFixed(6)), [2.4, 2.7, 3], 'words are spread evenly (active-word behaviour stays on)');
assert.equal(titleWords[2].end, 3.3);
assert.equal(main.project.plans.title.trackId, MAIN);
assert.deepStrictEqual(speechPlans(main, speechIds), base.plans, 'adding a block never re-plans the other captions');
unchanged(main, () => run(main, { type: 'create-text-block', text: 'Clash', start: 3, end: 3.6 }), 'TEXT_BLOCK_OVERLAP');
unchanged(main, () => run(main, { type: 'create-text-block', text: 'Over speech', start: 1, end: 2 }), 'TEXT_BLOCK_OVERLAP');
unchanged(main, () => run(main, { type: 'create-text-block', text: '   ', start: 7.8, end: 8.5 }), 'TOKEN_TEXT_REQUIRED');
unchanged(main, () => run(main, { type: 'create-text-block', text: 'Backwards', start: 8.5, end: 7.8 }), 'SEGMENT_TIMING_INVALID');
unchanged(main, () => run(main, { type: 'create-text-block', text: 'Too late', start: 14.5, end: 15.5 }), 'TOKEN_END_AFTER_DURATION');
unchanged(main, () => run(main, { type: 'create-text-block', text: 'Nowhere', start: 7.8, end: 8.5, trackId: 'track_9' }), 'TRACK_NOT_FOUND');
unchanged(main, () => run(main, { type: 'create-text-block', segmentId: 'title', text: 'Again', start: 7.8, end: 8.5 }), 'SEGMENT_ID_DUPLICATE');
// the older command still works and now makes the same kind of block
run(main, { type: 'add-caption', text: 'Legacy entry', start: 7.8, end: 8.6 });
const legacy = main.project.segments.find(segment => segment.start === 7.8);
assert.ok(J.isCaptionTextBlock(main.project, legacy)); assert.equal(legacy.trackId, MAIN);

/* ---- create over speech on another track ---- */
const over = storeOf(); run(over, { type: 'add-track', trackId: 'track_2', name: 'Titles' });
const beforeEmphasis = J.applyCaptionEmphasis(over.project.transcript).tokens.map(token => token.emphasis);
exact(over, () => run(over, { type: 'create-text-block', segmentId: 'quote', trackId: 'track_2', text: 'Keep going', start: 0.9, end: 3.9,
  box: { x: 0.1, y: 0.1, width: 0.8, height: 0.16 }, animation: { enter: 'captionSoftRise', exit: 'captionFadeOut' } }));
const quote = block(over, 'quote');
assert.equal(quote.trackId, 'track_2');
J.validateProject(clone(over.project)); // the words overlap speech on the primary track, which is allowed across tracks
assert.deepStrictEqual(J.captionSegmentsAt(over.project, 1.2).map(segment => segment.id), ['segment_000001', 'quote'], 'speech and block are both on screen, primary first');
assert.deepStrictEqual(J.captionSegmentsAt(over.project, 2.3).map(segment => segment.id), ['quote']);
const quotePlan = over.project.plans.quote, resolved = J.captionResolvedPlan(quotePlan);
assert.deepStrictEqual(quotePlan.manual.box, { x: 0.1, y: 0.1, width: 0.8, height: 0.16, zoneKind: 'custom', manual: true });
assert.deepStrictEqual(resolved.box, quotePlan.manual.box, 'the block is drawn in its own box');
assert.equal(resolved.entrance, 'captionSoftRise'); assert.equal(resolved.exit, 'captionFadeOut');
assert.deepStrictEqual(J.captionTextBlockAnimation(quotePlan), { enter: 'captionSoftRise', hold: null, exit: 'captionFadeOut' });
assert.deepStrictEqual(speechPlans(over, speechIds), base.plans);
const afterEmphasis = J.applyCaptionEmphasis(over.project.transcript).tokens.filter(token => token.source !== 'manual').map(token => token.emphasis);
assert.deepStrictEqual(afterEmphasis, beforeEmphasis, 'a block laid over speech does not change the emphasis of the spoken words');
assert.ok(J.captionBoxCollisions(over.project).every(hit => hit.segmentId !== 'quote' && hit.otherSegmentId !== 'quote'), 'separate boxes do not collide');
// a second block on the same track must not overlap the first; on the primary track it must not overlap speech
unchanged(over, () => run(over, { type: 'create-text-block', trackId: 'track_2', text: 'Clash', start: 3.5, end: 4.5 }), 'TEXT_BLOCK_OVERLAP');
run(over, { type: 'create-text-block', segmentId: 'quote2', trackId: 'track_2', text: 'Second line', start: 3.9, end: 5 });
assert.deepStrictEqual(over.project.segments.map(segment => segment.start), over.project.segments.map(segment => segment.start).slice().sort((a, b) => a - b), 'segments stay sorted');

/* ---- animation presets: caption-safe registry ids only ---- */
const unsafe = Object.keys(J.registry('enter')).find(id => !J.captionComponentEligibility('enter', id, {}).allowed);
assert.ok(unsafe, 'the registry has a non-caption enter effect to test with');
unchanged(over, () => run(over, { type: 'edit-text-block', segmentId: 'quote', animation: { enter: unsafe } }), 'TEXT_BLOCK_ANIMATION_INVALID');
unchanged(over, () => run(over, { type: 'edit-text-block', segmentId: 'quote', animation: { enter: 'nope' } }), 'TEXT_BLOCK_ANIMATION_INVALID');
unchanged(over, () => run(over, { type: 'edit-text-block', segmentId: 'quote', animation: { spin: 'captionFade' } }), 'TEXT_BLOCK_ANIMATION_INVALID');
unchanged(over, () => run(over, { type: 'edit-text-block', segmentId: 'quote', animation: 'captionFade' }), 'TEXT_BLOCK_ANIMATION_INVALID');
exact(over, () => run(over, { type: 'edit-text-block', segmentId: 'quote', animation: { enter: null, hold: 'captionStill' } }));
assert.deepStrictEqual(J.captionTextBlockAnimation(over.project.plans.quote), { enter: null, hold: 'captionStill', exit: 'captionFadeOut' }, 'null returns a preset to automatic');
const tampered = clone(over.project); tampered.plans.quote.manual.entrance = unsafe;
assert.equal(code(() => J.validateProject(tampered)), 'CAPTION_TECHNIQUE_UNSAFE', 'a saved project cannot smuggle in an unsafe preset');
const options = J.captionTextBlockAnimationOptions(over.project, 'track_2');
assert.ok(options.enter.includes('captionSoftRise') && !options.enter.includes(unsafe), 'options come from the track style, caption-safe only');

/* ---- edit text and timing ---- */
const edit = storeOf(); run(edit, { type: 'add-track', trackId: 'track_2' });
run(edit, { type: 'create-text-block', segmentId: 'note', trackId: 'track_2', text: 'one two three', start: 5, end: 8 });
const oldIds = block(edit, 'note').tokenIds.slice();
run(edit, { type: 'set-manual-emphasis', tokenId: oldIds[0], value: { enabled: true, reason: 'editor' } });
run(edit, { type: 'set-manual-emphasis', tokenId: oldIds[1], value: { enabled: true, reason: 'editor' } });
exact(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note', text: 'one deux three four' }));
const note = block(edit, 'note'), noteWords = words(edit, note);
assert.deepStrictEqual(note.tokenIds.slice(0, 3), oldIds, 'ids are kept by position');
assert.equal(note.tokenIds.length, 4); assert.ok(!oldIds.includes(note.tokenIds[3]));
assert.deepStrictEqual(noteWords.map(token => token.text), ['one', 'deux', 'three', 'four']);
assert.deepStrictEqual(noteWords[0].manualEmphasis, { enabled: true, reason: 'editor' }, 'emphasis stays on an unchanged word');
assert.equal(noteWords[1].manualEmphasis, null, 'emphasis is dropped when the word changed');
assert.deepStrictEqual(noteWords.map(token => token.start), [5, 5.75, 6.5, 7.25]);
exact(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note', text: 'short', start: 6, end: 7 }));
assert.deepStrictEqual(words(edit, block(edit, 'note')).map(token => [token.id, token.start, token.end]), [[oldIds[0], 6, 7]]);
assert.equal(edit.project.transcript.tokens.filter(token => token.source === 'manual').length, 1, 'dropped words leave the transcript');
unchanged(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note', text: '' }), 'TOKEN_TEXT_REQUIRED');
unchanged(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note', end: 5 }), 'SEGMENT_TIMING_INVALID');
unchanged(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note' }), 'TEXT_BLOCK_EDIT_EMPTY');
unchanged(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'segment_000001', text: 'speech' }), 'SEGMENT_NOT_TEXT_BLOCK');
unchanged(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note', box: { x: 0.5, y: 0.5, width: 0.8, height: 0.2 } }), 'CAPTION_BOX_INVALID');
exact(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note', box: { x: 0.2, y: 0.3, width: 0.6, height: 0.12 } }));
exact(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note', box: null }));
assert.equal(edit.project.plans.note.manual.box, undefined, 'null clears the box: the block follows its track again');
assert.deepStrictEqual(speechPlans(edit, speechIds), base.plans, 'editing a block never re-plans the other captions');

/* ---- move between tracks ---- */
unchanged(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note', trackId: MAIN }), 'TEXT_BLOCK_OVERLAP');
run(edit, { type: 'edit-text-block', segmentId: 'note', start: 7.8, end: 8.9 });
exact(edit, () => run(edit, { type: 'move-segment-to-track', segmentId: 'note', trackId: MAIN }));
assert.equal(block(edit, 'note').trackId, MAIN, 'move-segment-to-track moves a locked-by-default block whole');
assert.equal(edit.project.plans.note.trackId, MAIN);
exact(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note', trackId: 'track_2' }));
assert.equal(block(edit, 'note').trackId, 'track_2');
unchanged(edit, () => run(edit, { type: 'edit-text-block', segmentId: 'note', trackId: 'track_7' }), 'TRACK_NOT_FOUND');

/* ---- locks ---- */
const locks = storeOf(); run(locks, { type: 'add-track', trackId: 'track_2' });
run(locks, { type: 'create-text-block', segmentId: 'b', trackId: 'track_2', text: 'locked words', start: 1, end: 2 });
run(locks, { type: 'edit-text-block', segmentId: 'b', text: 'still editable' }); // segmentation lock only guards the segmenter
run(locks, { type: 'set-field-lock', segmentId: 'b', field: 'tokenText' });
unchanged(locks, () => run(locks, { type: 'edit-text-block', segmentId: 'b', text: 'no' }), 'SEGMENT_FIELD_LOCKED');
run(locks, { type: 'set-field-lock', segmentId: 'b', field: 'timing' });
unchanged(locks, () => run(locks, { type: 'edit-text-block', segmentId: 'b', end: 2.5 }), 'SEGMENT_FIELD_LOCKED');
run(locks, { type: 'set-segment-lock', segmentId: 'b', lock: 'visualPlan' });
unchanged(locks, () => run(locks, { type: 'edit-text-block', segmentId: 'b', box: { x: 0.1, y: 0.1, width: 0.5, height: 0.1 } }), 'SEGMENT_FIELD_LOCKED');
unchanged(locks, () => run(locks, { type: 'edit-text-block', segmentId: 'b', animation: { enter: 'captionFade' } }), 'SEGMENT_FIELD_LOCKED');
unchanged(locks, () => run(locks, { type: 'edit-text-block', segmentId: 'b', trackId: MAIN }), 'SEGMENT_FIELD_LOCKED');
unchanged(locks, () => run(locks, { type: 'move-segment-to-track', segmentId: 'b', trackId: MAIN }), 'SEGMENT_FIELD_LOCKED');
const lockedPlan = clone(locks.project.plans.b);
run(locks, { type: 'reroll-track', trackId: MAIN });
assert.deepStrictEqual(locks.project.plans.b, lockedPlan, 'a locked block keeps its plan');

/* ---- re-segmentation and re-planning keep blocks intact ---- */
for (const trackId of [MAIN, 'track_2']) {
  const store = storeOf(); if (trackId !== MAIN) run(store, { type: 'add-track', trackId });
  run(store, { type: 'create-text-block', segmentId: 'keep', trackId, text: 'a block of five words', start: 2.3, end: 3.35 });
  const kept = clone(block(store, 'keep'));
  const project = clone(store.project);
  project.segments = J.replanCaptionSegments(project, { maxWords: 2, targetWords: 1 }).segments;
  const again = project.segments.find(segment => segment.id === 'keep'), core = item => item && { id: item.id, trackId: item.trackId, start: item.start, end: item.end, tokenIds: item.tokenIds, boundarySource: item.boundarySource, locks: item.locks };
  assert.deepStrictEqual(core(again), core(kept), `re-segmenting (${trackId}) never splits a block`);
  project.plans = J.planCaptions(project, project.media).plans;
  J.validateProject(project);
  assert.equal(project.plans.keep.trackId, trackId);
}

/* ---- delete ---- */
const del = storeOf(); run(del, { type: 'add-track', trackId: 'track_2' });
run(del, { type: 'create-text-block', segmentId: 'gone', trackId: 'track_2', text: 'bye now', start: 1, end: 3 });
const tokenCount = base.transcript.tokens.length;
exact(del, () => run(del, { type: 'delete-text-block', segmentId: 'gone' }));
assert.equal(block(del, 'gone'), undefined); assert.equal(del.project.plans.gone, undefined);
assert.equal(del.project.transcript.tokens.length, tokenCount, 'its words leave the transcript');
unchanged(del, () => run(del, { type: 'delete-text-block', segmentId: 'segment_000001' }), 'SEGMENT_NOT_TEXT_BLOCK');
unchanged(del, () => run(del, { type: 'delete-text-block', segmentId: 'nope' }), 'SEGMENT_NOT_FOUND');
// deleting a track deletes the blocks on it (D4)
run(del, { type: 'create-text-block', segmentId: 'again', trackId: 'track_2', text: 'with the track', start: 1, end: 3 });
run(del, { type: 'remove-track', trackId: 'track_2' });
assert.equal(block(del, 'again'), undefined); assert.equal(del.project.transcript.tokens.length, tokenCount);

/* ---- save / load, validation, determinism ---- */
const saved = over.serialize(), loaded = J.loadProject(saved);
assert.deepStrictEqual(loaded, JSON.parse(saved), 'a project with blocks round-trips unchanged');
const speechClash = clone(over.project), spoken = speechClash.transcript.tokens.filter(token => token.source !== 'manual');
spoken[1].start = spoken[0].start;
assert.equal(code(() => J.validateTranscript(speechClash.transcript)), 'TOKEN_TIMING_OVERLAP', 'spoken words still may not overlap each other');
const replay = () => {
  const store = storeOf();
  run(store, { type: 'add-track', trackId: 'track_2' });
  run(store, { type: 'create-text-block', trackId: 'track_2', text: 'Same inputs', start: 0.5, end: 2 });
  run(store, { type: 'create-text-block', text: 'same plan', start: 2.3, end: 3.3, animation: { enter: 'captionWordFade' } });
  run(store, { type: 'edit-text-block', segmentId: 'segment_000007', text: 'Same inputs again', box: { x: 0.1, y: 0.05, width: 0.8, height: 0.15 } });
  return store.serialize();
};
assert.equal(replay(), replay(), 'same commands give the same project');
const empty = new J.CaptionStore({ schemaVersion: 3, generatorVersion: 'test', mode: 'video-captions', id: 'empty', media: {}, transcript: { schemaVersion: 1, language: 'und', timingQuality: 'word', tokens: [] },
  tracks: [J.defaultCaptionTrack({ media: {} })], guides: [], segments: [], plans: {}, safeZones: [], seed: 1, style: { preset: 'creator' }, settings: {} });
run(empty, { type: 'create-text-block', text: 'No video yet', start: 0, end: 2 });
assert.equal(empty.project.segments.length, 1, 'blocks can be typed before a video is imported');

/* ---- UI wiring (structural) ---- */
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8'), ui = fs.readFileSync(path.join(root, 'src', '12c_caption_workbench.js'), 'utf8');
for (const id of ['captionManualTrack', 'captionBlockEditor', 'captionBlockText', 'captionBlockApply', 'captionBlockDelete', 'captionBlockEnter', 'captionBlockHold', 'captionBlockExit']) assert.match(body, new RegExp(`id="${id}"`), `text block UI is missing #${id}`);
for (const command of ['create-text-block', 'edit-text-block', 'delete-text-block']) assert.match(ui, new RegExp(`type: '${command}'`), `the workbench does not issue ${command}`);
assert.match(ui, /function applyTiming\(\)[^]*?type: 'trim-segment'/, 'numeric timing goes through trim-segment, which re-spreads a typed block in the store');
assert.match(ui, /window\.confirm\(`テキストブロック/, 'deleting a block asks first');

console.log('Caption text block tests passed.');
