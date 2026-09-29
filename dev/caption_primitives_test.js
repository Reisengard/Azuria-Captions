/* Dependency-free tests for Gate 3.2 subtle caption primitives. */
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

const entrances = ['captionFade', 'captionSoftRise', 'captionSoftScale', 'captionWordFade', 'captionSoftReplace'];
for (const id of entrances) {
  const primitive = J.ENTER[id];
  assert.ok(primitive && primitive.capabilities.captionSafe, `${id} is not caption-safe`);
  assert.equal(primitive.capabilities.flashes, false);
  assert.equal(primitive.capabilities.movesCamera, false);
  assert.ok(J.captionCandidates('enter', { duration: 1, wordCount: 4, portrait: true }).includes(id));
}
assert.ok(J.HOLD.captionStill.capabilities.captionSafe);

const env = { W: 1080, H: 1920, fx: { motion: 1 } };
const apply = (id, p) => {
  const item = { x: 400, y: 1400, size: 100, alpha: 1, charFns: [], pieceFns: [] };
  J.ENTER[id].apply(env, item, p, { inDur: 0.6, dur: 1.5 });
  return item;
};
for (const id of ['captionFade', 'captionSoftRise', 'captionSoftScale', 'captionSoftReplace']) {
  const start = apply(id, 0), end = apply(id, 1);
  assert.ok(start.alpha >= 0 && start.alpha <= 1 && end.alpha >= 0 && end.alpha <= 1, `${id} exceeded alpha bounds`);
  assert.equal(end.x, 400, `${id} moved the horizontal anchor`);
  assert.equal(end.y, 1400, `${id} did not settle on its anchor`);
  assert.equal(end.size, 100, `${id} did not settle at its measured size`);
}
const scaled = apply('captionSoftScale', 0);
assert.ok(scaled.size >= 96 && scaled.size <= 100, 'soft scale exceeded the 4% cap');
const risen = apply('captionSoftRise', 0);
assert.ok(risen.y - 1400 <= 18, 'soft rise exceeded the 18px cap');
const wordFade = apply('captionWordFade', 0.5);
assert.equal(wordFade.charFns.length, 1);
for (let i = 0; i < 8; i++) { const value = wordFade.charFns[0](i, null, 8); assert.ok(!value || (value.a >= 0 && value.a <= 1)); }

const activeIds = ['captionActiveColor', 'captionActiveScale', 'captionActiveLift', 'captionActiveWeight', 'captionActiveUnderline'];
assert.deepStrictEqual(J.captionActiveCandidates(), activeIds);
for (const id of activeIds) {
  const style = J.resolveCaptionActiveStyle(id, 'active', { accentColor: '#ff0', scale: 9, lift: 99, weight: 1200 });
  for (const field of ['fontSize', 'size', 'track', 'x', 'y', 'anchor', 'lineBreaks']) assert.equal(style[field], undefined, `${id} can alter geometry`);
}
assert.equal(J.resolveCaptionActiveStyle('captionActiveScale', 'active', { scale: 9 }).scale, 1.04);
assert.equal(J.resolveCaptionActiveStyle('captionActiveLift', 'active', { lift: 99 }).lift, 2);
assert.equal(J.resolveCaptionActiveStyle('captionActiveWeight', 'active', { weight: 1200 }).weight, 900);
assert.deepStrictEqual(J.resolveCaptionActiveStyle('captionActiveColor', 'spoken', { accentColor: '#ff0' }), {});

console.log('Gate 3.2 caption primitive tests passed.');
