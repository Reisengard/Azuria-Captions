/* Gate 7 dependency-free release matrix and planner benchmark. */
'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), { performance } = require('node:perf_hooks');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({ measureText: text => ({ width: Array.from(String(text)).length * 42 }) }) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js' && name !== '12c_caption_workbench.js').sort()) {
  vm.runInThisContext(fs.readFileSync(path.join(root, 'src', name), 'utf8'), { filename: name });
}

const requiredRecovery = ['MEDIA_VIDEO_CODEC_UNSUPPORTED', 'MEDIA_AUDIO_CODEC_UNSUPPORTED', 'MEDIA_ENCODER_UNSUPPORTED', 'MEDIA_RELINK_MISMATCH',
  'TRANSCRIPT_TIMING_INVALID', 'TIMED_TEXT_WORD_TIMING_REQUIRED', 'MEDIA_FILE_SAVE_REQUIRED', 'MEDIA_EXPORT_FAILED', 'MEDIA_EXPORT_CANCELLED',
  'UNSUPPORTED_SCHEMA_VERSION', 'FONT_LOAD_FAILED', 'CAPTION_STATIC_FALLBACK'];
for (const code of requiredRecovery) {
  const recovered = J.recoveryForError({ code, message: 'Failure.' });
  assert.equal(recovered.code, code); assert.ok(recovered.action.length >= 20, `${code} lacks an actionable recovery`);
}

const edgeTexts = ['extraordinarilylongunbrokenword', 'fast fast fast fast', 'slow', 'silence after', '2026', 'again again', 'hello 😀', 'English 日本語 混合'];
let time = 0, index = 0; const tokens = [];
for (const text of edgeTexts) for (const word of text.split(' ')) { tokens.push({ id: `edge_${index++}`, text: word, start: time, end: time + .46, timingQuality: 'word', source: 'release-test' }); time += .5; }
const transcript = { schemaVersion: J.TIMED_TEXT_SCHEMA_VERSION, language: 'mul', timingQuality: 'word', tokens };
J.validateTranscript(transcript, { duration: time + .2 });
const base = { schemaVersion: 2, generatorVersion: 'release-test', mode: 'video-captions', id: 'release-edge', media: { duration: time + .2, width: 1080, height: 1920 },
  transcript, segments: [], plans: {}, safeZones: [], seed: 3107, style: { preset: 'creator' }, settings: {} };
const portrait = J.planCaptions(base, base.media), landscape = J.planCaptions(Object.assign({}, base, { media: Object.assign({}, base.media, { width: 1920, height: 1080 }) }));
assert.ok(portrait.segments.length && landscape.segments.length); assert.deepStrictEqual(J.planCaptions(base, base.media), portrait);
for (const result of [portrait, landscape]) for (const stored of Object.values(result.plans)) {
  assert.ok(stored.generated.readability.allowed, `release matrix produced unreadable default ${stored.segmentId}: ${stored.generated.readability.reasons}`);
  assert.ok(!(stored.generated.components || []).some(component => component.metadata && component.metadata.flashes), 'safe default contains flashing');
}

const longTokens = Array.from({ length: 360 }, (_, i) => ({ id: `long_${i}`, text: i % 19 === 0 ? '字幕' : `word${i}`, start: i * .5, end: i * .5 + .38, timingQuality: 'word', source: 'release-test' }));
const longProject = Object.assign({}, base, { id: 'release-3min', media: { duration: 180, width: 1080, height: 1920 },
  transcript: { schemaVersion: J.TIMED_TEXT_SCHEMA_VERSION, language: 'mul', timingQuality: 'word', tokens: longTokens }, segments: [], plans: {} });
const started = performance.now(), longPlan = J.planCaptions(longProject, longProject.media), elapsedMs = performance.now() - started;
assert.ok(longPlan.segments.length >= 60); assert.ok(elapsedMs < 30000, 'three-minute planner benchmark appears hung');

const saved = J.saveProject(Object.assign({}, base, { media: Object.assign({}, base.media, { fingerprint: 'sha256-test', file: { bytes: 'must-not-save' }, objectUrl: 'blob:test' }) }));
assert.ok(!saved.includes('must-not-save') && !saved.includes('blob:test'), 'project embedded runtime/source media');
assert.throws(() => J.loadProject(Object.assign({}, base, { schemaVersion: 999 })), error => error.code === 'UNSUPPORTED_SCHEMA_VERSION');

console.log(`Gate 7 release matrix passed (${edgeTexts.length} edge cases; 3-minute planner ${elapsedMs.toFixed(1)} ms, ${longPlan.segments.length} segments).`);
