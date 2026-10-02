/* Dependency-free structural tests for Gate 5.6 save, reopen, and relink. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
const ui = require('./caption_ui_source').workbenchSource(root);

for (const id of ['captionProjectFile', 'captionSave', 'captionRelinkNotice', 'captionRelinkFile']) assert.match(body, new RegExp(`id="${id}"`), `G5.6 is missing #${id}`);
assert.match(ui, /J\.loadProject\(await file\.text\(\)\)/, 'project open does not use schema validation and migration');
assert.match(ui, /ui\.store\.serialize\(\)/, 'save does not use the caption project serializer');
assert.match(ui, /ui\.media\.relink\(\[file\], expectedMedia\)/, 'relink does not verify expected media');
assert.match(ui, /MEDIA_RELINK_MISMATCH/, 'wrong-media mismatch is not surfaced');
assert.match(ui, /frozenPlans/, 'relink does not guard reproducible frozen plans');
assert.match(ui, /loaded\.media\.fingerprint \|\| loaded\.media\.relinkRequired/, 'reopened media is not marked for relink');
console.log('Gate 5.6 project lifecycle UI tests passed.');
