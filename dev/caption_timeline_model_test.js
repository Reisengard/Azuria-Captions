/* Rework plan T1: the pure timeline maths (src/12bp_caption_timeline_model.js). */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
vm.runInThisContext('var J = globalThis.J = globalThis.J || {};');
const filename = path.join(root, 'src', '12bp_caption_timeline_model.js');
vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
const TL = J.captionTimeline, near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} != ${b}`);

// time <-> pixel
near(TL.timeToX(2.5, 100), 250); near(TL.xToTime(250, 100, 15), 2.5);
near(TL.xToTime(5000, 100, 15), 15); near(TL.xToTime(-5, 100, 15), 0);

// zoom limits: fit is the lowest, MAX_PPS the highest
near(TL.fitPps(15, 600), 40); assert.equal(TL.fitPps(0, 600), 1);
near(TL.clampPps(1, 15, 600), 40); near(TL.clampPps(9999, 15, 600), TL.MAX_PPS);
near(TL.clampScroll(-10, 15, 100, 600), 0); near(TL.clampScroll(5000, 15, 100, 600), 900); near(TL.clampScroll(10, 15, 40, 600), 0);

// zoom about an anchor keeps the time under the anchor in place
{
  const before = { pps: 40, scrollLeft: 0 }, anchorX = 300, timeBefore = (before.scrollLeft + anchorX) / before.pps;
  const after = TL.zoomAround(before, 4, anchorX, 15, 600);
  near(after.pps, 160); near((after.scrollLeft + anchorX) / after.pps, timeBefore);
  const out = TL.zoomAround(after, .01, anchorX, 15, 600);
  near(out.pps, 40); near(out.scrollLeft, 0);
  const edge = TL.zoomAround({ pps: 40, scrollLeft: 0 }, 10, 0, 15, 600);
  near(edge.scrollLeft, 0);   // the start stays at the start
  const end = TL.zoomAround({ pps: 40, scrollLeft: 0 }, 10, 599, 15, 600);
  assert.ok(end.scrollLeft <= TL.contentWidth(15, end.pps) - 600 + 1e-6, 'scroll runs past the end');
}

// ruler ticks: labelled steps stay at least TICK_MIN_PX apart, labels match the step
for (const pps of [4, 40, 100, 400]) {
  const { major, minor } = TL.tickStep(pps); assert.ok(major * pps >= TL.TICK_MIN_PX, `pps ${pps}`); assert.ok(minor < major);
  const ticks = TL.rulerTicks(pps, 0, 15, 15);
  assert.ok(ticks.length > 1 && ticks[0].time === 0 && ticks[0].major && ticks[0].label);
  for (const tick of ticks) assert.ok(tick.time >= 0 && tick.time <= 15 + 1e-9);
  assert.deepEqual(ticks.map(tick => tick.time), ticks.map(tick => tick.time).slice().sort((a, b) => a - b));
}
assert.equal(TL.tickStep(40).major, 2);
assert.equal(TL.formatTick(75, 5), '1:15'); assert.equal(TL.formatTick(3.4, .1), '0:03.4'); assert.equal(TL.formatTick(3.45, .05), '0:03.45'); assert.equal(TL.formatTick(0, 1), '0:00');
{ const range = TL.rulerTicks(100, 5, 8, 15); assert.ok(range[0].time >= 4.5 && range[range.length - 1].time <= 8.01); }

// blocks and culling
assert.deepEqual(TL.blockRect({ start: 1, end: 2.5 }, 100), { left: 100, width: 150 });
assert.equal(TL.blockRect({ start: 1, end: 1.001 }, 10).width, 2);
const range = TL.visibleRange(500, 600, 100, 15, 100);
near(range.from, 4); near(range.to, 12);
assert.ok(TL.overlapsRange({ start: 11, end: 13 }, range)); assert.ok(!TL.overlapsRange({ start: 13, end: 14 }, range)); assert.ok(!TL.overlapsRange({ start: 0, end: 3 }, range));
assert.ok(!TL.wordTicksVisible(20) && TL.wordTicksVisible(40) && !TL.wordLabelsVisible(60) && TL.wordLabelsVisible(80));

// follow: stays while the playhead is inside, pages when it leaves
assert.equal(TL.followScroll(0, 600, 300, 15, 100), 0);
near(TL.followScroll(0, 600, 590, 15, 100), 530);
near(TL.followScroll(900, 600, 100, 15, 100), 40);
near(TL.followScroll(0, 600, 1500, 15, 100), 900);   // clamped to the end
console.log('Caption timeline model tests passed.');

// T6: waveform peaks and columns, strip height
{
  const sr = 1000, a = new Float32Array(1000), b = new Float32Array(1000); a[5] = .5; a[995] = -1; b[15] = .8;
  const peaks = TL.waveformPeaks([a, b], sr, 100);   // 10 samples per bucket
  assert.equal(peaks.length, 100); near(peaks[0], .5); near(peaks[1], .8); near(peaks[99], 1); near(peaks[50], 0);
  const cols = TL.waveformColumns(peaks, 100, 50, 0, 100);   // 50 px/s → 2 px per second... 1 px = 0.02 s = 2 buckets
  assert.equal(cols.length, 100); near(cols[0], .8); near(cols[49], 1); near(cols[99], 0);
  assert.ok(cols.every(v => v >= 0 && v <= 1)); assert.equal(TL.waveformColumns(new Float32Array(10), 100, 50, 0, 20).every(v => v === 0), true);
  near(TL.waveformColumns(peaks, 100, 50, 10000, 5)[0], 0);   // past the end → silence
  assert.ok(TL.waveformAllowed(30, 1e6)); assert.ok(!TL.waveformAllowed(601, 1e6)); assert.ok(!TL.waveformAllowed(0, 1));
  assert.equal(TL.clampStripHeight(10, 900), TL.STRIP_MIN); assert.equal(TL.clampStripHeight(5000, 900), 630); assert.equal(TL.clampStripHeight(200.4, 900), 200);
}
