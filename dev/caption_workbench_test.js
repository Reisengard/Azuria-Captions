/* Dependency-free structural tests for Gate 5.2 Video Captions workbench. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
const source = require('./caption_ui_source').workbenchSource(root);

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
/* UI shell: transcript | style (wide) | video | video settings, timeline strip along the bottom */
const columns = ['caption-transcript', 'caption-stage', 'caption-inspector', 'caption-timeline-strip'].map(name => body.indexOf(`class="${name}`) >= 0 ? body.indexOf(`class="${name}`) : body.indexOf(`caption-panel ${name}`));
assert.ok(columns.every(index => index > 0) && columns.every((index, i) => i === 0 || index > columns[i - 1]), 'workbench areas are not in source order transcript / video / style / timeline');
const css = fs.readFileSync(path.join(root, 'app', 'style.css'), 'utf8');
assert.match(css, /\.caption-left \{ grid-column: 1;[\s\S]*\.caption-inspector \{ grid-column: 2;[\s\S]*\.caption-stage \{ grid-column: 3;/, 'desktop order must be transcript | style | video');
assert.ok(body.indexOf('id="captionVideoEditor"') > body.indexOf('id="captionStylePane_video"') && body.indexOf('id="captionVideoEditor"') < body.indexOf('id="captionStylePane_export"'), 'video editor is not in the Video settings tab of the Style panel');
assert.ok(['roles'].every(name => body.indexOf(`id="captionLeftPane_${name}"`) > 0 && body.indexOf(`id="captionLeftPane_${name}"`) < body.indexOf('class="caption-stage"')), 'Text roles is not a tab of the transcript column');
/* Word styles (roles): a track picker, a compositor-drawn sample, a reset per value; the spoken word's effect lives in Effects only */
const rolesPane = body.slice(body.indexOf('id="captionLeftPane_roles"'), body.indexOf('id="captionEditHolder"'));
for (const id of ['captionRoleTrack', 'captionRoleSample', 'captionRoleEmphasisAmount', 'captionRoleEmphasisHint', 'captionRoleActiveOverride', 'captionRoleActiveOverrideClear', 'captionRoleActiveOpen', 'captionRolesReset']) {
  assert.match(rolesPane, new RegExp(`id="${id}"`), `Word styles is missing #${id}`);
}
assert.doesNotMatch(body, /id="captionRoleActiveTreatment"/, 'the spoken-word effect is chosen in Effects, not in Word styles');
for (const id of ['captionRoleBaseFont', 'captionRoleBaseColor', 'captionRoleBaseFontSize', 'captionRoleActiveColor', 'captionRoleEmphasisColor', 'captionRoleEmphasisFont', 'captionRoleEmphasisScale', 'captionRoleEmphasisAmount']) {
  assert.match(rolesPane, new RegExp(`data-role-clear="${id}"`), `#${id} has no reset button`);
}
assert.match(source, /J\.paintCaptionRoleSample\(/, 'the Word styles sample is not drawn by the caption compositor');
assert.ok(body.indexOf('id="captionTimeline"') > body.indexOf('caption-timeline-strip') && body.indexOf('id="captionPlay"') > body.indexOf('caption-timeline-strip'), 'transport and timeline are not in the bottom strip');
assert.match(source, /function fitVideoColumn[\s\S]*J\.videoOutputSize[\s\S]*--caption-video-w/, 'video column width does not follow the output format');
assert.match(source, /const boxFrame = \(\) => \{[\s\S]*J\.videoOutputSize/, 'box editor frame must be the output frame, not the source video');
console.log('Gate 5.2 caption workbench tests passed.');
