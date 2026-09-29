'use strict';
require('./caption_preview_integration_test');
const assert = require('node:assert/strict');
const transcript = J.importSrt('1\n00:00:00,000 --> 00:00:03,000\nMake words move\n', { timingQuality: 'estimated' });
const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {} };
const drawFx = J.drawFx;
const frames = [];
J.drawFx = (env, item) => { frames.push({ enter: env.cut.enter, item, glyph: item.charFn && item.charFn(1, {}, 12) }); };
try {
  for (const effect of ['captionPop', 'captionDrop', 'captionType', 'captionBlur', 'captionWipe', 'captionImpact']) {
    const project = { media: { width: 1280, height: 720 }, transcript, segments: [], plans: {}, seed: 3107,
      style: { preset: 'jizura-mv', effect, motion: .7, intensity: .7, zones: ['bottom'] } };
    const result = J.planCaptions(project, project.media); Object.assign(project, result);
    const plan = Object.values(project.plans)[0].generated;
    assert.equal(plan.entrance, effect, `chosen ${effect} must survive planning`);
    assert.equal(plan.fallback, false);
    J.drawCaptionOverlay(ctx, project, .12);
    const animated = frames.at(-1);
    assert.equal(animated.enter, effect);
    assert.ok(animated.item.charFns.length || animated.item.blur || animated.item.clip || animated.item.size < 80, `${effect} must affect text drawing`);
    J.drawCaptionOverlay(ctx, project, .12, { reducedMotion: true });
    assert.equal(frames.at(-1).enter, 'cut', 'reduced motion must suppress entrances');
    plan.animationDisabled = true;
    J.drawCaptionOverlay(ctx, project, .12);
    assert.equal(frames.at(-1).enter, 'cut', 'segment animation override must be respected');
  }
} finally { J.drawFx = drawFx; }

const creatorEntrances = J.CAPTION_STYLE_PROFILES.creator.entrances;
assert.equal(typeof J.ENTER.pop.apply, 'function');
const enter = { pop: true };
for (const id of creatorEntrances) enter[id] = false;
const cueProject = { media: { width: 1280, height: 720, duration: 3 }, transcript, segments: [], plans: {}, seed: 3107,
  style: { preset: 'creator', editor: 'advanced', motion: .7, look: { enter: 'pop' } }, techniques: { extra: false, wa: false, typo: false, kinetic: false, horror: false, enabled: { enter } } };
Object.assign(cueProject, J.planCaptions(cueProject, cueProject.media));
assert.equal(cueProject.segments.length, 1);
const cue = cueProject.segments[0];
assert.equal(J.captionResolvedPlan(cueProject.plans[cue.id]).entrance, 'pop');
const seen = [];
J.drawFx = (env, item) => { seen.push({ enter: env.cut.enter, hold: env.cut.hold, exit: env.cut.exit, glyphs: item.charFns.length }); };
J.drawCaptionOverlay(ctx, cueProject, cue.start + 0.05);
assert.equal(seen.at(-1).enter, 'pop');
assert.ok(seen.at(-1).glyphs > 0, 'pop apply did not reach the cue');
enter.pop = false;
for (const id of creatorEntrances) delete enter[id];
Object.assign(cueProject, J.planCaptions(cueProject, cueProject.media));
const again = cueProject.segments[0];
const safe = J.captionResolvedPlan(cueProject.plans[again.id]).entrance;
assert.equal(creatorEntrances.includes(safe), true, safe);
assert.equal(J.registry('enter')[safe].capabilities.captionSafe, true);
J.drawCaptionOverlay(ctx, cueProject, again.start + 0.05);
assert.equal(seen.at(-1).enter, safe);
J.drawFx = drawFx;

assert.equal(typeof J.TREAT.wide.apply, 'function');
const treat = { wide: true };
const treatProject = { media: { width: 1280, height: 720, duration: 3 }, transcript, segments: [], plans: {}, seed: 3107,
  style: { preset: 'creator', editor: 'advanced', motion: .7, look: { treat: 'wide' } }, techniques: { extra: false, wa: false, typo: false, kinetic: false, horror: false, enabled: { treat } } };
Object.assign(treatProject, J.planCaptions(treatProject, treatProject.media));
assert.equal(treatProject.segments.length, 1);
const treatCue = treatProject.segments[0];
const resolved = J.captionResolvedPlan(treatProject.plans[treatCue.id]);
assert.equal(resolved.treatment, 'wide');
assert.equal(resolved.captionTreatment, 'outline');
const drawn = [];
J.drawFx = (env, item) => { drawn.push({ treat: env.cut.treat }); };
J.drawCaptionOverlay(ctx, treatProject, treatCue.start + 0.05);
assert.equal(drawn.at(-1).treat, 'wide');
treat.wide = false;   // advanced offers every effect; an explicit off still wins
Object.assign(treatProject, J.planCaptions(treatProject, treatProject.media));
const treatAgain = treatProject.segments[0];
J.drawCaptionOverlay(ctx, treatProject, treatAgain.start + 0.05);
assert.equal(drawn.at(-1).treat, undefined);
assert.notEqual(J.captionResolvedPlan(treatProject.plans[treatAgain.id]).treatment, 'wide');
J.drawFx = drawFx;
console.log('Chosen expressive effects reach the shared preview/export renderer; reduced motion is respected.');
