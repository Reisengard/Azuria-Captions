/* Step 6: up to three caption tracks (commands, rules, planner, compositor, warnings). */
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
const MAIN = J.CAPTION_PRIMARY_TRACK_ID;

const fresh = () => {
  const project = { schemaVersion: 3, generatorVersion: 'test', mode: 'video-captions', id: 'tracks', media: { duration: 15, width: 1080, height: 1920 },
    transcript: clone(transcript), segments: [], plans: {}, safeZones: [], guides: [], seed: 3107, style: { preset: 'creator' }, settings: {}, createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z' };
  project.tracks = [J.defaultCaptionTrack(project)];
  const planned = J.planCaptions(project, project.media);
  project.segments = planned.segments; project.plans = planned.plans;
  return J.loadProject(clone(project));
};
const base = fresh();
const storeOf = () => new J.CaptionStore(clone(base));
const seg = (store, n) => store.project.segments.find(item => item.id === `segment_00000${n}`);
const tracksOf = (store, trackId) => store.project.segments.filter(item => item.trackId === trackId).map(item => item.id);
const exact = (store, run) => { // a command is undoable and redoable to exactly the same project
  const before = store.snapshot(); run(); const after = store.snapshot();
  assert.ok(store.undo()); assert.deepStrictEqual(store.snapshot(), before, 'undo must restore the project exactly');
  assert.ok(store.redo()); assert.deepStrictEqual(store.snapshot(), after, 'redo must reproduce the result exactly');
};
const everyTokenOnce = project => { // every included token is in at most one segment of one track
  const seen = new Set();
  for (const segment of project.segments) for (const id of segment.tokenIds) { assert.ok(!seen.has(id), `${id} is in two segments`); seen.add(id); }
  assert.deepStrictEqual(project.segments.map(item => item.start), project.segments.map(item => item.start).sort((a, b) => a - b), 'segments stay sorted by start');
  J.validateProject(clone(project));
};

/* ---- add / rename / reorder / limit ---- */
const store = storeOf();
exact(store, () => store.execute({ type: 'add-track' }));
assert.deepStrictEqual(store.project.tracks.map(track => track.id), [MAIN, 'track_2']);
const second = store.project.tracks[1];
assert.equal(second.name, 'Track 2'); assert.equal(second.primary, false);
assert.equal(second.box.zoneKind, 'top', 'a new track opens in an unused zone so it does not sit on the primary box');
assert.notDeepEqual(second.box.y, store.project.tracks[0].box.y);
assert.deepStrictEqual(second.roles, { base: {}, active: {}, emphasis: {} }); assert.deepStrictEqual(second.style, {});
store.execute({ type: 'add-track', name: '  Keywords  ' });
assert.equal(store.project.tracks[2].id, 'track_3'); assert.equal(store.project.tracks[2].name, 'Keywords', 'names are trimmed');
assert.equal(code(() => store.execute({ type: 'add-track' })), 'TRACKS_LIMIT');
assert.equal(store.project.tracks.length, 3, 'a failed command leaves the project untouched');
assert.equal(code(() => storeOf().execute({ type: 'add-track', trackId: MAIN })), 'TRACK_ID_DUPLICATE');
assert.equal(code(() => storeOf().execute({ type: 'add-track', name: '   ' })), 'TRACK_NAME_INVALID');
assert.equal(code(() => storeOf().execute({ type: 'add-track', name: 'x'.repeat(41) })), 'TRACK_NAME_INVALID');
assert.equal(code(() => storeOf().execute({ type: 'add-track', box: { x: 0.5, y: 0.5, width: 0.9, height: 0.2 } })), 'CAPTION_BOX_INVALID');
const custom = storeOf(); custom.execute({ type: 'add-track', box: { x: 0.1, y: 0.4, width: 0.5, height: 0.2 } });
assert.equal(custom.project.tracks[1].box.manual, true, 'an explicit box counts as user-edited');

exact(store, () => store.execute({ type: 'rename-track', trackId: 'track_2', name: 'Quotes' }));
assert.equal(store.project.tracks[1].name, 'Quotes');
assert.equal(code(() => store.execute({ type: 'rename-track', trackId: 'nope', name: 'x' })), 'TRACK_NOT_FOUND');
assert.equal(code(() => store.execute({ type: 'rename-track', trackId: 'track_2', name: '' })), 'TRACK_NAME_INVALID');
exact(store, () => store.execute({ type: 'reorder-track', trackId: 'track_3', toIndex: 1 }));
assert.deepStrictEqual(store.project.tracks.map(track => track.id), [MAIN, 'track_3', 'track_2'], 'reorder changes the z-order');
assert.equal(code(() => store.execute({ type: 'reorder-track', trackId: MAIN, toIndex: 1 })), 'TRACK_PRIMARY_FIXED');
assert.equal(code(() => store.execute({ type: 'reorder-track', trackId: 'track_2', toIndex: 0 })), 'TRACK_INDEX_INVALID', 'nothing goes below the primary track');
assert.equal(code(() => store.execute({ type: 'reorder-track', trackId: 'track_2', toIndex: 3 })), 'TRACK_INDEX_INVALID');
assert.equal(store.project.tracks[0].id, MAIN, 'the primary track stays first');
// adding an empty track changes nothing for the primary track: plans are byte-identical
assert.deepStrictEqual(store.project.plans, base.plans, 'existing captions plan identically after tracks are added');

/* ---- moving whole captions ---- */
const move = storeOf(); move.execute({ type: 'add-track' });
exact(move, () => move.execute({ type: 'move-segment-to-track', segmentId: 'segment_000002', trackId: 'track_2' }));
assert.equal(seg(move, 2).trackId, 'track_2'); assert.equal(move.project.plans.segment_000002.trackId, 'track_2');
assert.deepStrictEqual(seg(move, 2).tokenIds, base.segments[1].tokenIds, 'ids and words are unchanged');
assert.equal(seg(move, 2).start, base.segments[1].start); assert.equal(seg(move, 2).end, base.segments[1].end, 'timing is unchanged');
assert.equal(move.project.plans.segment_000002.generated.box.y, move.project.tracks[1].box.y, 'the plan is placed in the new track box');
assert.notEqual(move.project.plans.segment_000002.generated.box.y, base.plans.segment_000002.generated.box.y);
everyTokenOnce(move.project);
assert.equal(code(() => move.execute({ type: 'move-segment-to-track', segmentId: 'segment_000002', trackId: 'track_2' })), 'SEGMENT_ALREADY_ON_TRACK');
assert.equal(code(() => move.execute({ type: 'move-segment-to-track', segmentId: 'segment_000001', trackId: 'track_9' })), 'TRACK_NOT_FOUND');
assert.equal(code(() => move.execute({ type: 'move-segment-to-track', segmentId: 'segment_000099', trackId: 'track_2' })), 'SEGMENT_NOT_FOUND');
move.execute({ type: 'set-segment-lock', segmentId: 'segment_000003', lock: 'visualPlan', locked: true });
assert.equal(code(() => move.execute({ type: 'move-segment-to-track', segmentId: 'segment_000003', trackId: 'track_2' })), 'SEGMENT_FIELD_LOCKED', 'locked captions are not moved silently');
// a manual box on the caption travels with it
move.execute({ type: 'set-segment-box', segmentId: 'segment_000004', box: { x: 0.2, y: 0.3, width: 0.6, height: 0.2 } });
move.execute({ type: 'move-segment-to-track', segmentId: 'segment_000004', trackId: 'track_2' });
assert.deepStrictEqual(move.project.plans.segment_000004.manual.box.y, 0.3, 'manual overrides survive a move');
// only one caption per track can be on screen: an overlapping move is refused
const overlap = storeOf(); overlap.execute({ type: 'add-track' });
overlap.execute({ type: 'move-segment-to-track', segmentId: 'segment_000001', trackId: 'track_2' });
overlap.execute({ type: 'set-segment-timing', segmentId: 'segment_000001', end: 3.6 });
assert.equal(code(() => overlap.execute({ type: 'move-segment-to-track', segmentId: 'segment_000002', trackId: 'track_2' })), 'TRACK_SEGMENT_OVERLAP');
assert.equal(seg(overlap, 2).trackId, MAIN, 'the refused move changed nothing');

/* ---- moving words ---- */
const words = storeOf(); words.execute({ type: 'add-track' });
const [w1, w2, w3, w4, w5] = base.segments[0].tokenIds;
exact(words, () => words.execute({ type: 'move-tokens-to-track', tokenIds: [w3], trackId: 'track_2' }));
const pieces = words.project.segments.filter(item => item.tokenIds.some(id => base.segments[0].tokenIds.includes(id)));
assert.equal(pieces.length, 3, 'a word in the middle splits its caption in three');
const owner = id => pieces.find(item => item.tokenIds.includes(id));
assert.equal(owner(w3).trackId, 'track_2'); assert.deepStrictEqual(owner(w3).tokenIds, [w3]);
assert.deepStrictEqual(owner(w1).tokenIds, [w1, w2]); assert.equal(owner(w1).id, 'segment_000001', 'the first remaining piece keeps the segment id and its plan');
assert.deepStrictEqual(owner(w4).tokenIds, [w4, w5]); assert.equal(owner(w4).trackId, MAIN);
assert.equal(owner(w1).start, base.segments[0].start); assert.equal(owner(w4).end, base.segments[0].end, 'outer timing is preserved');
assert.equal(owner(w3).start, transcript.tokens.find(token => token.id === w3).start);
for (const piece of pieces) assert.ok(words.project.plans[piece.id] && words.project.plans[piece.id].trackId === piece.trackId, 'every piece has a plan on its own track');
everyTokenOnce(words.project);
// the words that stay keep being one row: neighbours are per track
assert.equal(J.captionTrackNeighbor(words.project, owner(w1), 1), owner(w4), 'the next caption in the same track skips the other track');
assert.equal(code(() => words.execute({ type: 'merge-segments', segmentId: owner(w1).id, nextSegmentId: owner(w3).id })), 'SEGMENTS_NOT_ADJACENT', 'merge only joins neighbours in one track');
exact(words, () => words.execute({ type: 'merge-segments', segmentId: owner(w1).id }));
assert.deepStrictEqual(words.project.segments.find(item => item.id === 'segment_000001').tokenIds, [w1, w2, w4, w5], 'merge joins the next caption of the same track');
everyTokenOnce(words.project);
words.undo();
assert.equal(code(() => words.execute({ type: 'move-tokens-to-track', tokenIds: [], trackId: 'track_2' })), 'TOKENS_REQUIRED');
assert.equal(code(() => words.execute({ type: 'move-tokens-to-track', tokenIds: [w3], trackId: 'track_2' })), 'TOKENS_ALREADY_ON_TRACK');
assert.equal(code(() => words.execute({ type: 'move-tokens-to-track', tokenIds: ['ghost'], trackId: 'track_2' })), 'TOKEN_NOT_FOUND');
// moving the first and last word gives two runs, and the words that stay remain one caption
const ends = storeOf(); ends.execute({ type: 'add-track' });
ends.execute({ type: 'move-tokens-to-track', tokenIds: [w1, w5], trackId: 'track_2' });
assert.deepStrictEqual(tracksOf(ends, 'track_2').length, 2, 'each run of moved words is its own caption');
assert.deepStrictEqual(ends.project.segments.find(item => item.id === 'segment_000001').tokenIds, [w2, w3, w4]);
everyTokenOnce(ends.project);
// locks: segmentation-locked captions are not split
const locked = storeOf(); locked.execute({ type: 'add-track' });
locked.execute({ type: 'set-segment-lock', segmentId: 'segment_000001', lock: 'segmentation', locked: true });
assert.equal(code(() => locked.execute({ type: 'move-tokens-to-track', tokenIds: [w3], trackId: 'track_2' })), 'SEGMENT_FIELD_LOCKED');
// words from two captions can move together
const both = storeOf(); both.execute({ type: 'add-track' });
both.execute({ type: 'move-tokens-to-track', tokenIds: [base.segments[1].tokenIds[0], base.segments[2].tokenIds[0]], trackId: 'track_2' });
assert.equal(tracksOf(both, 'track_2').length, 2); everyTokenOnce(both.project);

/* ---- removing a track deletes its content (D4) ---- */
const removal = storeOf(); removal.execute({ type: 'add-track' });
removal.execute({ type: 'move-segment-to-track', segmentId: 'segment_000002', trackId: 'track_2' });
removal.execute({ type: 'move-tokens-to-track', tokenIds: [w3], trackId: 'track_2' });
const doomedTokens = new Set(removal.project.segments.filter(item => item.trackId === 'track_2').flatMap(item => item.tokenIds));
assert.ok(doomedTokens.size >= 5);
const beforeRemoval = removal.snapshot();
removal.execute({ type: 'remove-track', trackId: 'track_2' });
assert.deepStrictEqual(removal.project.tracks.map(track => track.id), [MAIN]);
assert.equal(removal.project.segments.filter(item => item.trackId === 'track_2').length, 0);
for (const token of removal.project.transcript.tokens) assert.ok(!doomedTokens.has(token.id), 'the words on the track are deleted, not handed back to the primary track');
for (const id of Object.keys(removal.project.plans)) assert.ok(removal.project.segments.some(item => item.id === id), 'no plan outlives its caption');
everyTokenOnce(removal.project);
assert.ok(removal.undo()); assert.deepStrictEqual(removal.snapshot(), beforeRemoval, 'deleting a track is undone exactly (tokens, segments, plans, timing, locks)');
assert.ok(removal.redo());
assert.equal(code(() => removal.execute({ type: 'remove-track', trackId: MAIN })), 'TRACK_PRIMARY_UNDELETABLE');
assert.equal(code(() => removal.execute({ type: 'remove-track', trackId: 'track_2' })), 'TRACK_NOT_FOUND');

/* ---- style per track ---- */
for (const bad of [{ preset: 'nope' }, { captionTreatment: 'sparkle' }, { accentColor: 'red' }, { alignment: 'justify' }, { motion: 2 }, { fontSize: 5 }, { segmentation: { maxWords: 0 } }, { segmentation: { minWords: 5, maxWords: 2 } }, { segmentation: { speed: 1 } }, 'text']) {
  assert.equal(code(() => J.normalizeCaptionTrackStyle(bad)), 'TRACK_STYLE_INVALID', JSON.stringify(bad));
}
assert.deepStrictEqual(J.normalizeCaptionTrackStyle({ accentColor: '#ABCDEF', segmentation: { maxWords: 3 } }), { accentColor: '#abcdef', segmentation: { maxWords: 3 } });
assert.deepStrictEqual(J.mergeCaptionTrackStyle({ captionTreatment: 'neon', segmentation: { maxWords: 3, minWords: 1 } }, { captionTreatment: null, segmentation: { maxWords: null } }), { segmentation: { minWords: 1 } });
const styled = storeOf(); styled.execute({ type: 'add-track' });
styled.execute({ type: 'move-segment-to-track', segmentId: 'segment_000002', trackId: 'track_2' });
exact(styled, () => styled.execute({ type: 'set-track-style', trackId: 'track_2', style: { captionTreatment: 'neon', accentColor: '#00ffcc', preset: 'punchy' } }));
assert.equal(J.captionResolvedPlan(styled.project.plans.segment_000002).captionTreatment, 'neon', 'the track style reaches its plans');
assert.equal(J.captionResolvedPlan(styled.project.plans.segment_000002).accentColor, '#00ffcc');
assert.equal(J.captionResolvedPlan(styled.project.plans.segment_000002).styleProfile, 'punchy');
assert.equal(J.captionResolvedPlan(styled.project.plans.segment_000001).captionTreatment, 'outline', 'other tracks are untouched');
assert.equal(J.captionResolvedPlan(styled.project.plans.segment_000001).styleProfile, 'creator');
assert.equal(code(() => styled.execute({ type: 'set-track-style', trackId: 'track_2', style: { captionTreatment: 'sparkle' } })), 'TRACK_STYLE_INVALID');
styled.execute({ type: 'set-track-style', trackId: 'track_2', reset: true });
assert.deepStrictEqual(styled.project.tracks[1].style, {});
assert.equal(J.captionResolvedPlan(styled.project.plans.segment_000002).captionTreatment, 'outline', 'reset returns to the project style');
const broken = clone(styled.project); broken.tracks[1].style = { motion: 9 };
assert.equal(code(() => J.loadProject(clone(broken))), 'TRACK_STYLE_INVALID', 'a saved bad style is rejected on load');

/* ---- reroll one track ---- */
const reroll = storeOf(); reroll.execute({ type: 'add-track' });
for (const id of [1, 2, 3]) reroll.execute({ type: 'move-segment-to-track', segmentId: `segment_00000${id}`, trackId: 'track_2' });
reroll.execute({ type: 'set-segment-lock', segmentId: 'segment_000003', lock: 'visualPlan', locked: true });
const rerollBefore = reroll.snapshot();
exact(reroll, () => reroll.execute({ type: 'reroll-track', trackId: 'track_2' }));
const trackLook = reroll.project.tracks[1].style.look;
assert.ok(trackLook && trackLook.enter, 'randomizing a track stores its look as plain choices');
for (const id of [1, 2]) assert.equal(reroll.project.plans[`segment_00000${id}`].generated.entrance, trackLook.enter, 'captions follow the track look');
assert.deepStrictEqual(reroll.project.plans.segment_000003, rerollBefore.plans.segment_000003, 'a locked caption keeps its look');
// The rolling-attention figure is informational and counts neighbours on every track; the visible look must not move.
const withoutMotionInfo = plan => { const copy = clone(plan); delete copy.generated.motionSummary; delete copy.generated.overBudget; return copy; };
for (const id of [4, 5, 6]) assert.deepStrictEqual(withoutMotionInfo(reroll.project.plans[`segment_00000${id}`]), withoutMotionInfo(rerollBefore.plans[`segment_00000${id}`]), 'other tracks keep their plans');
const again = new J.CaptionStore(clone(rerollBefore)); again.execute({ type: 'reroll-track', trackId: 'track_2' });
assert.deepStrictEqual(again.project.plans, reroll.project.plans, 'the same randomize gives the same plans');
const allLocked = storeOf(); allLocked.execute({ type: 'add-track' });
assert.equal(code(() => allLocked.execute({ type: 'reroll-track', trackId: 'track_2' })), 'TRACK_NOTHING_TO_REROLL', 'an empty track has nothing to reroll');

/* ---- seeds: the primary track keeps today's seeds, other tracks fold their id in ---- */
const seeds = storeOf(); seeds.execute({ type: 'add-track' });
seeds.execute({ type: 'move-segment-to-track', segmentId: 'segment_000002', trackId: 'track_2' });
assert.equal(seeds.project.plans.segment_000001.generated.seed, base.plans.segment_000001.generated.seed, 'primary seeds are unchanged');
assert.notEqual(seeds.project.plans.segment_000002.generated.seed, base.plans.segment_000002.generated.seed, 'the same caption on another track gets its own seed');
assert.equal(seeds.project.plans.segment_000002.generated.seed, J.h(base.seed, J.sid('track_2'), J.sid('segment_000002'), 0, J.CAPTION_PLANNER_VERSION));
const replay = storeOf(); replay.execute({ type: 'add-track' }); replay.execute({ type: 'move-segment-to-track', segmentId: 'segment_000002', trackId: 'track_2' });
assert.equal(replay.serialize(), seeds.serialize().replace(/"updatedAt": "[^"]+"/, `"updatedAt": "${replay.project.updatedAt}"`), 'the same commands give the same project');

/* ---- global motion budget, per-track continuity ---- */
const plan = { components: [], font: 'A', position: 'top' };
const budget = { rollingWindow: 4, maxRollingAttention: 0.5, continuity: { font: 'fixed' } };
const other = { motionSummary: { attentionCost: 0.3, intensity: 1 }, components: [], font: 'B', position: 'bottom' };
const loud = { components: [{ group: 'enter', id: 'x', metadata: { intensity: 1, motionCost: 0.1, attentionCost: 0.3, captionSafe: true } }], font: 'A' };
assert.ok(J.evaluateCaptionMotionPlan(loud, { profile: budget, recentPlans: [other, other] }).reasons.includes('rolling-attention-budget-exceeded'), 'plans of every track count against one rolling budget');
assert.ok(J.evaluateCaptionMotionPlan(loud, { profile: budget, recentPlans: [other], previousPlan: undefined }).continuity.changes.length === 0, 'an explicit missing previous plan (first caption of a track) has no continuity to break');
assert.ok(J.evaluateCaptionMotionPlan(loud, { profile: budget, recentPlans: [other] }).continuity.changes.length === 1, 'without a per-track predecessor the global one is still used (unchanged behaviour)');
// planner: a second track does not make the first one loud or raise continuity violations
const busy = storeOf(); busy.execute({ type: 'add-track' });
busy.execute({ type: 'set-track-style', trackId: 'track_2', style: { preset: 'punchy' } });
for (const id of [2, 4, 6]) busy.execute({ type: 'move-segment-to-track', segmentId: `segment_00000${id}`, trackId: 'track_2' });
for (const [id, stored] of Object.entries(busy.project.plans)) {
  const reasons = (stored.generated.readability && stored.generated.readability.reasons || []).concat(stored.generated.fallback ? ['fallback'] : []);
  assert.ok(!reasons.some(reason => String(reason).startsWith('continuity')), `${id}: ${reasons}`);
}
// segmentation runs per track, over that track's words only
const seg3 = storeOf(); seg3.execute({ type: 'add-track' });
seg3.execute({ type: 'move-tokens-to-track', tokenIds: [w2, w3], trackId: 'track_2' });
const replanned = J.replanCaptionSegments(seg3.project, { maxWords: 2, targetWords: 2 });
const idsOf = trackId => replanned.segments.filter(item => item.trackId === trackId).flatMap(item => item.tokenIds);
assert.deepStrictEqual(idsOf('track_2'), [w2, w3], 'moved words stay on their track when the project is re-segmented');
assert.ok(!idsOf(MAIN).includes(w2) && !idsOf(MAIN).includes(w3));
assert.equal(new Set(replanned.segments.map(item => item.id)).size, replanned.segments.length, 'new segment ids never collide across tracks');
assert.equal(replanned.segments.length, replanned.segments.filter((item, index, all) => all.findIndex(other => other.id === item.id) === index).length);
const applied = clone(seg3.project); applied.segments = replanned.segments; applied.plans = J.planCaptions(applied, applied.media).plans;
everyTokenOnce(applied);
// locked segmentation survives a per-track re-segmentation
const lockedSeg = storeOf(); lockedSeg.execute({ type: 'add-track' }); lockedSeg.execute({ type: 'set-segment-lock', segmentId: 'segment_000001', lock: 'segmentation', locked: true });
lockedSeg.execute({ type: 'move-segment-to-track', segmentId: 'segment_000002', trackId: 'track_2' });
const keptSeg = J.replanCaptionSegments(lockedSeg.project, {}).segments.find(item => item.id === 'segment_000001');
assert.deepStrictEqual(keptSeg.tokenIds, base.segments[0].tokenIds, 'a locked caption keeps its words');
assert.equal(keptSeg.start, base.segments[0].start); assert.equal(keptSeg.end, base.segments[0].end);
// a project with one track resegments exactly as before
assert.deepStrictEqual(J.replanCaptionSegments(base, { maxWords: 3 }).segments, J.segmentCaptions(base.transcript, { maxWords: 3, duration: 15, existingSegments: base.segments }).segments);

/* ---- collisions are warnings, never moves ---- */
const clash = storeOf(); clash.execute({ type: 'add-track' });
clash.execute({ type: 'set-track-box', trackId: 'track_2', box: J.roundCaptionBox(clash.project.tracks[0].box) });
clash.execute({ type: 'move-segment-to-track', segmentId: 'segment_000001', trackId: 'track_2' });
assert.deepStrictEqual(J.captionBoxCollisions(clash.project), [], 'boxes may overlap when the captions are not on screen together');
clash.execute({ type: 'set-segment-timing', segmentId: 'segment_000001', end: 3.6 }); // now shares 3.4-3.6 with segment 2 (primary)
const hits = J.captionBoxCollisions(clash.project);
assert.equal(hits.length, 1); assert.equal(hits[0].code, 'track-box-collision');
assert.deepStrictEqual([hits[0].trackId, hits[0].otherTrackId].sort(), [MAIN, 'track_2'].sort());
assert.ok(Math.abs(hits[0].start - 3.4) < 1e-9 && Math.abs(hits[0].end - 3.6) < 1e-9);
const boxBefore = clone(clash.project.tracks.map(track => track.box));
J.captionBoxCollisions(clash.project); assert.deepStrictEqual(clash.project.tracks.map(track => track.box), boxBefore, 'a warning never moves a box');
clash.execute({ type: 'set-track-box', trackId: 'track_2', box: { x: 0.08, y: 0.05, width: 0.84, height: 0.2 } });
assert.deepStrictEqual(J.captionBoxCollisions(clash.project), [], 'separating the boxes clears the warning');
const sameTrack = storeOf(); assert.deepStrictEqual(J.captionBoxCollisions(sameTrack.project), []);

/* ---- z-order and the compositor ---- */
const draw = storeOf(); draw.execute({ type: 'add-track' }); draw.execute({ type: 'add-track' });
draw.execute({ type: 'move-segment-to-track', segmentId: 'segment_000001', trackId: 'track_2' });
draw.execute({ type: 'set-segment-timing', segmentId: 'segment_000001', end: 3.6 });
draw.execute({ type: 'move-segment-to-track', segmentId: 'segment_000003', trackId: 'track_3' });
draw.execute({ type: 'set-segment-timing', segmentId: 'segment_000003', start: 3.5 });
const visible = time => J.captionSegmentsAt(draw.project, time).map(item => item.trackId);
assert.deepStrictEqual(visible(3.55), [MAIN, 'track_2', 'track_3'], 'one caption per track, primary first (bottom), later tracks on top');
assert.deepStrictEqual(visible(0.5), ['track_2']); assert.deepStrictEqual(visible(14), [MAIN]); assert.deepStrictEqual(visible(0.1), []);
draw.execute({ type: 'reorder-track', trackId: 'track_3', toIndex: 1 });
assert.deepStrictEqual(visible(3.55), [MAIN, 'track_3', 'track_2'], 'reordering tracks reorders the drawing');
const drawn = [], realMain = J.mainDraw, realRenderer = J.Renderer;
J.mainDraw = (env, item) => drawn.push(item.text); J.Renderer = { prototype: { makeEnv: () => ({}) } };
try {
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {}, fillText() {}, measureText: text => ({ width: text.length * 20 }) };
  const result = J.drawCaptionOverlay(ctx, draw.project, 3.55);
  assert.equal(result.layers.length, 3, 'every visible track is drawn'); assert.equal(result.segmentId, result.layers[0].segmentId, 'the primary result keeps its old shape');
  assert.deepStrictEqual(result.layers.map(layer => layer.segmentId), ['segment_000002', 'segment_000003', 'segment_000001']);
  assert.deepStrictEqual(drawn.map(text => text.replace(/\s+/g, ' ')), ['Now go go go!', 'Captions stay in sync.', 'Wait, we made 42% more.'], 'primary is drawn first, then the tracks above it in track order');
  assert.equal(J.drawCaptionOverlay(ctx, draw.project, 0.1), null, 'nothing is drawn when no track has a caption');
  // a project without tracks still draws (fixtures and old plans)
  const bare = clone(draw.project); delete bare.tracks; for (const item of bare.segments) delete item.trackId;
  assert.ok(J.drawCaptionOverlay(ctx, bare, 0.5));
} finally { J.mainDraw = realMain; J.Renderer = realRenderer; }

/* ---- validator ---- */
const dup = clone(base); dup.segments[1].tokenIds.push(dup.segments[0].tokenIds[0]);
assert.equal(code(() => J.loadProject(clone(dup))), 'SEGMENT_TOKEN_DUPLICATE', 'a word cannot be shown twice');
const orphan = clone(base); orphan.segments[0].trackId = 'track_9';
assert.equal(code(() => J.loadProject(clone(orphan))), 'SEGMENT_TRACK_NOT_FOUND');

/* ---- three tracks survive save and load ---- */
const roundtrip = storeOf();
roundtrip.execute({ type: 'add-track' }); roundtrip.execute({ type: 'add-track' });
roundtrip.execute({ type: 'move-tokens-to-track', tokenIds: [w3], trackId: 'track_2' });
roundtrip.execute({ type: 'move-segment-to-track', segmentId: 'segment_000004', trackId: 'track_3' });
roundtrip.execute({ type: 'set-track-roles', trackId: 'track_3', roles: { emphasis: { color: '#ffde59' } } });
roundtrip.execute({ type: 'set-track-style', trackId: 'track_3', style: { accentColor: '#00ffcc' } });
const loaded = J.loadProject(roundtrip.serialize());
assert.deepStrictEqual(loaded.tracks, roundtrip.project.tracks); assert.deepStrictEqual(loaded.segments, roundtrip.project.segments); assert.deepStrictEqual(loaded.plans, roundtrip.project.plans);
assert.deepStrictEqual(J.planCaptions(loaded, loaded.media).plans, loaded.plans, 'a reloaded project re-plans to the same plans');

/* ---- workbench wiring (structural: the UI is exercised in a browser) ---- */
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8'), ui = require('./caption_ui_source').workbenchSource(root);
for (const id of ['captionTracksPanel', 'captionTrackList', 'captionTrackAddInline', 'captionTrackReroll',
  'captionTrackPreset', 'captionTrackTreatment', 'captionTrackAccent', 'captionMoveTrack', 'captionMoveSegment', 'captionMoveTokens', 'captionTrackLabels', 'captionBoxGhosts']) assert.match(body, new RegExp(`id="${id}"`), `${id} is missing from the page`);
for (const command of ['add-track', 'remove-track', 'rename-track', 'reorder-track', 'set-track-style', 'randomize-caption-look', 'set-caption-look', 'set-segment-look', 'move-segment-to-track', 'move-tokens-to-track']) assert.match(ui, new RegExp(`'${command}'`), `${command} is not reachable from the workbench`);
assert.match(ui, /caption-track-row/, 'the timeline has no row per track'); assert.match(ui, /caption-box-ghost/, 'other tracks have no ghost outline');
assert.match(ui, /J\.captionBoxCollisions/, 'collision warnings are not shown'); assert.match(ui, /window\.confirm\(`トラック/, 'deleting a track is not confirmed');
assert.doesNotMatch(ui, /segments\[index \+ 1\]|segments\[index - 1\]|segments\[segments\.indexOf/, 'a neighbouring caption must be looked up per track, not by list position');

console.log('Caption tracks tests passed.');
