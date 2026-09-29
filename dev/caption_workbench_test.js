/* Dependency-free structural tests for Gate 5.2 Video Captions workbench. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src', '12c_caption_workbench.js'), 'utf8');

for (const id of ['captionSegmentList', 'captionPreview', 'captionSegmentInspector', 'captionTimeline', 'captionUndo', 'captionRedo', 'captionVariation', 'captionSave', 'captionExport']) {
  assert.match(body, new RegExp(`id="${id}"`), `workbench is missing #${id}`);
}
assert.match(source, /new J\.MediaSourceController/, 'workbench does not use the media lifecycle controller');
assert.match(source, /new J\.MediaPreviewController/, 'workbench does not use the synchronized preview clock');
assert.match(source, /new J\.CaptionStore/, 'workbench does not use caption command history');
assert.match(source, /J\.segmentCaptions/, 'transcript import does not create caption segments');
assert.match(source, /J\.planCaptions/, 'workbench does not create frozen visual plans');
assert.match(fs.readFileSync(path.join(root, 'src', '11c_caption_compositor.js'), 'utf8'), /J\.captionTokenStatesAt/, 'compositor does not follow active-word timing');
assert.match(body, /id="captionExport"[^>]*disabled/, 'unfinished export must not appear functional');
assert.match(source, /\/\* The single-file build[\s\S]*\r?\nbind\(\);[\s\S]*\r?\nJ\.captionWorkbench = ui;/, 'caption workbench waits too late to bind in the single-file build');
console.log('Gate 5.2 caption workbench tests passed.');
