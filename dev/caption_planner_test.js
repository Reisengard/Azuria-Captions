/* Dependency-free tests for Gate 2.5 deterministic visual planning. */
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
const capability = (extra = {}) => Object.assign({ intensity: 1, motionCost: 0.08, attentionCost: 0.08, captionSafe: true, 
  minDuration: 0.2, preferredDuration: 1, maxWords: 8, portraitFriendly: true, emojiSafe: true, requiresFullFrame: false,
  flashes: false, movesCamera: false, incompatibleComponentIds: [], incompatibleCategories: [] }, extra);
const register = (group, id, extra) => J.register(group, id, Object.assign({ name: `Test ${id}` }, capability(extra), { plan() {}, draw() {} }), 'caption-planner-test');
register('layout', 'testCaptionLayout', { attentionCost: 0, motionCost: 0 });
register('enter', 'testCaptionEnter', { attentionCost: 0.2, motionCost: 0.18 });
register('hold', 'testCaptionHold', { attentionCost: 0, motionCost: 0.02 });
register('exit', 'testCaptionExit', { attentionCost: 0, motionCost: 0.04 });
register('treat', 'testCaptionTreat', { attentionCost: 0, motionCost: 0 });
register('decor', 'testCaptionDecor', { attentionCost: 0.08, motionCost: 0.05 });
J.register('enter', 'testUnsafeEnter', Object.assign({ name: 'Unsafe test', plan() {}, draw() {} }, capability({ captionSafe: false })), 'caption-planner-test');
register('enter', 'testTooSlowEnter', { minDuration: 5, preferredDuration: 5 });

const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8');
const transcript = J.importWordJson(raw, { duration: 15 });
const segmented = J.segmentCaptions(transcript, { duration: 15, safeZone: { width: 850 } });
const project = { schemaVersion: 2, generatorVersion: 'test', mode: 'video-captions', id: 'planner-project', media: { duration: 15, width: 1080, height: 1920 },
  transcript, segments: segmented.segments, style: { preset: 'creator' }, plans: {}, safeZones: [], seed: 3107, settings: {} };

const first = J.planCaptions(project, project.media), second = J.planCaptions(project, project.media);
assert.deepStrictEqual(second, first, 'same inputs and seed did not reproduce the plan');
assert.equal(Object.keys(first.plans).length, project.segments.length);
for (const stored of Object.values(first.plans)) {
  const plan = stored.generated;
  assert.equal(plan.readability.allowed, true, `fallback for ${stored.segmentId} was not readable`);
  assert.equal(plan.motionSummary.intensity <= 2, true);
  assert.ok(!plan.components.some(component => component.id === 'testUnsafeEnter'), 'unsafe component entered a caption plan');
  assert.ok(!plan.components.some(component => component.id === 'testTooSlowEnter' && plan.duration < 5), 'duration-incompatible component entered a short caption');
}
assert.ok(first.tokens.find(token => token.id === 'word_000004').emphasis.reasons.includes('manual'));
const unsegmented = J.planCaptions(Object.assign({}, project, { segments: [], plans: {} }), project.media);
assert.ok(unsegmented.segments.length > 0 && Object.keys(unsegmented.plans).length === unsegmented.segments.length, 'timed words did not enter the complete planning pipeline');

const withPlans = Object.assign({}, project, { plans: first.plans });
const target = project.segments[1].id;
const rerolled = J.rerollCaptionVisual(withPlans, target);
for (const id of project.segments.map(segment => segment.id)) {
  if (id !== target) assert.deepStrictEqual(rerolled.plans[id], withPlans.plans[id], `reroll changed non-target segment ${id}`);
}
assert.equal(rerolled.plans[target].generated.rerollCount, 1);
assert.deepStrictEqual(rerolled.segments, project.segments); assert.deepStrictEqual(rerolled.transcript, project.transcript);

const overridden = clone => JSON.parse(JSON.stringify(clone));
const lockedProject = overridden(withPlans), lockedId = project.segments[0].id;
lockedProject.segments[0].locks.visualPlan = true;
lockedProject.plans[lockedId].manual = { accentColor: '#FF00FF' };
lockedProject.plans[target].lockedFields = ['font']; lockedProject.plans[target].generated.font = 'Locked Font';
const varied = J.createCaptionVisualVariation(lockedProject, { seed: 9999 });
assert.equal(varied.seed, 9999);
assert.deepStrictEqual(varied.transcript, lockedProject.transcript, 'variation changed tokens or timings');
assert.deepStrictEqual(varied.segments, lockedProject.segments, 'variation resegmented the project');
assert.deepStrictEqual(varied.plans[lockedId], lockedProject.plans[lockedId], 'variation changed a locked plan');
assert.equal(varied.plans[target].generated.font, 'Locked Font', 'variation changed a locked field');
assert.deepStrictEqual(varied.plans[target].manual, lockedProject.plans[target].manual);

