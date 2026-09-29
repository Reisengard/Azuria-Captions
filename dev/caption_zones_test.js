/* Dependency-free tests for Gate 2.3 zones and readability. */
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

const frame = { width: 1080, height: 1920 };
const safe = J.captionSocialSafeRect(frame);
assert.ok(safe.x > 0 && safe.y > 0 && safe.x + safe.width < frame.width && safe.y + safe.height < frame.height, 'portrait social inset is missing');
const zones = ['top', 'center', 'bottom'].map(kind => J.createCaptionZone(kind, frame));
assert.deepStrictEqual(zones.map(zone => zone.kind), ['top', 'center', 'bottom']);
assert.ok(zones[0].y < zones[1].y && zones[1].y < zones[2].y);
assert.ok(zones.every(zone => zone.preset === 'vertical-social-safe'));

const original = zones[2];
const edited = J.editCaptionZoneRect(original, { x: 100, y: 1200, width: 800, height: 300 }, frame);
assert.equal(original.kind, 'bottom', 'manual editing mutated the source zone');
assert.deepStrictEqual({ kind: edited.kind, x: edited.x, y: edited.y, width: edited.width, height: edited.height }, { kind: 'custom', x: 100, y: 1200, width: 800, height: 300 });
const clamped = J.editCaptionZoneRect(original, { x: 1000, y: 1850, width: 500, height: 500 }, frame);
assert.equal(clamped.x + clamped.width, frame.width); assert.equal(clamped.y + clamped.height, frame.height);
const edge = J.editCaptionZoneRect(original, { x: frame.width, y: frame.height, width: 20, height: 20 }, frame);
assert.deepStrictEqual({ x: edge.x, y: edge.y, width: edge.width, height: edge.height }, { x: 1079, y: 1919, width: 1, height: 1 });
assert.throws(() => J.createCaptionZone('custom', frame, { id: 'bad', rect: { x: -1, y: 0, width: 10, height: 10 } }), error => error.code === 'CAPTION_ZONE_RECT_INVALID');

const base = { id: 'candidate-safe', text: 'Captions stay in sync.', zone: original, fontSize: 72, maxLines: 2, duration: 1.8,
  textColor: '#ffffff', backgroundColor: '#101010', contrastStrategy: 'none', stableAnchor: true };
const readable = J.evaluateCaptionReadability(base, { frame });
assert.equal(readable.allowed, true); assert.equal(readable.reasons.length, 0); assert.ok(readable.contrastRatio >= 4.5);

const small = J.evaluateCaptionReadability(Object.assign({}, base, { fontSize: 28 }), { frame });
assert.ok(small.reasons.includes('font-too-small'));
const crowded = J.evaluateCaptionReadability(Object.assign({}, base, { zone: edited, text: 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen', fontSize: 90, maxLines: 1 }), { frame });
assert.ok(crowded.reasons.includes('too-many-lines'));
const short = J.evaluateCaptionReadability(Object.assign({}, base, { duration: 0.1 }), { frame });
assert.ok(short.reasons.includes('duration-incompatible'));
const lowContrast = J.evaluateCaptionReadability(Object.assign({}, base, { textColor: '#777777', backgroundColor: '#777777' }), { frame });
assert.ok(lowContrast.reasons.includes('contrast-insufficient'));
const assisted = J.evaluateCaptionReadability(Object.assign({}, base, { textColor: '#777777', backgroundColor: '#777777', contrastStrategy: 'backplate' }), { frame });
assert.equal(assisted.allowed, true); assert.ok(assisted.warnings.includes('contrast-assisted'));
const unstable = J.evaluateCaptionReadability(Object.assign({}, base, { activeStates: [
  { anchor: { x: 200, y: 1400 }, lineBreaks: [2] }, { anchor: { x: 201, y: 1400 }, lineBreaks: [2] },
] }), { frame });
assert.ok(unstable.reasons.includes('unstable-anchor'));

const filtered = J.filterReadableCaptionCandidates([base, Object.assign({}, base, { id: 'bad-short', duration: 0.1 })], { frame });
assert.deepStrictEqual(filtered.accepted.map(item => item.candidate.id), ['candidate-safe']);
assert.deepStrictEqual(filtered.rejected.map(item => item.candidate.id), ['bad-short']);
assert.ok(filtered.rejected[0].readability.reasons.includes('duration-incompatible'));

assert.equal(J.captionContrastRatio('#fff', '#000'), 21);
assert.equal(J.measureCaptionInZone('字幕は同期する', zones[1], { fontSize: 72, maxLines: 2 }).fits, true);
console.log('Gate 2.3 caption zone and readability tests passed.');
