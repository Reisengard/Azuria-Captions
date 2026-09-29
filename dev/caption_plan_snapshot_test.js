/* Step 0 safety net: frozen caption plans from the shared fixture.
   Refactor steps must leave these plans byte-identical unless a change is intended (--update). */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const snapshotFile = path.join(__dirname, 'fixtures', 'plans', 'plan-snapshots.json');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({ measureText: text => ({ width: Array.from(String(text)).length * 57 }) }) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

const raw = fs.readFileSync(path.join(__dirname, 'fixtures', 'captions', 'word-timestamps.json'), 'utf8');
const scenes = [];
for (const [format, width, height] of [['portrait', 1080, 1920], ['landscape', 1920, 1080]]) {
  for (const preset of ['creator', 'punchy', 'jizura-mv']) {
    const media = { duration: 15, width, height };
    const transcript = J.importWordJson(raw, { duration: 15 });
    const segmented = J.segmentCaptions(transcript, { duration: 15, safeZone: { width: Math.round(width * 0.78) } });
    const project = { schemaVersion: 2, generatorVersion: 'snapshot', mode: 'video-captions', id: `snapshot-${format}-${preset}`, media, transcript,
      segments: segmented.segments, style: { preset }, plans: {}, safeZones: [], seed: 3107, settings: {} };
    const plan = J.planCaptions(project, media);
    assert.deepStrictEqual(J.planCaptions(project, media), plan, `${format}/${preset} is not deterministic`);
    scenes.push([`${format}/${preset}`, { segments: project.segments, plans: plan.plans }]);
  }
}
const actual = JSON.parse(JSON.stringify(Object.fromEntries(scenes)));

if (process.argv.includes('--update')) {
  fs.mkdirSync(path.dirname(snapshotFile), { recursive: true });
  fs.writeFileSync(snapshotFile, JSON.stringify(actual, null, 1) + '\n');
  console.log(`Plan snapshots updated (${scenes.length} scenes).`);
} else {
  assert.ok(fs.existsSync(snapshotFile), 'plan snapshots missing; run with --update');
  const expected = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
  for (const key of Object.keys(expected)) assert.deepStrictEqual(actual[key], expected[key], `plan snapshot changed for ${key}`);
  assert.deepStrictEqual(Object.keys(actual), Object.keys(expected), 'snapshot scene list changed');
  console.log(`Plan snapshot tests passed (${scenes.length} scenes).`);
}
