/* Dependency-free structural tests for Gate 5.3 transcript and segment editing UI. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src', '12c_caption_workbench.js'), 'utf8');

for (const id of ['captionTokenList', 'captionSelectedStart', 'captionSelectedEnd', 'captionSelectedQuality', 'captionMerge', 'captionMergePrev', 'captionEditError',
  'captionPrev', 'captionNext', 'captionWordEditor', 'captionWordText', 'captionStartAtPlayhead', 'captionEndAtPlayhead', 'captionMoveWordPicker', 'captionEditLook']) {
  assert.match(body, new RegExp(`id="${id}"`), `G5.3 editor is missing #${id}`);
}
/* Caption tab: warnings come before the words; words are chips (split between them, emphasis auto / on / off); rare actions are folded */
const captionPane = body.slice(body.indexOf('id="captionLeftPane_caption"'), body.indexOf('class="caption-stage"'));
assert.ok(captionPane.indexOf('id="captionAccessibility"') < captionPane.indexOf('id="captionTokenList"'), 'warnings must come before the words');
for (const state of ['auto', 'on', 'off']) assert.match(captionPane, new RegExp(`data-emphasis="${state}"`), `emphasis has no "${state}" choice`);
assert.match(source, /EMPHASIS_VALUES = \{ auto: null, on: \{ enabled: true[^}]*\}, off: \{ enabled: false/, 'emphasis choices must map to cleared / manual on / manual off');
assert.match(source, /dataset\.splitBefore = token\.id/, 'words are not split from the chips');
assert.match(source, /J\.captionEmphasizedTokenIds\(/, 'chips do not show which words are emphasised');
assert.match(captionPane, /<details id="captionMoveSection"/, 'moving to another track is not folded away');
assert.match(captionPane, /<details id="captionLookSection"/, 'look and motion are not folded away');
assert.match(captionPane, /id="captionLock" type="checkbox"/, 'keeping a caption as is must read as an on/off setting');
for (const command of ['edit-token-text', 'set-manual-emphasis', 'split-segment', 'merge-segments', 'set-segment-timing']) {
  assert.match(source, new RegExp(`type: '${command}'`), `G5.3 UI does not issue ${command}`);
}
assert.match(source, /ui\.errors\[token\.id\]/, 'token validation is not attached to affected tokens');
assert.match(source, /ui\.errors\[segment\.id\]/, 'segment validation is not attached to affected segments');
assert.match(source, /previous && start < previous\.end/, 'numeric timing does not enforce the previous segment boundary');
assert.match(source, /next && end > next\.start/, 'numeric timing does not enforce the next segment boundary');
console.log('Gate 5.3 transcript and segment editing UI tests passed.');
