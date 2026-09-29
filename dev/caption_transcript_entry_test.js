const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), path = require('node:path');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add() {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({}) }) };
for (const file of fs.readdirSync(path.join(root, 'src')).filter(file => file.endsWith('.js') && file !== '12_ui.js').sort()) vm.runInThisContext(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file });
const mixed = 'これは日本語の長い字幕です。 English もう一つの文です。';
const transcript = J.importSrt(`1\n00:00:00,000 --> 00:00:06,000\n${mixed}\n`, { timingQuality: 'estimated' });
assert.ok(transcript.tokens.length > 3, 'mixed CJK must be split into words, not long whitespace chunks');
assert.equal(transcript.tokens.map(t => t.text).join(''), mixed.replace(/\s/g, ''));
assert.throws(() => J.importSrt('not subtitles', { timingQuality: 'estimated' }), { code: 'TRANSCRIPT_EMPTY' });
const empty = { schemaVersion: 2, generatorVersion: J.PROJECT_GENERATOR_VERSION, mode: 'video-captions', id: 'manual-test', media: { duration: 46, width: 1920, height: 1080 }, transcript: { schemaVersion: 1, language: 'und', timingQuality: 'word', tokens: [] }, segments: [], plans: {}, safeZones: [], seed: 3107, style: { preset: 'creator' }, settings: {} };
const store = new J.CaptionStore(empty);
store.execute({ type: 'add-caption', text: mixed, start: 0, end: 5 });
assert.equal(store.project.segments.length, 1);
const calm = J.planCaptions({ ...empty, transcript: J.importSrt('1\n00:00:00,000 --> 00:00:03,000\nHello world\n', { timingQuality: 'estimated' }) }, empty.media);
assert.equal(Object.values(calm.plans)[0].generated.fallback, false, 'a simple caption must not fall back because of its fade-out');
assert.ok(store.project.plans[store.project.segments[0].id]);
const first = store.serialize();
store.execute({ type: 'add-caption', text: 'Next caption', start: 6, end: 9 });
assert.equal(store.project.segments.length, 2);
assert.ok(store.undo()); assert.equal(store.serialize(), first);
assert.ok(store.redo()); assert.equal(store.project.segments.length, 2);
const saved = store.serialize();
for (const command of [ { text: 'Overlap', start: 4, end: 7 }, { text: 'Too late', start: 45, end: 47 }, { text: '', start: 10, end: 12 }, { text: 'Bad time', start: NaN, end: 12 } ]) {
  assert.throws(() => store.execute({ type: 'add-caption', ...command }));
  assert.equal(store.serialize(), saved, 'invalid additions must preserve the project');
}
assert.equal(J.loadProject(saved).segments.length, 2);
if (process.argv[2]) {
  const actual = J.importSrt(fs.readFileSync(process.argv[2], 'utf8'), { timingQuality: 'estimated', duration: 46 });
  const project = { ...empty, transcript: actual, segments: J.segmentCaptions(actual, { duration: 46 }).segments };
  const planned = J.planCaptions(project, project.media); project.segments = planned.segments; project.plans = planned.plans;
  assert.ok(new J.CaptionStore(project).project.segments.length);
  assert.throws(() => J.importSrt(fs.readFileSync(process.argv[2], 'utf8'), { timingQuality: 'estimated', duration: 40 }), error => error.code === 'TOKEN_END_AFTER_DURATION' && /40.00s/.test(error.message));
  console.log(`Supplied SRT: ${actual.tokens.length} words, ${project.segments.length} captions, ${Object.values(project.plans).filter(p => p.generated.fallback).length} static fallbacks.`);
}
console.log('Caption manual entry, mixed-language import, validation, undo/redo and save passed.');
