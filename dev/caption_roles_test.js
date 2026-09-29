/* Step 5: caption roles (base / active / emphasis), no reflow, fonts. */
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
const code = fn => { try { fn(); } catch (error) { return error.code; } return null; };

const fresh = () => {
  const project = { schemaVersion: 3, generatorVersion: 'test', mode: 'video-captions', id: 'roles', media: { duration: 15, width: 1080, height: 1920 },
    transcript, segments: [], plans: {}, safeZones: [], guides: [], seed: 3107, style: { preset: 'creator' }, settings: {}, createdAt: '2026-09-28T00:00:00.000Z', updatedAt: '2026-09-28T00:00:00.000Z' };
  project.tracks = [J.defaultCaptionTrack(project)];
  const planned = J.planCaptions(project, project.media);
  project.segments = planned.segments; project.plans = planned.plans;
  return J.loadProject(clone(project));
};
const project = fresh();
const TRACK = J.CAPTION_PRIMARY_TRACK_ID;

/* ---- validation: unknown roles/fields and bad values fail loudly; nothing is clamped ---- */
assert.deepStrictEqual(J.normalizeCaptionRoles(undefined), { base: {}, active: {}, emphasis: {} });
assert.deepStrictEqual(J.normalizeCaptionRoles({ emphasis: { color: '#FFDE59', scale: 1.1 } }).emphasis, { color: '#ffde59', scale: 1.1 });
for (const bad of [{ shout: {} }, { base: { weight: 700 } }, { base: { font: 'Comic Sans' } }, { base: { color: 'red' } }, { base: { fontSize: 10 } },
  { emphasis: { scale: 2 } }, { emphasis: { threshold: 1.5 } }, { emphasis: { font: 7 } }, { active: { treatment: 'captionExplode' } }, 'text', { base: 3 }]) {
  assert.equal(code(() => J.normalizeCaptionRoles(bad)), 'TRACK_ROLE_INVALID', JSON.stringify(bad));
}
assert.equal(code(() => J.normalizeCaptionRoles({ base: { color: null } })), 'TRACK_ROLE_INVALID', 'null only clears inside an edit');
assert.ok(J.CAPTION_FONTS.every(key => J.FONTS[key]), 'every curated face is a catalogue face');
const merged = J.mergeCaptionRoles({ base: { font: 'dela' }, emphasis: { color: '#ffffff' } }, { base: { color: '#123456' }, emphasis: null });
assert.deepStrictEqual(merged, { base: { font: 'dela', color: '#123456' }, active: {}, emphasis: {} });
// a project file with a bad role is rejected on load
const broken = clone(project); broken.tracks[0].roles = { base: { font: 'nope' } };
assert.equal(code(() => J.loadProject(clone(broken))), 'TRACK_ROLE_INVALID');
// tracks written before roles existed still load and plan identically
const legacy = clone(project); delete legacy.tracks[0].roles;
assert.doesNotThrow(() => J.loadProject(clone(legacy)));
assert.deepStrictEqual(J.planCaptions(legacy, legacy.media).plans, J.planCaptions(project, project.media).plans);

/* ---- store command: undoable, exact restore; only the base role re-plans ---- */
const store = new J.CaptionStore(clone(project));
const start = JSON.stringify(store.project), plansBefore = JSON.stringify(store.project.plans);
store.execute({ type: 'set-track-roles', trackId: TRACK, roles: { emphasis: { color: '#ffde59', scale: 1.1, font: 'gothic_black' }, active: { color: '#00ffcc' } } });
assert.equal(JSON.stringify(store.project.plans), plansBefore, 'active/emphasis edits must not touch plans');
assert.equal(store.project.tracks[0].roles.emphasis.font, 'gothic_black');
store.execute({ type: 'set-track-roles', trackId: TRACK, roles: { emphasis: { scale: null } } });
assert.equal(store.project.tracks[0].roles.emphasis.scale, undefined, 'null clears a field');
assert.equal(store.project.tracks[0].roles.emphasis.color, '#ffde59');
store.undo(); assert.equal(store.project.tracks[0].roles.emphasis.scale, 1.1, 'undo restores the cleared field');
store.undo(); assert.equal(JSON.stringify(store.project), start, 'undo restored the project exactly');
store.redo(); store.redo();
store.execute({ type: 'set-track-roles', trackId: TRACK, reset: true });
assert.deepStrictEqual(store.project.tracks[0].roles, { base: {}, active: {}, emphasis: {} });

