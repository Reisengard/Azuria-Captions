/* Caption looks: every effect is chosen (or the profile's fixed standard); randomness only when the user asks, and then it is stored. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({ measureText: text => ({ width: Array.from(String(text)).length * 57 }) }) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js' && name !== '12c_caption_workbench.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}
const clone = value => JSON.parse(JSON.stringify(value));
const transcript = J.importWordJson(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8'), { duration: 15 });
const code = fn => { try { fn(); } catch (error) { return error.code; } return null; };
const KEYS = ['layout', 'entrance', 'hold', 'exit', 'activeWordTreatment'];
const resolved = (project, id) => J.captionResolvedPlan(project.plans[id]);
const looks = project => Object.values(project.plans).map(stored => KEYS.map(key => J.captionResolvedPlan(stored)[key]).join('|'));
if (process.env.DBG) globalThis.__looks = looks;
const exact = (store, run) => {
  const before = store.snapshot(); run(); const after = store.snapshot();
  assert.ok(store.undo()); assert.deepStrictEqual(store.snapshot(), before, 'undo must restore the project exactly');
  assert.ok(store.redo()); assert.deepStrictEqual(store.snapshot(), after, 'redo must reproduce the result exactly');
};

const make = (style = { preset: 'creator' }, seed = 3107) => {
  const project = { schemaVersion: 3, generatorVersion: 'test', mode: 'video-captions', id: 'look', media: { duration: 15, width: 1080, height: 1920 },
    transcript: clone(transcript), segments: [], plans: {}, safeZones: [], guides: [], seed, style, settings: {}, createdAt: '2026-09-29T00:00:00.000Z', updatedAt: '2026-09-29T00:00:00.000Z' };
  project.tracks = [J.defaultCaptionTrack(project)];
  const planned = J.planCaptions(project, project.media);
  project.segments = planned.segments; project.plans = planned.plans;
  return J.loadProject(clone(project));
};
const storeOf = (style, seed) => new J.CaptionStore(make(style, seed));
const STANDARD = J.CAPTION_STANDARD_LOOKS.creator;

/* ---- no hidden randomness: the standard look is the same for every caption, whatever the seed ---- */
for (const preset of ['creator', 'punchy', 'jizura-mv']) {
  const a = make({ preset }, 1), b = make({ preset }, 987654), standard = J.CAPTION_STANDARD_LOOKS[preset];
  assert.deepStrictEqual(looks(a), looks(b), `${preset}: the project seed changed the look`);
  // A caption that cannot be read in its time becomes a static plan (reported); every other caption has exactly the standard look.
  const plain = Object.values(a.plans).filter(stored => !stored.generated.fallback);
  assert.ok(plain.length >= Object.keys(a.plans).length - 2, `${preset}: too many captions were simplified`);
  assert.equal(new Set(looks({ plans: plain })).size, 1, `${preset}: captions differ although no choice was made`);
  const plan = J.captionResolvedPlan(plain[0]);
  assert.deepStrictEqual([plan.layout, plan.entrance, plan.hold, plan.exit, plan.activeWordTreatment], [standard.layout, standard.enter, standard.hold, standard.exit, standard.active]);
  for (const stored of plain) {
    assert.deepStrictEqual(stored.generated.lookWarnings, [], `${preset}: the standard look needed a warning`);
    assert.deepStrictEqual(stored.generated.overBudget, [], `${preset}: the standard look is over the motion budget`);
  }
}

