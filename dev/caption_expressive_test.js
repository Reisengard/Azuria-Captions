/* Dependency-free tests for Gate 3.3 reviewed expressive subset. */
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

for (const key of ['enter.pop', 'enter.type', 'enter.blur', 'enter.wipe', 'hold.drift', 'hold.breathe', 'exit.shrink']) {
  const review = J.CAPTION_COMPONENT_REVIEW[key];
  assert.ok(review && review.captionSafe === false, `${key} was not explicitly reviewed`);
  assert.notEqual(J.captionComponentEligibility(review.group, review.id).allowed, true, `${key} became caption selectable`);
}
for (const id of ['typeSpecimen', 'quote', 'lowerThird']) if (J.LAYOUTS[id]) assert.equal(J.CAPTION_COMPONENT_REVIEW[`layout.${id}`].reason, 'not-zone-aware');

const wrappers = [
  ['enter', 'captionType'], ['enter', 'captionBlur'], ['enter', 'captionWipe'], ['enter', 'captionImpact'],
  ['hold', 'captionBreathe'], ['exit', 'captionFadeOut'], ['exit', 'captionShrinkOut'],
];
for (const [group, id] of wrappers) {
  const def = J.registry(group)[id];
  assert.ok(def && def.capabilities.captionSafe, `${group}.${id} is not caption safe`);
  assert.equal(def.capabilities.flashes, false); assert.equal(def.capabilities.requiresFullFrame, false);
}

const item = () => ({ x: 500, y: 1200, size: 100, alpha: 1, charFns: [], pieceFns: [], text: 'Impact', font: 'gothic', align: 'center' });
const impactStart = item(); J.ENTER.captionImpact.apply({}, impactStart, 0);
const impactEnd = item(); J.ENTER.captionImpact.apply({}, impactEnd, 1);
assert.equal(impactStart.size, 90); assert.equal(impactEnd.size, 100); assert.equal(impactEnd.y, 1200);
const blurStart = item(); J.ENTER.captionBlur.apply({}, blurStart, 0); assert.equal(blurStart.blur, 8);
const breathe = item(); J.HOLD.captionBreathe.apply({ lt: 0.455 }, breathe, 1); assert.ok(breathe.size >= 98.8 && breathe.size <= 101.2);
const shrink = item(); J.EXIT.captionShrinkOut.apply({}, shrink, 1); assert.equal(shrink.size, 92); assert.equal(shrink.alpha, 0);

const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8');
const transcript = J.importWordJson(raw, { duration: 15 });
const segments = J.segmentCaptions(transcript, { duration: 15, safeZone: { width: 850 } }).segments;
const base = { schemaVersion: 2, generatorVersion: 'test', mode: 'video-captions', id: 'profiles', media: { duration: 15, width: 1080, height: 1920 }, transcript, segments, plans: {}, safeZones: [], seed: 3107, settings: {} };
const creator = J.planCaptions(Object.assign({}, base, { style: { preset: 'creator' } }));
assert.ok(Object.values(creator.plans).every(stored => !['captionImpact', 'captionType', 'captionBlur', 'captionWipe'].includes(stored.generated.entrance)), 'Creator selected expressive motion');
const punchyAllowed = J.ENTER.captionImpact.captionProfiles;
assert.deepStrictEqual(punchyAllowed, ['punchy', 'jizura-mv']);
assert.deepStrictEqual(J.ENTER.captionType.captionProfiles, ['jizura-mv']);

console.log('Gate 3.3 expressive review tests passed.');
