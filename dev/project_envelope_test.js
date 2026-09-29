/* Dependency-free tests for the Gate 1.1 project envelope. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = {
  fonts: { check: () => true, add: () => {}, ready: Promise.resolve() },
  createElement: () => ({ getContext: () => ({}) }),
};
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js').sort()) {
  const filename = path.join(root, 'src', name);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'lyrics', 'smoke-project.json'), 'utf8'));
const beforeLegacy = JSON.stringify(legacy);
const migrated = J.loadProject(legacy);
assert.equal(JSON.stringify(legacy), beforeLegacy, 'legacy migration mutated its input');
assert.equal(migrated.schemaVersion, 3);
assert.equal(migrated.mode, 'lyrics');
assert.equal(migrated.generatorVersion, '@VERSION@');

const legacyPlan = J.plan(Object.assign(J.defaultProject(), legacy), null);
const migratedPlan = J.plan(Object.assign(J.defaultProject(), migrated), null);
assert.deepStrictEqual(migratedPlan, legacyPlan, 'lyric mode dispatch changed planner output');

const captionV2 = {
  schemaVersion: 2,
  generatorVersion: 'caption-mvp-1',
  mode: 'video-captions',
  id: 'project_round_trip',
  media: { name: 'fixture.mp4', duration: 15, relinkRequired: true },
  transcript: { language: 'en', timingQuality: 'word', tokens: [{ id: 'word_1', text: 'Hello', normalizedText: 'hello', start: 0, end: 0.4, confidence: 1, source: 'fixture', timingQuality: 'word', speakerId: null, emphasis: { score: 0, reasons: [] }, manualEmphasis: null }] },
  segments: [], style: { preset: 'clean' }, plans: {}, safeZones: [], seed: 42,
  settings: { customFutureSafeField: { preserved: true } },
  createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
};
const captionV2Before = JSON.stringify(captionV2);
const caption = J.loadProject(captionV2);
assert.equal(JSON.stringify(captionV2), captionV2Before, 'v2 -> v3 migration mutated its input');
assert.equal(caption.schemaVersion, 3);
assert.equal(caption.tracks.length, 1, 'migration must add exactly one track');
assert.equal(caption.tracks[0].id, J.CAPTION_PRIMARY_TRACK_ID);
assert.equal(caption.tracks[0].primary, true);
assert.deepStrictEqual(J.loadProject(J.saveProject(caption)), caption, 'caption round-trip lost data');
assert.deepStrictEqual(J.loadProject(caption), caption, 'v3 load is not idempotent');

const importedCaption = JSON.parse(JSON.stringify(caption));
importedCaption.media = { name: 'fixture.mp4', size: 1234, lastModified: 99, fingerprint: 'sha256-fixture',
  duration: 15, width: 1080, height: 1920, relinkRequired: false, objectUrl: 'blob:must-not-save', runtimeOnly: { video: true } };
const reopenedCaption = J.loadProject(J.saveProject(importedCaption));
assert.equal(reopenedCaption.media.relinkRequired, true, 'saved local media did not require relinking');
assert.equal(Object.hasOwn(reopenedCaption.media, 'objectUrl'), false, 'project embedded an object URL');
assert.equal(Object.hasOwn(reopenedCaption.media, 'runtimeOnly'), false, 'project embedded runtime media state');

const future = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'invalid-unknown-schema.json'), 'utf8'));
const beforeFuture = JSON.stringify(future);
assert.throws(() => J.loadProject(future), error => error.code === 'UNSUPPORTED_SCHEMA_VERSION' && error.schemaVersion === 999);
assert.equal(JSON.stringify(future), beforeFuture, 'future-version rejection mutated its input');

const dispatchProbe = { marker: 'caption-dispatch' };
J.planCaptions = (project, media) => ({ project, media, dispatchProbe });
assert.equal(J.plan(caption, 'media').dispatchProbe, dispatchProbe);
delete J.planCaptions;
assert.throws(() => J.plan(caption, null), error => error.code === 'CAPTION_PLANNER_UNAVAILABLE');

console.log('Gate 1.1 project envelope tests passed.');
