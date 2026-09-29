/* Dependency-free tests for Gate 1.3 component capability metadata. */
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

const legacyKey = J.LAYOUT_ORDER.find(key => !J.LAYOUTS[key].capabilities);
assert.ok(legacyKey, 'expected an unreviewed legacy layout');
assert.ok(J.order('layout').includes(legacyKey), 'legacy layout disappeared from lyric registry');
assert.equal(J.captionComponentEligibility('layout', legacyKey).code, 'COMPONENT_CAPABILITIES_UNREVIEWED');
assert.ok(!J.captionCandidates('layout').includes(legacyKey), 'caption picker selected an unreviewed component');

const safe = {
  name: 'Fixture safe layout', intensity: 1, motionCost: 0.2, attentionCost: 0.1,
  captionSafe: true, liveSafe: true, minDuration: 0.4, preferredDuration: 1.2, maxWords: 8,
  portraitFriendly: true, emojiSafe: true, requiresFullFrame: false, flashes: false, movesCamera: false,
  incompatibleComponentIds: ['enter.fixtureUnsafe'], incompatibleCategories: ['flash'], plan() {}, draw() {},
};
J.register('layout', 'fixtureCaptionSafe', safe, 'test');
assert.ok(J.captionCandidates('layout', { duration: 1, wordCount: 4, portrait: true }).includes('fixtureCaptionSafe'));
assert.equal(J.captionComponentEligibility('layout', 'fixtureCaptionSafe', { duration: 0.2 }).code, 'COMPONENT_DURATION_TOO_SHORT');
assert.equal(J.captionComponentEligibility('layout', 'fixtureCaptionSafe', { wordCount: 9 }).code, 'COMPONENT_WORD_LIMIT_EXCEEDED');
assert.equal(J.captionComponentEligibility('layout', 'fixtureCaptionSafe', { selected: [{ group: 'enter', key: 'fixtureUnsafe' }] }).code, 'COMPONENT_ID_INCOMPATIBLE');
assert.equal(J.captionComponentEligibility('layout', 'fixtureCaptionSafe', { selected: [{ category: 'flash', id: 'anything' }] }).code, 'COMPONENT_CATEGORY_INCOMPATIBLE');

const unsafe = Object.assign({}, safe, { name: 'Fixture unsafe layout', captionSafe: false });
J.register('layout', 'fixtureCaptionUnsafe', unsafe, 'test');
assert.equal(J.captionComponentEligibility('layout', 'fixtureCaptionUnsafe').code, 'COMPONENT_NOT_CAPTION_SAFE');

const liveUnsafe = Object.assign({}, safe, { name: 'Fixture live-unsafe layout', liveSafe: false });
J.register('layout', 'fixtureLiveUnsafe', liveUnsafe, 'test');
assert.equal(J.captionComponentEligibility('layout', 'fixtureLiveUnsafe', { live: true }).code, 'COMPONENT_NOT_LIVE_SAFE');

assert.throws(() => J.register('layout', 'fixtureBroken', {
  name: 'Fixture broken component', intensity: 7,
}, 'test'), error => error.code === 'COMPONENT_METADATA_INVALID' && error.componentId === 'fixtureBroken' && /layout\.fixtureBroken/.test(error.message));
assert.equal(J.LAYOUTS.fixtureBroken, undefined, 'invalid registration mutated the registry');

console.log('Gate 1.3 component metadata tests passed.');