/* ---- scopes: project < track < caption; reset goes back ---- */
const store = storeOf();
exact(store, () => store.execute({ type: 'set-caption-look', look: { enter: 'captionSoftRise', exit: 'captionShrinkOut' } }));
assert.ok(looks({ plans: Object.fromEntries(Object.entries(store.project.plans).filter(([, stored]) => !stored.generated.fallback)) }).every(item => item.includes('captionSoftRise') && item.includes('captionShrinkOut')), 'the project look reaches every caption');
assert.equal(store.project.style.look.enter, 'captionSoftRise');
const first = store.project.segments[0].id, second = store.project.segments[1].id;
exact(store, () => store.execute({ type: 'set-segment-look', segmentId: first, look: { enter: 'captionSoftScale' } }));
assert.equal(resolved(store.project, first).entrance, 'captionSoftScale', 'a caption keeps its own choice');
assert.equal(resolved(store.project, second).entrance, 'captionSoftRise', 'other captions keep the project look');
store.execute({ type: 'set-caption-style', style: Object.assign({}, store.project.style, { accentColor: '#ff00aa' }) });
assert.equal(resolved(store.project, first).entrance, 'captionSoftScale', 'a caption choice survives re-planning');
assert.equal(resolved(store.project, second).exit, 'captionShrinkOut', 'the project look survives re-planning');
exact(store, () => store.execute({ type: 'set-segment-look', segmentId: first, reset: true }));
assert.equal(resolved(store.project, first).entrance, 'captionSoftRise', 'reset gives the caption back to the project look');

store.execute({ type: 'add-track' });
const trackId = store.project.tracks[1].id;
store.execute({ type: 'move-segment-to-track', segmentId: second, trackId });
exact(store, () => store.execute({ type: 'set-caption-look', trackId, look: { enter: 'captionFade' } }));
assert.equal(resolved(store.project, second).entrance, 'captionFade', 'a track look beats the project look');
assert.equal(resolved(store.project, second).exit, 'captionShrinkOut', 'a track look changes only the stages it names');
assert.equal(resolved(store.project, store.project.segments.find(item => item.trackId !== trackId).id).entrance, 'captionSoftRise');
exact(store, () => store.execute({ type: 'set-caption-look', reset: true }));
assert.equal(store.project.style.look, undefined, 'project reset removes the look');
assert.equal(resolved(store.project, first).entrance, STANDARD.enter, 'project reset returns to the standard');

/* ---- older projects that used the entrance / hold / exit menus keep their choice ---- */
const legacy = make({ preset: 'jizura-mv', effect: 'captionBlur', holdEffect: 'captionWave', exitEffect: 'captionBlurOut' });
for (const item of looks({ plans: Object.fromEntries(Object.entries(legacy.plans).filter(([, stored]) => !stored.generated.fallback)) })) assert.ok(item.includes('captionBlur') && item.includes('captionWave') && item.includes('captionBlurOut'), 'a saved effect choice was lost');

/* ---- randomize: only on request, stored, deterministic, undoable ---- */
const dice = storeOf();
exact(dice, () => dice.execute({ type: 'randomize-caption-look', variation: 4 }));
const rolled = clone(dice.project.style.look);
assert.equal(Object.keys(rolled).length, 5, 'randomize stores a complete look');
const stable = looks(dice.project);
dice.execute({ type: 'set-caption-style', style: Object.assign({}, dice.project.style, { accentColor: '#123456' }) });
assert.deepStrictEqual(looks(dice.project), stable, 'a randomized look never changes by itself');
assert.equal(new Set(stable).size, 1, 'one project look for every caption');
const twin = storeOf(); twin.execute({ type: 'randomize-caption-look', variation: 4 });
assert.deepStrictEqual(twin.project.style.look, rolled, 'the same variation gives the same look');
const seen = new Set();
for (let variation = 1; variation <= 12; variation++) { const t = storeOf(); t.execute({ type: 'randomize-caption-look', variation }); seen.add(JSON.stringify(t.project.style.look)); }
assert.ok(seen.size > 1, 'different variations give different looks');

const one = storeOf(), target = one.project.segments[2].id, others = one.project.segments.filter(item => item.id !== target).map(item => item.id);
exact(one, () => one.execute({ type: 'randomize-caption-look', segmentId: target, variation: 9 }));
for (const id of others) assert.equal(resolved(one.project, id).entrance, STANDARD.enter, 'randomizing one caption left the others alone');
const lockedField = storeOf(); lockedField.execute({ type: 'set-field-lock', segmentId: target, field: 'layout', locked: true });
const layoutBefore = resolved(lockedField.project, target).layout;
lockedField.execute({ type: 'randomize-caption-look', segmentId: target, variation: 9 });
assert.equal(resolved(lockedField.project, target).layout, layoutBefore, 'a locked field is not randomized');
const locked = storeOf(); locked.execute({ type: 'set-segment-lock', segmentId: target, lock: 'visualPlan', locked: true });
assert.equal(code(() => locked.execute({ type: 'set-segment-look', segmentId: target, look: { enter: 'captionFade' } })), 'SEGMENT_FIELD_LOCKED');
assert.equal(code(() => locked.execute({ type: 'randomize-caption-look', segmentId: target })), 'SEGMENT_FIELD_LOCKED');

