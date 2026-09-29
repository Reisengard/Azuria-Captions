/* Dependency-free tests for Gate 3.5 caption style profiles. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({ measureText: text => ({ width: String(text).length * 57 }) }) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8');
const transcript = J.importWordJson(raw, { duration: 15 });
const base = { schemaVersion: 2, generatorVersion: 'test', mode: 'video-captions', id: 'profile-project', media: { duration: 15, width: 1080, height: 1920 }, transcript, segments: [], plans: {}, safeZones: [], seed: 3107, settings: {} };
const plan = profile => J.planCaptions(Object.assign({}, base, { style: { preset: profile } }));
const creator = plan('creator'), punchy = plan('punchy'), jizura = plan('jizura-mv');

assert.equal(creator.profile, 'creator'); assert.equal(punchy.profile, 'punchy'); assert.equal(jizura.profile, 'jizura-mv');
assert.ok(punchy.segments.length >= creator.segments.length, 'Punchy did not produce shorter/equal caption groups');
assert.ok(punchy.segments.every(segment => segment.tokenIds.length <= 4), 'Punchy exceeded its four-word target ceiling');

const generated = result => Object.values(result.plans).map(stored => stored.generated);
for (const item of generated(creator)) {
  assert.ok(J.CAPTION_STYLE_PROFILES.creator.layouts.includes(item.layout), `Creator selected ${item.layout}`);
  assert.ok(J.CAPTION_STYLE_PROFILES.creator.entrances.includes(item.entrance));
  assert.ok(J.CAPTION_STYLE_PROFILES.creator.activeTreatments.includes(item.activeWordTreatment));
  assert.ok(item.motionSummary.intensity <= 1); assert.equal(item.allowFullFrame, false);
  assert.ok(!['captionImpact', 'captionType', 'captionBlur', 'captionWipe'].includes(item.entrance));
}
for (const item of generated(punchy)) {
  assert.ok(J.CAPTION_STYLE_PROFILES.punchy.layouts.includes(item.layout));
  assert.ok(J.CAPTION_STYLE_PROFILES.punchy.entrances.includes(item.entrance));
  assert.ok(J.CAPTION_STYLE_PROFILES.punchy.activeTreatments.includes(item.activeWordTreatment));
  assert.ok(item.motionSummary.intensity <= 2); assert.equal(item.allowFullFrame, false);
  assert.ok(!['captionType', 'captionBlur', 'captionWipe'].includes(item.entrance));
}
for (const item of generated(jizura)) {
  assert.ok(J.CAPTION_STYLE_PROFILES['jizura-mv'].layouts.includes(item.layout));
  assert.ok(J.CAPTION_STYLE_PROFILES['jizura-mv'].entrances.includes(item.entrance));
  assert.ok(J.CAPTION_STYLE_PROFILES['jizura-mv'].activeTreatments.includes(item.activeWordTreatment));
  assert.ok(item.motionSummary.intensity <= 3); assert.equal(item.allowFullFrame, false);
}

const alias = plan('mv'); assert.equal(alias.profile, 'jizura-mv');
const unknown = plan('not-a-profile'); assert.equal(unknown.profile, 'creator');
const optedIn = J.planCaptions(Object.assign({}, base, { style: { preset: 'jizura-mv', allowFullFrame: true } }));
assert.ok(generated(optedIn).every(item => item.allowFullFrame === true), 'explicit full-frame opt-in was discarded');

/* Profile output remains deterministic, including active treatment selection. */
assert.deepStrictEqual(plan('creator'), creator);
assert.deepStrictEqual(plan('punchy'), punchy);
assert.deepStrictEqual(plan('jizura-mv'), jizura);

console.log(`Gate 3.5 profile tests passed (Creator ${creator.segments.length}, Punchy ${punchy.segments.length}, JIZURA/MV ${jizura.segments.length} segments).`);