const guarded = new J.CaptionStore(clone(project)), guardedBefore = JSON.stringify(guarded.project);
assert.throws(() => guarded.execute({ type: 'set-track-roles', trackId: TRACK, roles: { base: { fontSize: 5 } } }), error => error.code === 'TRACK_ROLE_INVALID');
assert.throws(() => guarded.execute({ type: 'set-track-roles', trackId: 'nope', roles: {} }), error => error.code === 'TRACK_NOT_FOUND');
assert.equal(JSON.stringify(guarded.project), guardedBefore, 'a rejected command leaves the project untouched');

// base role: re-plans (font/size/colour follow), deterministic, restored by undo
const based = new J.CaptionStore(clone(project)), basedStart = JSON.stringify(based.project);
based.execute({ type: 'set-track-roles', trackId: TRACK, roles: { base: { font: 'mincho_bold', fontSize: 60, color: '#ffeecc' } } });
for (const plan of Object.values(based.project.plans)) {
  assert.equal(plan.generated.font, 'mincho_bold'); assert.ok(plan.generated.fontSize <= 60); assert.equal(plan.generated.textColor, '#ffeecc');
}
const again = new J.CaptionStore(clone(project));
again.execute({ type: 'set-track-roles', trackId: TRACK, roles: { base: { font: 'mincho_bold', fontSize: 60, color: '#ffeecc' } } });
assert.deepStrictEqual(again.project.plans, based.project.plans, 'same inputs -> same plan');
based.undo(); assert.equal(JSON.stringify(based.project), basedStart);
// manual and locked values survive a base change
const locked = new J.CaptionStore(clone(project)), lockedId = locked.project.segments[0].id;
locked.execute({ type: 'set-segment-box', segmentId: lockedId, box: { x: 0.1, y: 0.1, width: 0.8, height: 0.2 } });
locked.execute({ type: 'set-track-roles', trackId: TRACK, roles: { base: { font: 'round' } } });
assert.equal(locked.project.plans[lockedId].manual.box.y, 0.1, 'manual box survived the base change');

/* ---- which words count as emphasised ---- */
const segmentWith = word => project.segments.find(segment => segment.tokenIds.some(id => transcript.tokens.find(token => token.id === id).text === word));
const tokensOf = segment => segment.tokenIds.map(id => transcript.tokens.find(token => token.id === id));
const withRoles = roles => { const copy = clone(project); copy.tracks[0].roles = J.normalizeCaptionRoles(roles); return copy; };
const goSegment = segmentWith('go!'), goPlan = J.captionResolvedPlan(project.plans[goSegment.id]);
const marked = J.captionRoleRender(withRoles({ emphasis: { color: '#ffde59' } }), goSegment, goPlan, tokensOf(goSegment)).emphasis;
assert.deepStrictEqual(marked.tokenIds.map(id => transcript.tokens.find(token => token.id === id).text), ['go!'], 'default threshold marks the strong word only');
const lax = J.captionRoleRender(withRoles({ emphasis: { color: '#ffde59', threshold: 0.2 } }), goSegment, goPlan, tokensOf(goSegment)).emphasis;
assert.ok(lax.tokenIds.length > marked.tokenIds.length, 'a lower threshold marks more words');
assert.equal(J.captionRoleRender(project, goSegment, goPlan, tokensOf(goSegment)).emphasis, null, 'no emphasis style -> nothing to draw');
const manualOn = tokensOf(goSegment).map(token => Object.assign({}, token, { manualEmphasis: token.text === 'We' ? { enabled: true } : token.text === 'go!' ? { enabled: false } : undefined }));
const overridden = J.captionRoleRender(withRoles({ emphasis: { color: '#ffde59' } }), goSegment, goPlan, manualOn).emphasis;
assert.ok(!overridden || !overridden.tokenIds.includes(transcript.tokens.find(token => token.text === 'go!').id), 'manual "off" wins over the score');

