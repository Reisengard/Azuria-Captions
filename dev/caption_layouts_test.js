/* Dependency-free tests for Gate 3.1 caption layouts. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({ measureText: text => ({ width: Array.from(String(text)).length * 57 }) }) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

const ids = ['captionBottomStack', 'captionBottomTwoLine', 'captionCenterStack', 'captionSingleWordHero', 'captionLeftAnchor', 'captionRightAnchor', 'captionTwoLinePunch'];
const frame = { width: 1080, height: 1920 };
const zone = J.createCaptionZone('bottom', frame);
for (const id of ids) {
  const layout = J.LAYOUTS[id];
  assert.ok(layout, `${id} was not registered`);
  assert.equal(layout.capabilities.captionSafe, true);
  assert.equal(J.captionComponentEligibility('layout', id, { duration: 1.5, wordCount: id === 'captionSingleWordHero' ? 1 : 4, portrait: true }).allowed, true);
  const input = { text: id === 'captionSingleWordHero' ? 'LOUD' : 'Captions remain readable and stable', font: 'gothic', fontSize: 76, zone, frame };
  const normal = layout.measure(input), active = layout.measure(Object.assign({}, input, { activeTokenId: 'tok_2' }));
  assert.equal(normal.diagnostics.fits, true, `${id} overflowed its zone`);
  assert.ok(normal.lines.length <= normal.diagnostics.maxLines);
  assert.deepStrictEqual(active.anchor, normal.anchor, `${id} moved when the active word changed`);
  assert.deepStrictEqual(active.lineBreaks, normal.lineBreaks, `${id} reflowed when the active word changed`);
  assert.ok(normal.anchor.x >= zone.x && normal.anchor.x <= zone.x + zone.width);
  assert.ok(normal.anchor.y >= zone.y && normal.anchor.y <= zone.y + zone.height);

  const drawn = [], originalMainDraw = J.mainDraw;
  J.mainDraw = (_env, item) => { drawn.push(item); return { x0: item.x - 10, x1: item.x + 10, y0: item.y - 10, y1: item.y + 10, cx: item.x, cy: item.y, boxes: [] }; };
  const box = layout.render({ zone, cut: { text: input.text, params: { font: input.font, fontSize: input.fontSize } }, st: { fonts: { body: ['gothic'] } }, sc: { fg: '#fff' } });
  J.mainDraw = originalMainDraw;
  assert.equal(drawn.length, 1, `${id} did not draw its resolved caption block`);
  assert.ok(box && box.cx >= zone.x && box.cx <= zone.x + zone.width, `${id} rendered outside its zone`);
}

assert.equal(J.LAYOUTS.captionLeftAnchor.measure({ text: 'Left side', font: 'gothic', fontSize: 76, zone, frame }).anchor.align, 'left');
// An explicit alignment overrides the layout's own and moves the anchor to that edge of the box; none keeps the layout's alignment.
{
  const at = (id, alignment) => J.LAYOUTS[id].measure({ text: 'Align me', font: 'gothic', fontSize: 76, zone, frame, alignment }).anchor;
  const left = at('captionBottomStack', 'left'), center = at('captionBottomStack', 'center'), right = at('captionBottomStack', 'right');
  assert.deepEqual([left.align, center.align, right.align], ['left', 'center', 'right']);
  assert.ok(left.x < center.x && center.x < right.x);
  assert.equal(at('captionLeftAnchor', 'right').align, 'right');
  assert.equal(at('captionLeftAnchor', undefined).align, 'left');
  assert.equal(at('captionBottomStack', 'justify').align, 'center');
}
assert.equal(J.LAYOUTS.captionRightAnchor.measure({ text: 'Right side', font: 'gothic', fontSize: 76, zone, frame }).anchor.align, 'right');
assert.equal(J.captionComponentEligibility('layout', 'captionSingleWordHero', { duration: 1, wordCount: 2 }).code, 'COMPONENT_WORD_LIMIT_EXCEEDED');

const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8');
const transcript = J.importWordJson(raw, { duration: 15 });
const segmented = J.segmentCaptions(transcript, { duration: 15, safeZone: { width: 850 } });
const planned = J.planCaptions({
  schemaVersion: 2, generatorVersion: 'test', id: 'caption-layout-project', mode: 'video-captions', seed: 3107,
  media: { duration: 15, width: 1080, height: 1920 }, transcript, segments: segmented.segments,
  style: { preset: 'creator' }, plans: {}, safeZones: [], settings: {},
});
assert.ok(Object.values(planned.plans).some(plan => ids.includes(plan.generated.layout)), 'planner did not consume registered caption layouts');

console.log('Gate 3.1 caption layout tests passed.');
