/* Step 2: schema v3 (tracks, normalized box, guides, trackId) and the v2 -> v3 migration. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({}) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js' && name !== '12c_caption_workbench.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}
const clone = value => JSON.parse(JSON.stringify(value));
const stripTrack = value => { const copy = clone(value); const strip = item => { delete item.trackId; }; (copy.segments || []).forEach(strip); Object.values(copy.plans || {}).forEach(strip); return copy; };
const transcript = J.importWordJson(fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8'), { duration: 15 });

/* Boxes live in the output frame (post format), not the source video's frame: a landscape video on the default Shorts format gets the 9:16 box. */
for (const [width, height, format] of [[1080, 1920, null], [1920, 1080, null], [1920, 1080, 'youtube']]) {
  /* Build a genuine v2 project: planned segments and plans without any track data. */
  const settings = format ? { videoEdit: { format, clips: [], panels: [], notes: [] } } : {};
  const seedProject = { schemaVersion: 2, generatorVersion: 'test', mode: 'video-captions', id: `v3-${width}-${format || 'default'}`, media: { duration: 15, width, height },
    transcript, segments: [], plans: {}, safeZones: [], seed: 3107, style: { preset: 'creator' }, settings, createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z' };
  const planned = J.planCaptions(seedProject, seedProject.media);
  const v2 = Object.assign(clone(seedProject), stripTrack({ segments: planned.segments, plans: planned.plans }));
  const v2Before = JSON.stringify(v2);
  const v3 = J.loadProject(v2);

  assert.equal(JSON.stringify(v2), v2Before, 'migration mutated its input');
  assert.equal(v3.schemaVersion, 3);
  assert.equal(v3.tracks.length, 1);
  const track = v3.tracks[0];
  assert.equal(track.id, J.CAPTION_PRIMARY_TRACK_ID); assert.equal(track.primary, true);
  for (const field of ['x', 'y', 'width', 'height']) assert.ok(track.box[field] >= 0 && track.box[field] <= 1, `box.${field} is not normalized`);
  const out = J.videoOutputSize(v2), zone = J.captionProjectZones(v2, out)[0];
  assert.ok(Math.abs(track.box.x * out.width - zone.x) < 1e-3 && Math.abs(track.box.y * out.height - zone.y) < 1e-3
    && Math.abs(track.box.width * out.width - zone.width) < 1e-3 && Math.abs(track.box.height * out.height - zone.height) < 1e-3, 'box is not derived from the current zone');

  /* Existing content is untouched apart from the new trackId. */
  assert.deepStrictEqual(stripTrack({ segments: v3.segments }).segments, clone(v2.segments));
  assert.deepStrictEqual(stripTrack({ plans: v3.plans }).plans, clone(v2.plans));
  assert.ok(v3.segments.every(segment => segment.trackId === track.id));
  assert.ok(Object.values(v3.plans).every(plan => plan.trackId === track.id));
  /* Re-planning the migrated project reproduces the same plans (same seeds, same zones). */
  assert.deepStrictEqual(stripTrack({ plans: J.planCaptions(v3, v3.media).plans }).plans, clone(v2.plans), 're-plan of the migrated project changed');
  assert.deepStrictEqual(J.loadProject(J.saveProject(v3)), v3, 'v3 round trip changed the project');
}

/* Pixel safe zones become advisory normalized guides; the zones themselves stay. */
const withZone = { schemaVersion: 2, generatorVersion: 'test', mode: 'video-captions', id: 'zones', media: { duration: 15, width: 1000, height: 2000 }, transcript, segments: [], plans: {},
  safeZones: [{ id: 'z1', kind: 'custom', x: 100, y: 1000, width: 800, height: 400, manual: true }], seed: 1, style: {}, settings: {} };
const migratedZones = J.loadProject(withZone);
assert.deepStrictEqual(migratedZones.safeZones, withZone.safeZones);
assert.deepStrictEqual(migratedZones.guides, [{ id: 'z1', kind: 'custom', advisory: true, x: 0.1, y: 0.5, width: 0.8, height: 0.2 }]);
assert.deepStrictEqual(migratedZones.tracks[0].box, { x: 0.1, y: 0.5, width: 0.8, height: 0.2, zoneKind: 'custom' }, 'primary box must follow the saved zone');

/* Validation. */
const good = J.loadProject(withZone);
const invalid = (mutate, code) => { const copy = clone(good); mutate(copy); assert.throws(() => J.validateProject(copy), error => error.code === code, code); };
invalid(project => { delete project.tracks; }, 'TRACKS_REQUIRED');
invalid(project => { project.tracks = []; }, 'TRACKS_REQUIRED');
invalid(project => { project.tracks[0].primary = false; }, 'TRACK_PRIMARY_INVALID');
invalid(project => { project.tracks[0].box.width = 1.5; }, 'TRACK_BOX_INVALID');
invalid(project => { project.tracks.push(Object.assign(clone(project.tracks[0]), { primary: false })); }, 'TRACK_ID_DUPLICATE');
invalid(project => { for (const id of ['a', 'b', 'c']) project.tracks.push(Object.assign(clone(project.tracks[0]), { id, primary: false })); }, 'TRACKS_LIMIT');

/* Store: new segments carry the primary track; undo restores the exact project. */
const store = new J.CaptionStore(J.loadProject(seedFor()));
function seedFor() {
  const base = { schemaVersion: 2, generatorVersion: 'test', mode: 'video-captions', id: 'store', media: { duration: 15, width: 1080, height: 1920 }, transcript, segments: [], plans: {}, safeZones: [], seed: 5, style: {}, settings: {} };
  const planned = J.planCaptions(base, base.media);
  return Object.assign(base, stripTrack({ segments: planned.segments, plans: planned.plans }));
}
const before = store.snapshot();
const lastEnd = transcript.tokens[transcript.tokens.length - 1].end;
store.execute({ type: 'add-caption', start: lastEnd + 0.1, end: lastEnd + 0.6, text: 'Manual block' });
const added = store.project.segments.find(segment => !before.segments.some(old => old.id === segment.id));
assert.equal(added.trackId, J.CAPTION_PRIMARY_TRACK_ID);
assert.equal(store.project.plans[added.id].trackId, J.CAPTION_PRIMARY_TRACK_ID);
store.undo();
assert.deepStrictEqual(store.snapshot(), before, 'undo did not restore the project exactly');

console.log('Step 2 schema v3 tests passed.');
