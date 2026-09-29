/* Dependency-free tests for Gate 2.1 caption segmentation. */
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
const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8'));
const transcript = J.importWordJson(fixture, { duration: 15 });

const assertPartition = (result, source = transcript.tokens) => {
  const ids = result.segments.flatMap(segment => segment.tokenIds);
  assert.deepStrictEqual(ids, source.map(token => token.id), 'tokens were lost, duplicated, or reordered');
  assert.equal(new Set(ids).size, ids.length, 'a token belongs to more than one segment');
  for (let index = 0; index < result.segments.length; index++) {
    const segment = result.segments[index];
    assert.ok(segment.start >= 0 && segment.end > segment.start && segment.end <= 15);
    if (index) assert.ok(segment.start >= result.segments[index - 1].end, 'segments overlap');
    assert.ok(Array.isArray(segment.boundaryReasons) && segment.boundaryReasons.length, 'selected boundary lacks an explanation');
  }
};

const first = J.segmentCaptions(transcript, { duration: 15, safeZone: { width: 820 } });
assertPartition(first);
assert.deepStrictEqual(J.segmentCaptions(transcript, { duration: 15, safeZone: { width: 820 } }), first, 'segmentation is not deterministic');
assert.ok(first.segments.some(segment => segment.boundaryReasons.includes('sentence-ending') || segment.boundaryReasons.includes('punctuation')));

const lockedBase = structuredClone(first.segments[1]);
lockedBase.boundarySource = 'manual'; lockedBase.locks.segmentation = true;
const replanned = J.segmentCaptions(transcript, { duration: 15, safeZone: { width: 500 }, existingSegments: [lockedBase] });
const preserved = replanned.segments.find(segment => segment.id === lockedBase.id);
assert.ok(preserved, 'locked/manual segment boundaries were not preserved');
assert.deepStrictEqual(preserved.tokenIds, lockedBase.tokenIds);
assert.equal(preserved.start, lockedBase.start); assert.equal(preserved.end, lockedBase.end);
assert.ok(replanned.diagnostics.forcedBoundaries.length >= 1);
assertPartition(replanned);

const makeTranscript = (texts, gap, wordDuration = 0.22, language = 'en') => ({
  schemaVersion: 1, language, timingQuality: 'word', tokens: texts.map((text, index) => {
    const start = index * (wordDuration + gap); return J.canonicalToken({ id: `case_${index}`, text, start, end: start + wordDuration }, index, { timingQuality: 'word', source: 'test' });
  }),
});
for (const sample of [
  makeTranscript('fast words without any punctuation keep moving today now'.split(' '), 0.01),
  makeTranscript('slow words settle into readable groups'.split(' '), 0.55, 0.4),
  makeTranscript(['Numbers', '42%', '$19.95', 'remain', 'together.'], 0.08),
  makeTranscript(['go', 'go', 'go', 'then', 'stop!'], 0.06),
  makeTranscript(Array.from('字幕は同期する準備完了。'), 0.03, 0.18, 'ja'),
]) {
  const result = J.segmentCaptions(sample, { duration: 15, safeZone: { left: 0, right: 760 } });
  assertPartition(result, sample.tokens);
}

const narrow = J.segmentCaptions(makeTranscript(['extraordinary', 'readability', 'matters'], 0.1), {
  duration: 15, safeZone: { width: 180 }, averageGlyphWidth: 36,
});
assert.ok(narrow.segments.some(segment => segment.diagnostics.penalties.includes('overflow')), 'overflow was not diagnosed');

const excluded = transcript.tokens[3].id;
const without = J.segmentCaptions(transcript, { duration: 15, excludedTokenIds: [excluded] });
assert.ok(!without.segments.some(segment => segment.tokenIds.includes(excluded)), 'explicitly excluded token was emitted');
assert.equal(without.segments.flatMap(segment => segment.tokenIds).length, transcript.tokens.length - 1);

console.log(`Gate 2.1 caption segmentation tests passed (${first.segments.length} canonical segments).`);
