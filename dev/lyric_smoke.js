/* Dependency-free structural regression test for the existing Lyric Motion planner. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');

// Engine modules define browser helpers but planning does not need a live DOM.
global.window = globalThis;
global.document = {
  fonts: { check: () => true, add: () => {}, ready: Promise.resolve() },
  createElement: () => ({ getContext: () => ({}) }),
};

const sources = fs.readdirSync(path.join(root, 'src'))
  .filter(name => name.endsWith('.js') && name !== '12_ui.js')
  .sort();

for (const name of sources) {
  const filename = path.join(root, 'src', name);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

const fixtureDir = path.join(__dirname, 'fixtures', 'lyrics');
const input = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'smoke-project.json'), 'utf8'));
const expected = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'smoke-plan.json'), 'utf8'));
const project = Object.assign(J.defaultProject(), input);
const plan = J.plan(project, null);
const actual = {
  duration: plan.duration,
  lines: plan.lines.map(({ text, start, end, seed }) => ({ text, start, end, seed })),
  cuts: plan.cuts.map(({ text, line, start, end, layout, enter, hold, exit, decor, treat, bg, cam, seed }) => ({
    text, line, start, end, layout, enter, hold, exit,
    decor: decor.map(item => item.id), treat, bg, cam, seed,
  })),
};

assert.deepStrictEqual(actual, expected);
console.log(`Lyric Motion smoke passed (${actual.lines.length} lines, ${actual.cuts.length} cuts, seed ${project.seed}).`);
