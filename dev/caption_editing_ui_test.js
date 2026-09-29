/* Dependency-free structural tests for Gate 5.3 transcript and segment editing UI. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src', '12c_caption_workbench.js'), 'utf8');

for (const id of ['captionTokenList', 'captionSelectedStart', 'captionSelectedEnd', 'captionSelectedQuality', 'captionSplitPoint', 'captionSplit', 'captionMerge', 'captionEditError']) {
  assert.match(body, new RegExp(`id="${id}"`), `G5.3 editor is missing #${id}`);
}
for (const command of ['edit-token-text', 'set-manual-emphasis', 'split-segment', 'merge-segments', 'set-segment-timing']) {
  assert.match(source, new RegExp(`type: '${command}'`), `G5.3 UI does not issue ${command}`);
}
assert.match(source, /ui\.errors\[token\.id\]/, 'token validation is not attached to affected tokens');
assert.match(source, /ui\.errors\[segment\.id\]/, 'segment validation is not attached to affected segments');
assert.match(source, /previous && start < previous\.end/, 'numeric timing does not enforce the previous segment boundary');
assert.match(source, /next && end > next\.start/, 'numeric timing does not enforce the next segment boundary');
console.log('Gate 5.3 transcript and segment editing UI tests passed.');