/* ---- bad input, and choices that cannot be used are reported ---- */
assert.equal(code(() => storeOf().execute({ type: 'set-caption-look', look: { enter: 'noSuchEffect' } })), 'CAPTION_LOOK_INVALID');
assert.equal(code(() => storeOf().execute({ type: 'set-caption-look', look: { wobble: 'captionFade' } })), 'CAPTION_LOOK_INVALID');
assert.equal(code(() => storeOf().execute({ type: 'set-caption-look', trackId: 'track_9', look: {} })), 'TRACK_NOT_FOUND');
const broken = storeOf(); broken.execute({ type: 'add-track' });
assert.equal(code(() => broken.execute({ type: 'set-track-style', trackId: 'track_2', style: { look: { exit: 'nope' } } })), 'TRACK_STYLE_INVALID');
const short = make({ preset: 'creator', look: { enter: 'captionType' } });
for (const stored of Object.values(short.plans)) {
  const plan = stored.generated;
  if (plan.entrance !== 'captionType') assert.ok(plan.lookWarnings.some(item => item.field === 'enter'), 'an entrance that could not be used was replaced silently');
}
/* ---- effect settings (Advanced): validated, undoable, layered caption > track > project, and drawn ---- */
assert.deepStrictEqual(J.captionLookSettingsSpec('treat', 'splitColor').map(item => item.key), ['colorA', 'colorB', 'sp']);
assert.deepStrictEqual(J.captionLookSettingsSpec('enter', 'captionFade').map(item => `${item.scope}.${item.key}`), ['all.duration']);
assert.deepStrictEqual(J.captionLookSettingsSpec('layout', 'captionBottomStack'), []);
assert.equal(code(() => storeOf().execute({ type: 'set-caption-look', lookSettings: { treat: { splitColor: { colorA: 'red' } } } })), 'CAPTION_LOOK_INVALID');
assert.equal(code(() => storeOf().execute({ type: 'set-caption-look', lookSettings: { treat: { splitColor: { sp: 2 } } } })), 'CAPTION_LOOK_INVALID');
assert.equal(code(() => storeOf().execute({ type: 'set-caption-look', lookSettings: { treat: { outline: { sp: .5 } } } })), 'CAPTION_LOOK_INVALID');
assert.equal(code(() => storeOf().execute({ type: 'set-caption-look', lookSettings: { enter: { captionFade: { duration: .3 } } } })), 'CAPTION_LOOK_INVALID');
{
  const store = storeOf({ preset: 'creator', editor: 'advanced', look: { treat: 'splitColor', enter: 'captionFade', active: 'captionActiveColor' } });
  const first = store.project.segments[0].id;
  exact(store, () => store.execute({ type: 'set-caption-look', lookSettings: { treat: { splitColor: { colorA: '#FF0000', sp: .3 } } } }));
  assert.deepStrictEqual(store.project.style.lookSettings, { treat: { splitColor: { colorA: '#ff0000', sp: .3 } } }, 'colours are stored lower-case');
  store.execute({ type: 'set-caption-look', lookSettings: { enter: { all: { duration: .6 } }, hold: { all: { strength: .5 } }, active: { captionActiveColor: { color: '#00ff00' } } } });
  exact(store, () => store.execute({ type: 'set-segment-look', segmentId: first, lookSettings: { treat: { splitColor: { colorB: '#0000ff' } } } }));
  const own = resolved(store.project, first).lookSettings, other = resolved(store.project, store.project.segments[1].id).lookSettings;
  assert.deepStrictEqual(own.treat.splitColor, { colorA: '#ff0000', sp: .3, colorB: '#0000ff' }, 'a caption layers its own settings over the project');
  assert.deepStrictEqual(other.treat.splitColor, { colorA: '#ff0000', sp: .3 }, 'other captions keep the project settings');
  // null clears one value; the look reset clears the settings too
  store.execute({ type: 'set-caption-look', lookSettings: { treat: { splitColor: { sp: null } } } });
  assert.deepStrictEqual(store.project.style.lookSettings.treat, { splitColor: { colorA: '#ff0000' } });
  // drawn: the chosen values reach the shared renderer
  const ctx = { save() {}, restore() {}, beginPath() {}, rect() {}, clip() {}, fillRect() {} }, seen = [], drawFx = J.drawFx;
  J.drawFx = (env, item) => { seen.push({ cut: env.cut, item }); return null; };
  try {
    const segment = store.project.segments[0];
    J.drawCaptionOverlay(ctx, store.project, segment.start + .01);
    const { cut, item } = seen.at(-1);
    assert.equal(cut.inDur, Math.min((segment.end - segment.start) * .45, .6), 'entrance length setting');
    assert.equal(cut.holdStrength, .5, 'hold strength setting');
    assert.equal(cut.treatP.colorA, '#ff0000'); assert.equal(cut.treatP.colorB, '#0000ff');
    assert.ok(Number.isFinite(cut.treatP.sp), 'unset values keep the planned param');
    assert.deepStrictEqual([item.gradient[0][1], item.gradient[3][1]], ['#ff0000', '#0000ff'], 'two tone uses the chosen colours');
    assert.equal(item.captionActive && item.captionActive.accentColor, '#00ff00', 'active word colour setting');
  } finally { J.drawFx = drawFx; }
  exact(store, () => store.execute({ type: 'set-caption-look', reset: true }));
  assert.equal(store.project.style.lookSettings, undefined);
}
{
  const store = storeOf({ preset: 'creator' }); store.execute({ type: 'add-track' });
  store.execute({ type: 'set-caption-look', lookSettings: { enter: { all: { duration: .5 } } } });
  exact(store, () => store.execute({ type: 'set-caption-look', trackId: 'track_2', lookSettings: { exit: { all: { duration: .3 } } } }));
  assert.deepStrictEqual(store.project.tracks[1].style.lookSettings, { exit: { all: { duration: .3 } } });
  assert.deepStrictEqual(J.captionTrackProjectStyle(store.project, store.project.tracks[1]).lookSettings, { enter: { all: { duration: .5 } }, exit: { all: { duration: .3 } } }, 'a track layers over the project');
  store.execute({ type: 'set-caption-look', trackId: 'track_2', look: { enter: 'captionFade' } });
  assert.deepStrictEqual(store.project.tracks[1].style.lookSettings, { exit: { all: { duration: .3 } } }, 'changing the look keeps the settings');
}
/* ---- Advanced offers every caption layout (they are not Lyric Motion's optional "extra" set), and never a Lyric Motion layout ---- */
{
  const captionLayouts = J.order('layout').filter(id => J.isCaptionPackDef(J.registry('layout')[id]));
  assert.ok(captionLayouts.length >= 7);
  for (const preset of ['creator', 'punchy', 'jizura-mv']) {
    const offered = J.captionLookOptions('layout', { mode: 'video-captions', style: { preset, editor: 'advanced' }, techniques: {} });
    assert.deepStrictEqual(offered, captionLayouts, `${preset}: advanced offers every caption layout`);
    const withLyric = J.captionLookOptions('layout', { mode: 'video-captions', style: { preset, editor: 'advanced' }, techniques: { extra: true, enabled: { layout: { knSlamStack: true } } } });
    assert.ok(withLyric.every(id => J.isCaptionPackDef(J.registry('layout')[id])), 'Lyric Motion layouts are never offered for captions');
  }
  const off = J.captionLookOptions('layout', { mode: 'video-captions', style: { preset: 'creator', editor: 'advanced' }, techniques: { enabled: { layout: { captionLeftAnchor: false } } } });
  assert.ok(!off.includes('captionLeftAnchor'), 'a layout switched off stays off');
}
console.log('Caption look tests passed.');