/* ---- no reflow: roles never change geometry ---- */
const tokens = tokensOf(goSegment), text = tokens.map(token => token.text).join(' ');
const box = project.tracks[0].box;
const input = { text, tokens, frame, box, font: 'gothic_bold', fontSize: 64, textColor: '#ffffff', clockTime: tokens[0].start };
const plainLayout = J.composeCaptionLayout('captionBottomStack', input);
const roleLayout = J.composeCaptionLayout('captionBottomStack', Object.assign({}, input, { emphasis: marked, activeTreatment: 'captionActiveScale', accentColor: '#00ffcc' }));
for (const field of ['anchor', 'lines', 'lineBreaks', 'fontSize', 'lineHeight', 'diagnostics']) assert.deepStrictEqual(roleLayout[field], plainLayout[field], `${field} moved with roles`);
assert.equal(roleLayout.items[0].text, plainLayout.items[0].text); assert.equal(roleLayout.items[0].size, plainLayout.items[0].size);

/* ---- glyph styling: emphasised glyphs restyle in place; the second font is squeezed, never widened ---- */
const advances = { gothic_bold: 1, gothic_black: 1.4 };
const realAdv = J.metrics.adv; J.metrics.adv = (key, ch) => (advances[key] || 1) * (ch === 'i' ? 0.5 : 1);
try {
  const item = { text: 'go! ok', font: 'gothic_bold', size: 64, charFns: [], captionActive: { tokens: [
    { id: 'a', text: 'go!', start: 0, end: 1 }, { id: 'b', text: 'ok', start: 1, end: 2 }], clockTime: 5, treatment: 'captionActiveColor',
    emphasis: { tokenIds: ['a'], color: '#ffde59', scale: 1.1, font: 'gothic_black' } } };
  J.prepareCaptionActiveItem({ sc: { accent: '#fff' } }, item);
  const glyphs = J.layoutText(item), fn = J.combineChar(item.charFns);
  const styled = glyphs.map(glyph => fn(glyph.i, glyph));
  for (const index of [0, 1, 2]) {
    assert.equal(styled[index].color, '#ffde59'); assert.equal(styled[index].font, 'gothic_black');
    assert.equal(styled[index].s, 1.1);
    assert.ok(Math.abs(styled[index].sx - 1 / 1.4) < 1e-9, 'a wider second face is squeezed to the base advance');
  }
  assert.equal(styled[3], null, 'the space is not styled'); assert.equal(styled[4], null); assert.equal(styled[5], null, 'other words keep the base look');
  const before = J.layoutText({ text: 'go! ok', font: 'gothic_bold', size: 64 });
  assert.deepStrictEqual(glyphs.map(g => [g.x, g.y, g.w]), before.map(g => [g.x, g.y, g.w]), 'glyph slots do not depend on roles');
} finally { J.metrics.adv = realAdv; }

/* ---- fonts: bundled-font plumbing and status ---- */
assert.ok(Array.isArray(J.BUNDLED_FONT_KEYS));
assert.equal(J.isBundledFont('gothic_bold'), false, 'only faces with a file in the manifest are bundled (browser globals are absent in this harness)');
const status = J.captionFontStatus(withRoles({ emphasis: { font: 'dela' } }));
assert.deepStrictEqual(status.map(item => item.key).sort(), ['dela', 'gothic_bold']);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'fonts', 'manifest.json'), 'utf8'));
for (const font of manifest.fonts) assert.ok(fs.existsSync(path.join(root, 'assets', 'fonts', font.file)), `${font.file} is missing`);
for (const font of manifest.fonts) assert.ok(J.CAPTION_FONTS.includes(font.key) && font.license && font.file && font.family, `manifest entry ${font.key || '?'} is incomplete`);

console.log('Caption roles tests passed.');
