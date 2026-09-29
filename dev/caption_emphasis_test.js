/* Dependency-free tests for Gate 2.2 caption emphasis intent. */
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
const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8');
const transcript = J.importWordJson(raw, { duration: 15 });
const before = structuredClone(transcript);
const scored = J.applyCaptionEmphasis(transcript);
assert.deepStrictEqual(transcript, before, 'emphasis scoring mutated its input');
assert.deepStrictEqual(scored.tokens.map(token => token.id), transcript.tokens.map(token => token.id));
assert.deepStrictEqual(scored.tokens.map(token => [token.text, token.start, token.end]), transcript.tokens.map(token => [token.text, token.start, token.end]));

const byId = id => scored.tokens.find(token => token.id === id).emphasis;
assert.equal(byId('word_000004').score, 1, 'manual emphasis did not win');
assert.deepStrictEqual(byId('word_000004').reasons, ['manual']);
assert.ok(byId('word_000005').reasons.includes('sentence-final'));
assert.ok(byId('word_000009').reasons.includes('expressive-punctuation'));
assert.ok(byId('word_000008').reasons.includes('repetition'));
assert.ok(byId('word_000009').score > byId('word_000008').score, 'repeated-word escalation did not increase');
assert.ok(!byId('word_000006').reasons.includes('capitalization'), 'sentence-initial capitalization was treated as truth');

const token = (text, manualEmphasis = null) => ({ text, normalizedText: J.normalizeTokenText(text), manualEmphasis });
assert.deepStrictEqual(J.scoreCaptionEmphasis(token('99%', { enabled: false, reason: 'editor' })).reasons, ['manual-disabled']);
assert.equal(J.scoreCaptionEmphasis(token('99%', { enabled: false })).score, 0, 'manual disable did not override automatic numeric emphasis');
assert.equal(J.scoreCaptionEmphasis(token('ordinary', { enabled: true, score: 0.65 })).score, 0.65);
assert.ok(J.scoreCaptionEmphasis(token('$19.95')).reasons.includes('currency'));
assert.ok(J.scoreCaptionEmphasis(token('42%')).reasons.includes('percentage'));
assert.ok(J.scoreCaptionEmphasis(token('2026')).reasons.includes('number'));
assert.ok(!J.scoreCaptionEmphasis(token('v2ray')).reasons.includes('number'), 'digits inside a word triggered number emphasis');

const midSentence = J.scoreCaptionEmphasis(token('Important'), { previous: token('is') });
assert.ok(midSentence.reasons.includes('capitalization'));
assert.ok(midSentence.score < J.scoreCaptionEmphasis(token('WOW!'), { previous: token('that') }).score, 'capitalization was not a weak signal');
assert.ok(J.scoreCaptionEmphasis(token('字幕！')).reasons.includes('expressive-punctuation'));
assert.ok(scored.tokens.every(item => item.emphasis.score >= 0 && item.emphasis.score <= 1));
assert.deepStrictEqual(J.applyCaptionEmphasis(transcript), scored, 'emphasis scoring is not deterministic');

console.log('Gate 2.2 caption emphasis tests passed.');
