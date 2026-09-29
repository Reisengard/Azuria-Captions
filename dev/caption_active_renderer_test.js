/* Dependency-free tests for Gate 3.4 active-word rendering. */
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

const tokens = [
  { id: 'a', text: 'go', start: 1, end: 1.5 },
  { id: 'b', text: 'go', start: 1.6, end: 2 },
  { id: 'c', text: 'now!', start: 2.1, end: 2.8 },
];
assert.deepStrictEqual(J.captionTokenStatesAt(tokens, 0.5).tokens.map(t => t.state), ['upcoming', 'upcoming', 'upcoming']);
assert.deepStrictEqual(J.captionTokenStatesAt(tokens, 1.2).tokens.map(t => t.state), ['active', 'upcoming', 'upcoming']);
assert.deepStrictEqual(J.captionTokenStatesAt(tokens, 1.5).tokens.map(t => t.state), ['spoken', 'upcoming', 'upcoming']);
assert.deepStrictEqual(J.captionTokenStatesAt(tokens, 1.7).tokens.map(t => t.state), ['spoken', 'active', 'upcoming']);
assert.deepStrictEqual(J.captionTokenStatesAt(tokens, 3).tokens.map(t => t.state), ['spoken', 'spoken', 'spoken']);
assert.equal(J.captionTokenStatesAt(tokens, 1.25).tokens[0].progress, 0.5);
assert.throws(() => J.captionTokenStatesAt(tokens, NaN), error => error.code === 'CAPTION_CLOCK_INVALID');

const repeated = J.captionGlyphStatesAt('go go\nnow!', tokens, 1.7);
assert.deepStrictEqual(repeated.glyphs.map(t => t && t.id), ['a', 'a', null, 'b', 'b', 'c', 'c', 'c', 'c']);
assert.equal(repeated.timeline.activeTokenId, 'b', 'repeated words were matched by text instead of token ID/order');

const geometry = { zone: J.createCaptionZone('bottom', { width: 1080, height: 1920 }), frame: { width: 1080, height: 1920 }, text: 'go go now!', font: 'gothic', fontSize: 76 };
const before = J.LAYOUTS.captionBottomTwoLine.measure(geometry);
const during = J.LAYOUTS.captionBottomTwoLine.measure(Object.assign({}, geometry, { activeTokenId: 'b' }));
assert.deepStrictEqual(during.anchor, before.anchor); assert.deepStrictEqual(during.lineBreaks, before.lineBreaks);

const prepare = treatment => {
  const item = { text: 'go go\nnow!', font: 'gothic', size: 76, x: 500, y: 1400, color: '#fff', charFns: [], pieceFns: [],
    captionActive: { tokens, clockTime: 1.7, treatment, accentColor: '#ff0' } };
  J.prepareCaptionActiveItem({ sc: { accent: '#ff0' } }, item);
  return { item, style: item.charFns[0] };
};
let prepared = prepare('captionActiveColor');
assert.equal(prepared.style(3).color, '#ff0'); assert.equal(prepared.style(0), null);
prepared = prepare('captionActiveScale'); assert.equal(prepared.style(3).s, 1.04);
prepared = prepare('captionActiveLift'); assert.equal(prepared.style(3).dy, -2);
prepared = prepare('captionActiveWeight'); assert.equal(prepared.style(3).weight, 700);

const underline = prepare('captionActiveUnderline').item;
const lines = [];
underline.post({ line: (...args) => lines.push(args) }, underline, { boxes: Array.from({ length: 8 }, (_, i) => ({ x: i * 20, y: 0, w: 18, h: 70 })) });
assert.equal(lines.length, 2, 'underline did not cover exactly the active repeated word');

/* State is based only on timestamps, not frame rate or sample history. */
for (const fps of [24, 30, 60]) {
  const time = 1 + Math.round(0.25 * fps) / fps;
  assert.equal(J.captionTokenStatesAt(tokens, time).activeTokenId, 'a');
}

console.log('Gate 3.4 active-word renderer tests passed.');
