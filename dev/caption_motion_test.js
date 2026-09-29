/* Dependency-free tests for Gate 2.4 motion budgets and continuity. */
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

const meta = (intensity, motionCost, attentionCost) => ({ intensity, motionCost, attentionCost });
const component = (id, metadata, role) => ({ group: 'enter', id, metadata, role });
const base = {
  id: 'calm', font: 'Inter', alignment: 'center', position: 'bottom', treatment: 'plain', accentColor: '#b7ff4a', animationFamily: 'fade',
  components: [component('fade', meta(1, 0.2, 0.3), 'primary'), component('activeTint', meta(0, 0.05, 0.1), 'secondary')],
};
const calm = J.evaluateCaptionMotionPlan(base);
assert.equal(calm.allowed, true);
assert.deepStrictEqual(calm.totals, { intensity: 1, motionCost: 0.25, attentionCost: 0.4, rollingAttention: 0.4 });
assert.deepStrictEqual(calm.composition, { primaryCount: 1, secondaryCount: 1 });

const loud = Object.assign({}, base, { id: 'loud', components: [component('slam', meta(4, 0.8, 0.7), 'primary'), component('flash', meta(3, 0.5, 0.6), 'primary')] });
const rejected = J.evaluateCaptionMotionPlan(loud);
assert.equal(rejected.allowed, false);
for (const reason of ['intensity-budget-exceeded', 'motion-budget-exceeded', 'attention-budget-exceeded', 'multiple-primary-techniques']) assert.ok(rejected.reasons.includes(reason));

const manual = J.evaluateCaptionMotionPlan(loud, { manualOverride: true });
assert.equal(manual.allowed, true); assert.equal(manual.withinBudget, false);
assert.ok(manual.warnings.includes('manual-override-exceeds-budget'));

const hero = Object.assign({}, base, { id: 'hero', components: [component('hero', meta(2, 0.5, 0.7), 'primary')] });
const adjacent = J.evaluateCaptionMotionPlan(hero, { recentPlans: [hero] });
assert.ok(adjacent.reasons.includes('adjacent-hero-moment'));
assert.ok(adjacent.reasons.includes('rolling-attention-budget-exceeded') === false, 'single previous hero should fit the default rolling total');
const rolling = J.evaluateCaptionMotionPlan(hero, { recentPlans: [hero, hero] });
assert.ok(rolling.reasons.includes('rolling-attention-budget-exceeded'));

const repeated = J.evaluateCaptionMotionPlan(base, { recentPlans: [base] });
assert.ok(repeated.warnings.includes('recent-technique-repetition'));
assert.ok(repeated.repetitionCost > 0);
const fresh = Object.assign({}, base, { components: [component('softRise', meta(1, 0.2, 0.3), 'primary')] });
assert.ok(J.evaluateCaptionMotionPlan(fresh, { recentPlans: [base] }).score > repeated.score, 'recent history did not reduce repetitive randomness');

const changed = Object.assign({}, base, { font: 'Impact', alignment: 'left', position: 'top', treatment: 'outline', animationFamily: 'rise' });
const continuity = J.evaluateCaptionMotionPlan(changed, { previousPlan: base });
for (const reason of ['continuity-font', 'continuity-alignment', 'continuity-position', 'too-many-continuity-changes']) assert.ok(continuity.reasons.includes(reason));
const styleAllows = J.evaluateCaptionMotionPlan(changed, { previousPlan: base, profile: { continuity: { font: 'flexible', alignment: 'flexible', position: 'flexible', accentColor: 'flexible' }, maxContinuityChanges: 6 } });
assert.equal(styleAllows.allowed, true, 'style continuity controls were ignored');

const twoSecondary = Object.assign({}, base, { components: [component('a', meta(0, 0.1, 0.1), 'secondary'), component('b', meta(0, 0.1, 0.1), 'secondary')] });
assert.ok(J.evaluateCaptionMotionPlan(twoSecondary).reasons.includes('multiple-secondary-techniques'));
const missing = Object.assign({}, base, { components: [{ group: 'enter', id: 'unreviewed' }] });
assert.ok(J.evaluateCaptionMotionPlan(missing).reasons.includes('component-metadata-missing'));
const manualMissing = J.evaluateCaptionMotionPlan(missing, { manualOverride: true });
assert.equal(manualMissing.allowed, false, 'manual override bypassed missing safety metadata');
assert.ok(manualMissing.warnings.includes('manual-override-safety-blocked'));

const filtered = J.filterCaptionMotionCandidates([loud, base], {});
assert.deepStrictEqual(filtered.accepted.map(item => item.plan.id), ['calm']);
assert.deepStrictEqual(filtered.rejected.map(item => item.plan.id), ['loud']);
console.log('Gate 2.4 caption motion budget tests passed.');
