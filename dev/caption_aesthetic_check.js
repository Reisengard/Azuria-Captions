'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const spike = require('./caption_aesthetic_spike.js');
const transcript = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8'));

const creator = spike.buildPlan(transcript, 'creator', 3107);
const creatorAgain = spike.buildPlan(transcript, 'creator', 3107);
const variation = spike.buildPlan(transcript, 'creator', 3108);
const punchy = spike.buildPlan(transcript, 'punchy', 3107);

assert.deepStrictEqual(creator, creatorAgain, 'same seed must reproduce the exact plan');
assert.notDeepStrictEqual(creator, variation, 'variation seed must alter visual choices');
assert.deepStrictEqual(creator.tokens.map(token => [token.id, token.start, token.end]), variation.tokens.map(token => [token.id, token.start, token.end]), 'variation must preserve text structure and timing');
assert.deepStrictEqual(new Set(creator.segments.map(segment => segment.layout)), new Set(spike.LAYOUTS), 'demo must cover all three layouts');
assert.deepStrictEqual(new Set(creator.segments.slice(0, 3).map(segment => segment.motion)), new Set(['fade', 'softRise', 'softScale']), 'demo must cover the three subtle motions');
assert.ok(creator.tokens.find(token => token.id === 'word_000004').intent.reasons.includes('manual'), 'manual emphasis must win');
assert.ok(creator.segments.every(segment => segment.start >= 0 && segment.end <= spike.DURATION && segment.end > segment.start));
assert.ok(punchy.segments.filter(segment => segment.impact).length >= creator.segments.filter(segment => segment.impact).length, 'Punchy must not be calmer than Creator for the same seed');

const active = spike.activeToken(creator, 1.5);
assert.equal(active.id, 'word_000004');
assert.equal(spike.activeToken(creator, 2.8), null, 'pause must have no active word');

console.log(`Caption aesthetic check passed (${creator.segments.length} segments, ${spike.LAYOUTS.length} layouts, deterministic seed 3107).`);
