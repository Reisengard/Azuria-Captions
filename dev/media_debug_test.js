/* Dependency-free tests for Gate 4.4 development diagnostics overlay. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', '01_util.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', '10e_media_debug.js'), 'utf8'));

const project = { seed: 77, transcript: { tokens: [
  { id: 'same_1', start: 1, end: 1.5 }, { id: 'same_2', start: 1.5, end: 2 },
] }, segments: [{ id: 'segment_a', start: 1, end: 2 }], plans: { segment_a: {
  id: 'plan_segment_a', generated: { seed: 991, zoneId: 'bottom', layout: 'captionBottomStack' }, manual: { layout: 'captionBottomTwoLine' },
} } };
const capabilities = { summary: { preview: true, preciseFrameCallbacks: true, selectedCodecsSupported: false, workerCanvas: true, fileBackedSave: false } };
const snapshot = J.mediaDebugSnapshot({ mediaTime: 1.75, metadata: { presentationTime: 250.5, presentedFrames: 42 }, project,
  previewDiagnostics: { previewScale: 0.5, droppedCallbacks: 3 }, capabilities });
assert.equal(snapshot.activeSegmentId, 'segment_a');
assert.equal(snapshot.activeTokenId, 'same_2');
assert.equal(snapshot.planId, 'plan_segment_a');
assert.equal(snapshot.seed, 991);
assert.equal(snapshot.layout, 'captionBottomTwoLine');
assert.equal(snapshot.zone, 'bottom');
assert.equal(snapshot.droppedCallbacks, 3);
assert.match(snapshot.capabilities, /preview:yes/);
assert.match(snapshot.capabilities, /codecs:no/);
assert.equal(J.mediaDebugLines(snapshot).length, 6);
assert.equal(J.mediaDebugEnabled({ URLSearchParams, location: { search: '?jizuraDebug=1' } }), true);
assert.equal(J.mediaDebugEnabled({ URLSearchParams, location: { search: '' } }), false);

const calls = [];
const ctx = { save() { calls.push('save'); }, restore() { calls.push('restore'); }, measureText: text => ({ width: text.length * 8 }),
  fillRect() { calls.push('rect'); }, fillText(text) { calls.push(text); }, globalAlpha: 0, globalCompositeOperation: '', filter: '', font: '', textAlign: '', textBaseline: '', fillStyle: '' };
const hidden = new J.MediaDebugOverlay({ enabled: false });
assert.equal(hidden.draw(ctx, { mediaTime: 1 }), null); assert.equal(calls.length, 0, 'disabled diagnostics drew into a production frame');
const visible = new J.MediaDebugOverlay({ enabled: true });
assert.equal(visible.draw(ctx, { mediaTime: 1.25, project }).mediaTime, 1.25);
assert.ok(calls.includes('rect')); assert.ok(calls.some(value => typeof value === 'string' && value.startsWith('media ')));
console.log('Gate 4.4 media debug overlay tests passed.');