const noRegistryProject = overridden(project);
const orders = Object.fromEntries(J.GROUP_KEYS.map(group => [group, J.order(group).slice()]));
for (const group of J.GROUP_KEYS) J[({ layout: 'LAYOUT_ORDER', enter: 'ENTER_ORDER', hold: 'HOLD_ORDER', exit: 'EXIT_ORDER', decor: 'DECOR_ORDER', treat: 'TREAT_ORDER', bg: 'BG_ORDER', cam: 'CAMERA_ORDER', fx: 'FXE_ORDER', trans: 'TRANS_ORDER' })[group]] = [];
const fallback = J.planCaptions(noRegistryProject, noRegistryProject.media);
assert.ok(Object.values(fallback.plans).every(plan => plan.generated.fallback || plan.generated.layout === 'captionStatic'));
assert.ok(Object.values(fallback.plans).every(plan => plan.generated.readability.allowed), 'safe static fallback was not legible');
for (const [group, order] of Object.entries(orders)) J[({ layout: 'LAYOUT_ORDER', enter: 'ENTER_ORDER', hold: 'HOLD_ORDER', exit: 'EXIT_ORDER', decor: 'DECOR_ORDER', treat: 'TREAT_ORDER', bg: 'BG_ORDER', cam: 'CAMERA_ORDER', fx: 'FXE_ORDER', trans: 'TRANS_ORDER' })[group]] = order;

const planWith = (style, techniques) => {
  const next = JSON.parse(JSON.stringify(project));
  next.plans = {};
  next.style = Object.assign({ preset: 'creator' }, style);
  next.techniques = techniques;
  return J.planCaptions(next, next.media);
};
const generated = result => Object.values(result.plans).map(stored => stored.generated);
const creator = J.CAPTION_STYLE_PROFILES.creator;
const kineticLayout = id => { const def = J.registry('layout')[id]; return !!(def && def.set === 'kinetic'); };

const advancedOff = planWith({ editor: 'advanced' }, { extra: false, wa: false, typo: false, kinetic: false, horror: false, enabled: {} });
for (const plan of generated(advancedOff)) {
  assert.equal(kineticLayout(plan.layout), false, `advanced kinetic-off plan stored ${plan.layout}`);
  for (const component of plan.components) {
    const def = J.GROUP_KEYS.includes(component.group) ? J.registry(component.group)[component.id] : null;
    assert.ok(!def || def.set !== 'kinetic', `advanced kinetic-off plan stored ${component.group}.${component.id}`);
  }
}

const riseOff = planWith({ editor: 'advanced' }, { extra: true, kinetic: false, enabled: { enter: { captionSoftRise: false } } });
for (const plan of generated(riseOff)) assert.notEqual(plan.entrance, 'captionSoftRise', 'advanced plan stored captionSoftRise while that entrance was off');
const onlyRise = { enter: {} };
for (const id of creator.entrances) if (id !== 'captionSoftRise') onlyRise.enter[id] = false;
const riseOn = planWith({ editor: 'advanced' }, { extra: true, kinetic: false, enabled: onlyRise });
for (const plan of generated(riseOn)) assert.equal(plan.entrance, 'captionSoftRise', `advanced pool stored ${plan.entrance} instead of captionSoftRise`);

const popOn = planWith({ editor: 'advanced' }, { enabled: { enter: { pop: true } } });
for (const plan of generated(popOn)) assert.equal(plan.entrance, 'pop', `advanced pool stored ${plan.entrance} instead of pop`);
const drawBlock = fs.readFileSync(path.join(root, 'src', '12c_caption_workbench.js'), 'utf8');
const drawStart = drawBlock.indexOf('J.CAPTION_TECHNIQUE_DRAW = {');
const drawBody = drawBlock.slice(drawStart, drawBlock.indexOf('};', drawStart));
const drawFlags = { layout: false, enter: true, hold: true, exit: true, decor: false, treat: true, bg: false, cam: false, fx: false, trans: false };
for (const [group, value] of Object.entries(drawFlags)) {
  assert.match(drawBody, new RegExp(group + ': ' + value), `${group} draw flag was not ${value}`);
}
assert.equal(J.registry('enter').pop.capabilities.captionSafe, false, 'planning marked pop caption-safe');

const simple = planWith({ editor: 'simple' }, { kinetic: true, enabled: { layout: { knSlamStack: true } } });
assert.deepStrictEqual(simple.plans, first.plans, 'simple mode read the technique pool');
for (const plan of generated(simple)) {
  assert.ok(creator.layouts.includes(plan.layout), `simple plan stored ${plan.layout}`);
  assert.ok(creator.entrances.includes(plan.entrance), `simple plan stored ${plan.entrance}`);
  assert.ok(creator.holds.includes(plan.hold), `simple plan stored ${plan.hold}`);
  assert.ok(creator.exits.includes(plan.exit), `simple plan stored ${plan.exit}`);
  assert.notEqual(plan.layout, 'knSlamStack');
  for (const component of plan.components) {
    const def = J.GROUP_KEYS.includes(component.group) ? J.registry(component.group)[component.id] : null;
    if (!def || !def.capabilities) continue;
    assert.equal(def.capabilities.captionSafe, true, `simple plan stored ${component.id}`);
  }
}

const slamOn = planWith({ editor: 'advanced' }, { kinetic: true, enabled: { layout: { knSlamStack: true } } });
for (const plan of generated(slamOn)) assert.equal(plan.layout, 'knSlamStack', `advanced kinetic pool stored ${plan.layout}`);
const slamOff = planWith({ editor: 'advanced' }, { kinetic: false, enabled: { layout: { knSlamStack: true } } });
for (const plan of generated(slamOff)) assert.notEqual(plan.layout, 'knSlamStack', 'explicit knSlamStack overrode kinetic off');
assert.equal(J.registry('layout').knSlamStack.captionSafe, undefined, 'planning marked knSlamStack caption-safe');
assert.equal(J.registry('layout').knSlamStack.capabilities, undefined, 'planning wrote capabilities onto knSlamStack');

console.log(`Gate 2.5 caption planner tests passed (${project.segments.length} plans).`);
