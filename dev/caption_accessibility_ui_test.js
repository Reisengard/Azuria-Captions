/* Dependency-free structural tests for Gate 5.7 accessibility and reduced motion. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', '12c_caption_workbench.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src', '12b_caption_store.js'), 'utf8');

for (const id of ['captionReducedMotion', 'captionProfileNote', 'captionAccessibility']) assert.match(body, new RegExp(`id="${id}"`), `G5.7 is missing #${id}`);
for (const signal of ['horizontal-overflow', 'too-many-lines', 'contrast-insufficient', 'flashes', 'captionBoxWarnings']) assert.match(ui, new RegExp(signal), `G5.7 does not report ${signal}`);
assert.match(ui, /ArrowLeft.*ArrowRight/, 'timeline boundaries are not keyboard adjustable');
assert.match(ui, /動きと注目度が高いスタイル/, 'aggressive profile does not communicate higher motion');
assert.match(store, /set-project-setting/, 'reduced-motion preference is not an undoable project setting');
console.log('Gate 5.7 accessibility and reduced-motion tests passed.');
