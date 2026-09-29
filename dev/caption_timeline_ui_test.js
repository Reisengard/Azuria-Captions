/* Dependency-free structural tests for Gate 5.5 timeline v1. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
const ui = fs.readFileSync(path.join(root, 'src', '12c_caption_workbench.js'), 'utf8');
const store = fs.readFileSync(path.join(root, 'src', '12b_caption_store.js'), 'utf8');

for (const id of ['captionTimeline', 'captionTimelineContent', 'captionSegmentTrack', 'captionWordTrack', 'captionPlayhead', 'captionTimelineIn', 'captionTimelineOut', 'captionTimelineFit']) assert.match(body, new RegExp(`id="${id}"`));
assert.match(ui, /timelineTimeAt/, 'timeline does not map pointer position to media time');
assert.match(ui, /data-word-id/, 'word timing inspection is missing');
assert.match(ui, /startBoundaryDrag/, 'segment boundary drag is missing');
assert.match(ui, /ui\.timelineZoom >= 2/, 'word boundaries are not gated by sufficient zoom');
assert.match(store, /set-segment-boundary/, 'boundary adjustment is not an atomic command');
assert.match(store, /boundary < leftToken\.end \|\| boundary > rightToken\.start/, 'boundary command does not enforce neighboring token constraints');
console.log('Gate 5.5 timeline UI tests passed.');
