/* Steps 3-4: placement boxes replace zones as the source of position. */
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
const frame = { width: 1080, height: 1920 };
const near = (a, b, message) => assert.ok(Math.abs(a - b) < 1e-6, `${message}: ${a} vs ${b}`);

const fresh = (extra = {}) => {
  const project = Object.assign({ schemaVersion: 3, generatorVersion: 'test', mode: 'video-captions', id: 'boxes', media: { duration: 15, width: 1080, height: 1920 },
    transcript, segments: [], plans: {}, safeZones: [], guides: [], seed: 3107, style: { preset: 'creator' }, settings: {}, createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z' }, extra);
  project.tracks = [J.defaultCaptionTrack(project)];
  const planned = J.planCaptions(project, project.media);
  project.segments = planned.segments; project.plans = planned.plans;
  return J.loadProject(clone(project));
};

/* Conversions are lossless enough that a default box reproduces today's zone exactly. */
const zone = J.createCaptionZone('bottom', frame);
const box = J.captionZoneToBox(zone, frame);
assert.deepStrictEqual(J.captionBoxToZone(box, frame), Object.assign({}, zone, { preset: 'vertical-social-safe', manual: false }));
assert.ok(J.isCaptionBox(box)); assert.ok(!J.isCaptionBox({ x: 0.5, y: 0, width: 0.6, height: 0.1 }), 'a box outside the frame is invalid');

/* The planner no longer chooses a zone: every segment sits in the track box, whatever the seed. */
const project = fresh();
const trackBox = project.tracks[0].box;
for (const seed of [1, 2, 3107, 99999]) {
  const planned = J.planCaptions(Object.assign(clone(project), { seed }), project.media);
  for (const plan of Object.values(planned.plans)) {
    assert.equal(plan.generated.zone.kind, 'bottom', `seed ${seed} moved a caption`);
    near(plan.generated.box.x, trackBox.x, 'box.x'); near(plan.generated.box.y, trackBox.y, 'box.y');
    near(plan.generated.zone.y, trackBox.y * frame.height, 'zone.y follows the box');
  }
}
assert.deepStrictEqual(J.planCaptions(clone(project), project.media).plans, J.planCaptions(clone(project), project.media).plans, 'same inputs must give the same plan');

/* Layouts take env.box / input.box, and the anchor never depends on the active word. */
const segment = project.segments[0], tokens = segment.tokenIds.map(id => project.transcript.tokens.find(token => token.id === id));
const text = tokens.map(token => token.text).join(' ');
const baseInput = { text, tokens, frame, box: trackBox, font: 'gothic', fontSize: 64, textColor: '#fff' };
const first = J.composeCaptionLayout('captionBottomStack', Object.assign({ clockTime: tokens[0].start }, baseInput));
for (const token of tokens) {
  const other = J.composeCaptionLayout('captionBottomStack', Object.assign({ clockTime: (token.start + token.end) / 2 }, baseInput));
  assert.deepStrictEqual(other.anchor, first.anchor, 'anchor moved with the active word');
  assert.deepStrictEqual(other.lines, first.lines, 'line breaks changed with the active word');
}
assert.deepStrictEqual(first.diagnostics.zone, { x: J.captionBoxToZone(trackBox, frame).x, y: J.captionBoxToZone(trackBox, frame).y, width: J.captionBoxToZone(trackBox, frame).width, height: J.captionBoxToZone(trackBox, frame).height });
const viaEnv = J.LAYOUTS.captionBottomStack.measure ? J.LAYOUTS.captionBottomStack.measure(Object.assign({ clockTime: 0 }, baseInput)) : first;
assert.deepStrictEqual(viaEnv.anchor, first.anchor);

/* Track box command: validated, replans, undoable, restores everything exactly. */
const store = new J.CaptionStore(clone(project));
const before = JSON.stringify(store.project);
const newBox = { x: 0.1, y: 0.2, width: 0.6, height: 0.25 };
store.execute({ type: 'set-track-box', trackId: J.CAPTION_PRIMARY_TRACK_ID, box: newBox, updatedAt: '2026-09-28T01:00:00.000Z' });
assert.equal(store.project.tracks[0].box.manual, true); near(store.project.tracks[0].box.x, 0.1, 'stored x');
for (const plan of Object.values(store.project.plans)) { near(plan.generated.box.y, 0.2, 'replanned y'); near(plan.generated.zone.width, 0.6 * frame.width, 'replanned width'); }
store.undo();
assert.equal(JSON.stringify(store.project), before, 'undo did not restore the project exactly');
store.redo(); near(store.project.tracks[0].box.width, 0.6, 'redo');

/* Bad boxes are rejected, never clamped, and leave the project untouched. */
const guarded = new J.CaptionStore(clone(project)), guardedBefore = JSON.stringify(guarded.project);
for (const bad of [{ x: 0.5, y: 0.1, width: 0.6, height: 0.1 }, { x: -0.1, y: 0.1, width: 0.5, height: 0.1 }, { x: 0, y: 0, width: 0, height: 0.1 }, { x: 'a', y: 0, width: 1, height: 1 }, null]) {
  assert.throws(() => guarded.execute({ type: 'set-track-box', trackId: J.CAPTION_PRIMARY_TRACK_ID, box: bad }), error => error.code === 'CAPTION_BOX_INVALID');
}
assert.throws(() => guarded.execute({ type: 'set-track-box', trackId: 'nope', box: newBox }), error => error.code === 'TRACK_NOT_FOUND');
assert.equal(JSON.stringify(guarded.project), guardedBefore);

/* Segment override wins over the track and survives re-planning; locked segments refuse it. */
const layered = new J.CaptionStore(clone(project)), target = layered.project.segments[1].id, other = layered.project.segments[2].id;
const override = { x: 0.05, y: 0.05, width: 0.9, height: 0.2 };
layered.execute({ type: 'set-segment-box', segmentId: target, box: override });
near(layered.project.plans[target].generated.box.y, 0.05, 'override drives the plan');
assert.deepStrictEqual(J.captionEffectiveBox(layered.project, layered.project.segments[1], layered.project.plans[target]), Object.assign({}, layered.project.plans[target].manual.box));
layered.execute({ type: 'set-track-box', trackId: J.CAPTION_PRIMARY_TRACK_ID, box: newBox });
layered.execute({ type: 'set-caption-style', style: Object.assign({}, layered.project.style, { intensity: 0.3 }) });
near(layered.project.plans[target].manual.box.y, 0.05, 'override survived re-planning');
near(layered.project.plans[target].generated.box.y, 0.05, 'generated box still follows the override');
near(layered.project.plans[other].generated.box.y, 0.2, 'other segments follow the track box');
assert.equal(layered.project.tracks[0].box.manual, true, 'an edited track box stays manual through a style change');
layered.execute({ type: 'set-segment-box', segmentId: target, box: null });
assert.equal(layered.project.plans[target].manual.box, undefined);
near(layered.project.plans[target].generated.box.y, 0.2, 'clearing the override returns to the track box');
layered.execute({ type: 'set-segment-lock', segmentId: target, lock: 'visualPlan', locked: true });
assert.throws(() => layered.execute({ type: 'set-segment-box', segmentId: target, box: override }), error => error.code === 'SEGMENT_FIELD_LOCKED');
J.validateProject(layered.project);
const corrupt = clone(layered.project); corrupt.plans[other].manual = { box: { x: 2, y: 0, width: 1, height: 1 } };
assert.throws(() => J.validateProject(corrupt), error => error.code === 'PLAN_BOX_INVALID');

/* Reset returns an edited track to the style default. */
const resetting = new J.CaptionStore(clone(project));
resetting.execute({ type: 'set-track-box', trackId: J.CAPTION_PRIMARY_TRACK_ID, box: newBox });
resetting.execute({ type: 'set-track-box', trackId: J.CAPTION_PRIMARY_TRACK_ID, reset: true });
assert.deepStrictEqual(resetting.project.tracks[0].box, project.tracks[0].box);

/* The position preset moves an untouched default box, but never an edited one. */
const preset = new J.CaptionStore(clone(project));
preset.execute({ type: 'set-caption-style', style: Object.assign({}, preset.project.style, { position: 'top', zones: ['top'] }) });
assert.equal(preset.project.tracks[0].box.zoneKind, 'top');
for (const plan of Object.values(preset.project.plans)) assert.equal(plan.generated.zone.kind, 'top');
const edited = new J.CaptionStore(clone(project));
edited.execute({ type: 'set-track-box', trackId: J.CAPTION_PRIMARY_TRACK_ID, box: newBox });
edited.execute({ type: 'set-caption-style', style: Object.assign({}, edited.project.style, { position: 'top', zones: ['top'] }) });
near(edited.project.tracks[0].box.y, 0.2, 'a user-edited box must not follow the preset');

/* An untouched default box follows the output frame (post format), not the source video; an edited one does not. */
const landscapeSource = clone(project); landscapeSource.media = { duration: 15, width: 1920, height: 1080 };
J.captionSyncDefaultBoxes(landscapeSource);
assert.deepStrictEqual(landscapeSource.tracks[0].box, project.tracks[0].box, 'a landscape source on the Shorts format keeps the 9:16 box');
const landscape = clone(landscapeSource); landscape.settings = { videoEdit: { format: 'youtube', clips: [], panels: [], notes: [] } };
J.captionSyncDefaultBoxes(landscape);
const landscapeZone = J.createCaptionZone('bottom', { width: 1920, height: 1080 });
near(landscape.tracks[0].box.x * 1920, landscapeZone.x, 'default box follows the frame');
near(landscape.tracks[0].box.width * 1920, landscapeZone.width, 'default box follows the frame (width)');
const editedLandscape = clone(edited.project); editedLandscape.media = landscape.media; editedLandscape.settings = landscape.settings; J.captionSyncDefaultBoxes(editedLandscape);
assert.deepStrictEqual(editedLandscape.tracks[0].box, edited.project.tracks[0].box);

/* Problems are warnings, never silent movement. */
const codes = value => J.captionBoxWarnings(value, frame).map(item => item.code);
assert.deepStrictEqual(codes(trackBox), []);
assert.ok(codes({ x: 0, y: 0.9, width: 1, height: 0.1 }).includes('box-outside-safe-area'));
assert.ok(codes({ x: 0.3, y: 0.5, width: 0.1, height: 0.1 }).includes('box-narrow'));
const cramped = new J.CaptionStore(clone(project));
const tiny = { x: 0.4, y: 0.4, width: 0.12, height: 0.06 };
cramped.execute({ type: 'set-track-box', trackId: J.CAPTION_PRIMARY_TRACK_ID, box: tiny });
for (const plan of Object.values(cramped.project.plans)) {
  near(plan.generated.box.x, 0.4, 'a box that cannot fit the text is still where the user put it');
  near(plan.generated.box.width, 0.12, 'and keeps its size');
  assert.equal(plan.generated.readability.allowed === false || plan.generated.fallback === true, true, 'an unfit box must surface as fallback/readability, not a moved caption');
}

/* Snapping: centre lines, safe edges and thirds, within a small threshold; free otherwise. */
const snapped = J.snapCaptionBox({ x: 0.195, y: 0.401, width: 0.6, height: 0.2 }, frame);
near(snapped.box.x + snapped.box.width / 2, 0.5, 'horizontal centre snapped'); assert.ok(snapped.hits.some(hit => hit.axis === 'x' && hit.name === 'center'));
const free = J.snapCaptionBox({ x: 0.13, y: 0.13, width: 0.3, height: 0.1 }, frame);
assert.deepStrictEqual(free.hits, []); near(free.box.x, 0.13, 'no snap away from targets');
const safe = J.captionSocialSafeRect(frame);
const edge = J.snapCaptionBox({ x: safe.x / frame.width + 0.004, y: 0.7, width: 0.5, height: 0.1 }, frame);
near(edge.box.x, safe.x / frame.width, 'left safe edge snapped');
const widthSnap = J.snapCaptionBox({ x: 0.1, y: 0.7, width: 0.398, height: 0.1 }, frame, { mode: 'resize' });
near(widthSnap.box.x + widthSnap.box.width, 0.5, 'right edge snaps to the centre line while resizing'); near(widthSnap.box.x, 0.1, 'resize never moves x');
const clamped = J.clampCaptionBox({ x: 0.9, y: 0.95, width: 0.4, height: 0.2 });
assert.ok(J.isCaptionBox(clamped), 'dragging clamps at the frame edge');

/* Plans saved before boxes (pixel zone only) keep their exact position. */
const legacyPlan = { zone: { id: 'z', kind: 'top', x: 81, y: 192, width: 847.8, height: 448 } };
const legacyZone = J.captionPlanZone(legacyPlan, { width: 540, height: 960 }, frame);
near(legacyZone.x, 40.5, 'legacy zone scales with the output'); near(legacyZone.y, 96, 'legacy zone y');
assert.equal(J.captionPlanZone({}, frame), null);

console.log('Placement box tests passed.');
