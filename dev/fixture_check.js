/* Validate fixture declarations without requiring media tooling or product code. */
'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const fixtures = path.join(__dirname, 'fixtures');
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(fixtures, ...parts), 'utf8'));
const transcript = readJson('captions', 'word-timestamps.json');

assert.equal(transcript.schemaVersion, 1);
assert.equal(transcript.timingQuality, 'word');
assert.ok(transcript.tokens.length > 0);
assert.equal(new Set(transcript.tokens.map(token => token.id)).size, transcript.tokens.length, 'token IDs must be unique');
assert.ok(transcript.tokens.some(token => /[,.!?]$/.test(token.text)), 'punctuation token missing');
assert.ok(transcript.tokens.some(token => /\d/.test(token.text)), 'number token missing');
assert.ok(transcript.tokens.some(token => token.manualEmphasis), 'manual emphasis token missing');
assert.ok(transcript.tokens.some((token, index, all) => index && token.normalizedText === all[index - 1].normalizedText), 'repeated word missing');
assert.ok(transcript.tokens.some((token, index, all) => index && token.start - all[index - 1].end >= 1), 'one-second pause missing');
for (let index = 0; index < transcript.tokens.length; index++) {
  const token = transcript.tokens[index];
  assert.ok(token.start >= 0 && token.end >= token.start, `invalid canonical timing for ${token.id}`);
  if (index) assert.ok(token.start >= transcript.tokens[index - 1].end, `canonical overlap at ${token.id}`);
}

const visibleText = transcript.tokens.map(token => token.text).join(' ');
for (const name of ['captions.srt', 'captions.vtt']) {
  const cueText = fs.readFileSync(path.join(fixtures, 'captions', name), 'utf8')
    .split(/\r?\n/)
    .filter(line => line && !/^WEBVTT$/.test(line) && !/^\d+$/.test(line) && !/-->/.test(line))
    .join(' ');
  assert.equal(cueText, visibleText, `${name} text differs from canonical transcript`);
}

const invalid = [
  ['invalid-negative-timing.json', 'TOKEN_START_NEGATIVE'],
  ['invalid-overlap.json', 'TOKEN_TIMING_OVERLAP'],
  ['invalid-unknown-schema.json', 'UNSUPPORTED_SCHEMA_VERSION'],
  ['invalid-missing-token.json', 'SEGMENT_TOKEN_NOT_FOUND'],
  ['invalid-unsafe-technique.json', 'CAPTION_TECHNIQUE_UNSAFE'],
];
for (const [name, code] of invalid) assert.equal(readJson('captions', name).expectedError.code, code);

const manifest = readJson('media', 'manifest.json');
assert.equal(manifest.license, 'CC0-1.0');
assert.match(manifest.provenance, /synthesized/i);
assert.equal(manifest.fixtures.length, 5);
for (const media of manifest.fixtures) {
  for (const field of ['file', 'purpose', 'duration', 'width', 'height', 'frameRate', 'container', 'videoCodec', 'pixelFormat', 'hasAudio']) {
    assert.notEqual(media[field], undefined, `${media.file || 'media fixture'} lacks ${field}`);
  }
  if (media.hasAudio) assert.ok(media.audioCodec && media.audioSampleRate, `${media.file} lacks audio metadata`);
  if (media.transcript) assert.ok(fs.existsSync(path.resolve(fixtures, 'media', media.transcript)), `${media.file} transcript is missing`);
}

const generated = path.join(fixtures, 'media', manifest.outputDirectory);
let probed = 0;
if (fs.existsSync(generated)) {
  for (const media of manifest.fixtures) {
    const filename = path.join(generated, media.file);
    assert.ok(fs.existsSync(filename), `generated media is incomplete: ${media.file} is missing`);
    const result = childProcess.execFileSync('ffprobe', [
      '-v', 'error', '-show_streams', '-show_format', '-of', 'json', filename,
    ], { encoding: 'utf8' });
    const probe = JSON.parse(result);
    const video = probe.streams.find(stream => stream.codec_type === 'video');
    const audio = probe.streams.find(stream => stream.codec_type === 'audio');
    assert.ok(video, `${media.file} has no video stream`);
    assert.equal(video.codec_name, media.videoCodec, `${media.file} video codec differs`);
    assert.equal(video.pix_fmt, media.pixelFormat, `${media.file} pixel format differs`);
    assert.equal(video.width, media.width, `${media.file} width differs`);
    assert.equal(video.height, media.height, `${media.file} height differs`);
    const [numerator, denominator] = video.avg_frame_rate.split('/').map(Number);
    assert.ok(Math.abs(numerator / denominator - media.frameRate) < 0.001, `${media.file} frame rate differs`);
    assert.ok(Math.abs(Number(probe.format.duration) - media.duration) < 0.15, `${media.file} duration differs`);
    assert.equal(Boolean(audio), media.hasAudio, `${media.file} audio presence differs`);
    if (audio) {
      assert.equal(audio.codec_name, media.audioCodec, `${media.file} audio codec differs`);
      assert.equal(Number(audio.sample_rate), media.audioSampleRate, `${media.file} audio sample rate differs`);
    }
    probed++;
  }
}

console.log(`Fixture check passed (${transcript.tokens.length} tokens, ${invalid.length} invalid cases, ${manifest.fixtures.length} media recipes${probed ? `, ${probed} media files probed` : ''}).`);
