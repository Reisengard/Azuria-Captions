/* Dependency-free tests for Gate 1.4 caption commands and history. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({}) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

const transcript = J.importWordJson(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8'), { duration: 15 });
const project = {
  schemaVersion: 2, generatorVersion: 'caption-mvp-1', mode: 'video-captions', id: 'project_store_test',
  media: { duration: 15 }, transcript,
  segments: [
    { id: 'segment_000001', tokenIds: transcript.tokens.slice(0, 5).map(token => token.id), start: 0.4, end: 2.25, boundarySource: 'planner', boundaryReasons: [], locks: { segmentation: false, visualPlan: false, fields: [] } },
    { id: 'segment_000002', tokenIds: transcript.tokens.slice(5, 9).map(token => token.id), start: 3.4, end: 4.7, boundarySource: 'planner', boundaryReasons: [], locks: { segmentation: false, visualPlan: false, fields: [] } },
  ],
  plans: {
    segment_000001: { id: 'plan_segment_000001', segmentId: 'segment_000001', generated: { layout: 'captionBottom', seed: 10 }, manual: {}, lockedFields: [] },
    segment_000002: { id: 'plan_segment_000002', segmentId: 'segment_000002', generated: { layout: 'captionTop', seed: 20 }, manual: {}, lockedFields: [] },
  },
  safeZones: [], seed: 77, settings: {}, createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
};
const store = new J.CaptionStore(project);
const original = store.snapshot();

store.execute({ type: 'edit-token-text', tokenId: 'word_000001', text: 'WAIT!', updatedAt: '2026-09-27T00:00:01.000Z' });
assert.equal(store.project.transcript.tokens[0].normalizedText, 'wait');
assert.deepStrictEqual(store.project.transcript.tokens.map(token => token.id), original.transcript.tokens.map(token => token.id));
store.execute({ type: 'set-manual-emphasis', tokenId: 'word_000001', value: { enabled: true, reason: 'editor' } });
store.execute({ type: 'set-visual-override', segmentId: 'segment_000001', field: 'layout', value: 'manualLayout' });
assert.equal(store.project.plans.segment_000001.generated.layout, 'captionBottom');
assert.equal(store.project.plans.segment_000001.manual.layout, 'manualLayout');
assert.equal(J.captionResolvedPlan(store.project.plans.segment_000001).layout, 'manualLayout');

store.execute({ type: 'split-segment', segmentId: 'segment_000001', splitIndex: 2, newSegmentId: 'segment_split', boundaryTime: 1.06 });
assert.deepStrictEqual(store.project.segments.slice(0, 2).map(segment => segment.id), ['segment_000001', 'segment_split']);
store.execute({ type: 'merge-segments', segmentId: 'segment_000001', nextSegmentId: 'segment_split' });
assert.deepStrictEqual(store.project.segments[0].tokenIds, original.segments[0].tokenIds);
store.execute({ type: 'set-segment-boundary', segmentId: 'segment_000001', time: 3.0 });
assert.equal(store.project.segments[0].end, 3.0);
assert.equal(store.project.segments[1].start, 3.0);
assert.throws(() => store.execute({ type: 'set-segment-boundary', segmentId: 'segment_000001', time: 3.5 }), error => error.code === 'SEGMENT_BOUNDARY_CONSTRAINT');
store.execute({ type: 'set-segment-timing', segmentId: 'segment_000002', start: 3.3, end: 4.8, boundarySource: 'manual' });
store.execute({ type: 'set-safe-zone', zoneId: 'zone_bottom', value: { x: 0.1, y: 0.7, width: 0.8, height: 0.2 } });

const manualBeforeReroll = clone(store.project.plans.segment_000001.manual);
store.execute({ type: 'reroll-segment', segmentId: 'segment_000001' });
assert.deepStrictEqual(store.project.plans.segment_000001.manual, manualBeforeReroll, 'reroll changed manual overrides');
assert.equal(store.project.plans.segment_000001.generated.rerollCount, 1);

store.execute({ type: 'set-segment-animation-disabled', segmentId: 'segment_000001', disabled: true });
assert.equal(J.captionResolvedPlan(store.project.plans.segment_000001).animationDisabled, true);
store.execute({ type: 'set-segment-locks', segmentId: 'segment_000002', locked: true });
assert.equal(store.project.segments[1].locks.segmentation, true);
assert.equal(store.project.segments[1].locks.visualPlan, true);
store.undo();
assert.equal(store.project.segments[1].locks.segmentation, false, 'atomic segment lock did not undo together');

store.execute({ type: 'set-field-lock', segmentId: 'segment_000001', field: 'layout', locked: true });
assert.throws(() => store.execute({ type: 'set-visual-override', segmentId: 'segment_000001', field: 'layout', value: 'blocked' }), error => error.code === 'SEGMENT_FIELD_LOCKED');
store.execute({ type: 'set-field-lock', segmentId: 'segment_000001', field: 'layout', locked: false });
store.execute({ type: 'set-field-lock', segmentId: 'segment_000001', field: 'tokenText', locked: true });
assert.throws(() => store.execute({ type: 'edit-token-text', tokenId: 'word_000001', text: 'blocked' }), error => error.code === 'SEGMENT_FIELD_LOCKED');
store.execute({ type: 'set-field-lock', segmentId: 'segment_000001', field: 'tokenText', locked: false });
store.execute({ type: 'set-segment-lock', segmentId: 'segment_000001', lock: 'segmentation', locked: true });
assert.throws(() => store.execute({ type: 'split-segment', segmentId: 'segment_000001', splitIndex: 2 }), error => error.code === 'SEGMENT_FIELD_LOCKED');

const final = store.snapshot();
let undoCount = 0; while (store.undo()) undoCount++;
assert.ok(undoCount >= 10);
assert.deepStrictEqual(store.project, original, 'undo did not restore the exact project');
while (store.redo()) {}
assert.deepStrictEqual(store.project, final, 'redo did not restore IDs, timings, locks, or overrides exactly');
assert.deepStrictEqual(J.loadProject(store.serialize()), final, 'edited caption project did not round-trip');

const missing = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'invalid-missing-token.json'), 'utf8'));
missing.generatorVersion = 'fixture';
assert.throws(() => J.loadProject(missing), error => error.code === 'SEGMENT_TOKEN_NOT_FOUND' && error.segmentId === 'segment_0001' && error.tokenId === 'word_missing');
const unsafe = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'invalid-unsafe-technique.json'), 'utf8'));
unsafe.generatorVersion = 'fixture'; unsafe.transcript = transcript;
assert.throws(() => J.loadProject(unsafe), error => error.code === 'CAPTION_TECHNIQUE_UNSAFE' && error.componentId === 'fixtureFullFrameFlash');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

const techniqueStore = new J.CaptionStore(clone(project));
assert.equal(techniqueStore.project.techniques, undefined, 'old caption project gained a techniques field');
const filled = J.captionTechniques(techniqueStore.project);
assert.equal(techniqueStore.project.techniques, undefined, 'captionTechniques wrote the project');
assert.deepStrictEqual([filled.extra, filled.wa, filled.typo, filled.kinetic, filled.horror], [false, false, false, false, false]);
assert.deepStrictEqual(Object.keys(filled.enabled), J.GROUP_KEYS);
assert.equal(J.captionTechniqueOn(techniqueStore.project, 'layout', 'knSlamStack'), false);
assert.equal(J.captionTechniqueOn(techniqueStore.project, 'enter', 'captionFade'), true);
assert.equal(J.registry('layout').knSlamStack.capabilities, undefined);
assert.equal(J.registry('layout').knSlamStack.captionSafe, undefined);

const narrowed = Object.assign({}, techniqueStore.project, {
  style: { preset: 'creator', editor: 'advanced', layouts: ['captionBottomStack'], effect: 'captionImpact' },
});
assert.equal(J.captionTechniqueOn(narrowed, 'enter', 'captionFade'), true);
assert.equal(J.captionTechniqueOn(narrowed, 'layout', 'captionCenterStack'), true);
assert.equal(J.captionTechniqueOn(narrowed, 'enter', 'captionImpact'), false);
assert.equal(J.captionTechniqueOn(Object.assign({}, techniqueStore.project, { style: 'punchy' }), 'enter', 'captionImpact'), true);
assert.equal(J.captionTechniqueOn(Object.assign({}, techniqueStore.project, { style: { preset: 'jizura' } }), 'hold', 'captionBreathe'), true);
assert.equal(J.captionTechniqueOn(Object.assign({}, techniqueStore.project, { style: { preset: 'mv' } }), 'enter', 'captionImpact'), true);
assert.equal(J.captionTechniqueOn(techniqueStore.project, 'treat', 'none'), false);

const beforeReject = techniqueStore.snapshot();
const undoBefore = techniqueStore.undoStack.length;
assert.throws(() => techniqueStore.execute({ type: 'set-technique', set: 'lyric', value: true }), error => error.code === 'TECHNIQUE_SET_UNKNOWN');
assert.throws(() => techniqueStore.execute({ type: 'set-technique', set: 'kinetic', value: 'yes' }), error => error.code === 'TECHNIQUE_VALUE_INVALID');
assert.throws(() => techniqueStore.execute({ type: 'set-technique', group: 'active', entries: { pop: true } }), error => error.code === 'TECHNIQUE_GROUP_UNKNOWN');
assert.throws(() => techniqueStore.execute({ type: 'set-technique', group: 'enter', entries: { captionFade: 1 } }), error => error.code === 'TECHNIQUE_VALUE_INVALID');
assert.throws(() => techniqueStore.execute({ type: 'set-technique', group: 'enter', entries: { notATechnique: true } }), error => error.code === 'TECHNIQUE_ID_UNKNOWN');
assert.throws(() => techniqueStore.execute({ type: 'set-technique', set: 'kinetic', value: true, group: 'enter', entries: { pop: true } }), error => error.code === 'TECHNIQUE_COMMAND_INVALID');
assert.deepStrictEqual(techniqueStore.project, beforeReject);
assert.equal(techniqueStore.undoStack.length, undoBefore);

techniqueStore.execute({ type: 'set-technique', group: 'enter', entries: { pop: true, captionFade: false } });
assert.equal(J.captionTechniqueOn(techniqueStore.project, 'enter', 'captionFade'), false);
assert.equal(J.captionTechniqueOn(techniqueStore.project, 'enter', 'pop'), true);
assert.equal(J.registry('enter').pop.capabilities.captionSafe, false);
assert.equal(techniqueStore.undoStack.length, undoBefore + 1);

techniqueStore.execute({ type: 'set-technique', group: 'layout', entries: { knSlamStack: true } });
assert.equal(J.captionTechniqueOn(techniqueStore.project, 'layout', 'knSlamStack'), true);
assert.equal(J.registry('layout').knSlamStack.capabilities, undefined);
assert.equal(J.registry('layout').knSlamStack.captionSafe, undefined);
const planned = J.planCaptions(techniqueStore.project, { width: 1080, height: 1920 });
for (const storedPlan of Object.values(planned.plans)) {
  assert.notEqual(storedPlan.generated.layout, 'knSlamStack');
  assert.notEqual(storedPlan.generated.entrance, 'pop');
}
assert.equal(techniqueStore.undoStack.length, undoBefore + 2);
techniqueStore.undo();
assert.equal(J.captionTechniqueOn(techniqueStore.project, 'layout', 'knSlamStack'), false);
assert.equal(J.captionTechniqueOn(techniqueStore.project, 'enter', 'captionFade'), false);
assert.equal(techniqueStore.project.techniques.enabled.layout, undefined);
techniqueStore.undo();
assert.equal(techniqueStore.project.techniques, undefined);
assert.equal(J.captionTechniqueOn(techniqueStore.project, 'enter', 'captionFade'), true);

techniqueStore.execute({ type: 'set-technique', set: 'kinetic', value: true });
assert.equal(techniqueStore.project.techniques.kinetic, true);
assert.equal(techniqueStore.project.kinetic, undefined);
assert.equal(techniqueStore.project.enabled, undefined);
assert.equal(J.captionTechniques(techniqueStore.project).extra, false);
assert.equal(techniqueStore.project.techniques.extra, undefined);
techniqueStore.undo();
assert.equal(J.captionTechniques(techniqueStore.project).kinetic, false);

const lyricInput = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'lyrics', 'smoke-project.json'), 'utf8'));
const lyricExpected = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'lyrics', 'smoke-plan.json'), 'utf8'));
const lyricProject = Object.assign(J.defaultProject(), lyricInput);
const lyricPlan = J.plan(lyricProject, null);
const lyricActual = {
  duration: lyricPlan.duration,
  lines: lyricPlan.lines.map(({ text, start, end, seed }) => ({ text, start, end, seed })),
  cuts: lyricPlan.cuts.map(({ text, line, start, end, layout, enter, hold, exit, decor, treat, bg, cam, seed }) => ({
    text, line, start, end, layout, enter, hold, exit,
    decor: decor.map(item => item.id), treat, bg, cam, seed,
  })),
};
assert.deepStrictEqual(lyricActual, lyricExpected);

console.log('Gate 1.4 caption store tests passed.');
