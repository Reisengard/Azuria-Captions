/* Dependency-free tests for the Gate 1.2 timed-text contract. */
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
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', name), 'utf8');
const jsonFixture = name => JSON.parse(fixture(name));

const canonical = J.importWordJson(fixture('word-timestamps.json'), { duration: 15 });
assert.equal(canonical.tokens.length, 21);
assert.equal(canonical.tokens[0].text, 'Wait,');
assert.equal(canonical.tokens[0].normalizedText, 'wait');
const edited = structuredClone(canonical); edited.tokens[3].text = '43%';
assert.deepStrictEqual(edited.tokens.map(token => token.id), canonical.tokens.map(token => token.id), 'text edits changed stable IDs');

for (const [name, code] of [['invalid-negative-timing.json', 'TOKEN_START_NEGATIVE'], ['invalid-overlap.json', 'TOKEN_TIMING_OVERLAP']]) {
  assert.throws(() => J.importWordJson(jsonFixture(name)), error => error.code === code && error.tokenId === jsonFixture(name).expectedError.tokenId);
}
assert.throws(() => J.validateTranscript(canonical, { duration: 10 }), error => error.code === 'TOKEN_END_AFTER_DURATION' && error.tokenId === 'word_000015');

for (const [name, importer] of [['captions.srt', J.importSrt], ['captions.vtt', J.importVtt]]) {
  assert.throws(() => importer(fixture(name), { language: 'en' }), error => error.code === 'ESTIMATED_TIMING_REQUIRED');
  const imported = importer(fixture(name), { language: 'en', timingQuality: 'estimated', duration: 15 });
  assert.equal(imported.timingQuality, 'estimated');
  assert.ok(imported.tokens.every(token => token.timingQuality === 'estimated'));
  assert.equal(imported.tokens.map(token => token.text).join(' '), canonical.tokens.map(token => token.text).join(' '));
}

const cjk = '字幕は同期する。準備完了！';
for (const forceFallback of [false, true]) {
  const tokens = J.tokenizeCaptionText(cjk, 'ja', { forceFallback });
  assert.ok(tokens.length > 1, 'CJK text was not tokenized');
  assert.equal(tokens.join(''), cjk, 'CJK tokenization lost display text');
}

console.log('Gate 1.2 timed-text tests passed.');
