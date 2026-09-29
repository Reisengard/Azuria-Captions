// MV combinations retain user choices through planning, history and rendering.
'use strict';
require('./caption_preview_integration_test');
const assert = require('node:assert/strict');
const transcript = J.importSrt('1\n00:00:00,000 --> 00:00:03,000\nMake words move\n\n2\n00:00:03,000 --> 00:00:06,000\nKeep this look\n', { timingQuality: 'estimated' });
const base = { schemaVersion: J.PROJECT_SCHEMA_VERSION, generatorVersion: J.PROJECT_GENERATOR_VERSION, mode: 'video-captions', id: 'mv-effects', media: { width: 1280, height: 720, duration: 6 }, transcript, segments: [], plans: {}, safeZones: [], settings: {}, seed: 3107, style: { preset: 'creator' } };
Object.assign(base, J.planCaptions(base, base.media));
const store = new J.CaptionStore(base);
const lockedId = store.project.segments[1].id;
store.execute({ type: 'set-segment-lock', segmentId: lockedId, lock: 'visualPlan', locked: true });
const locked = JSON.stringify(store.project.plans[lockedId]);
const before = store.serialize();
const style = { preset: 'jizura-mv', effect: 'captionBlur', holdEffect: 'captionWave', exitEffect: 'captionBlurOut', captionTreatment: 'neon', motion: .65, intensity: .7, zones: ['bottom'] };
store.execute({ type: 'set-caption-style', style });
const plan = store.project.plans[store.project.segments[0].id].generated;
assert.equal(plan.entrance, style.effect);
assert.equal(plan.hold, style.holdEffect);
assert.equal(plan.exit, style.exitEffect);
assert.equal(plan.fallback, false);
assert.equal(JSON.stringify(store.project.plans[lockedId]), locked);
const after = store.serialize();
store.undo(); assert.equal(store.serialize(), before);
store.redo(); assert.equal(store.serialize(), after);
assert.equal(new J.CaptionStore(J.loadProject(after)).project.style.holdEffect, 'captionWave');
const draw = J.drawFx, frames = [];
J.drawFx = (env, item) => frames.push({ cut: env.cut, item, glyph: item.charFn && item.charFn(1, {}, 12) });
const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {} };
try {
  J.drawCaptionOverlay(ctx, store.project, 1);
  assert.equal(frames.at(-1).cut.hold, 'captionWave');
  assert.ok(Math.abs(frames.at(-1).glyph.dy) > 0, 'MV wave must move glyphs');
  J.drawCaptionOverlay(ctx, store.project, 2.95);
  assert.ok(frames.at(-1).item.blur > 0, 'blur exit must affect rendered text');
  J.drawCaptionOverlay(ctx, store.project, 1, { reducedMotion: true });
  assert.equal(frames.at(-1).cut.hold, 'still');
  assert.equal(frames.at(-1).cut.exit, 'cut');
} finally { J.drawFx = draw; }
console.log('MV effect selection, rendered wave/exit, save/load, locks, undo/redo and reduced motion passed.');
