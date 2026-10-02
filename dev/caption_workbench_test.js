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
/* UI shell (U1): slim top bar | icon rail + one drawer | preview stage, timeline strip along the bottom */
const order = ['class="caption-rail"', 'id="captionDrawer"', 'class="caption-stage"', 'class="caption-timeline-strip"'].map(marker => body.indexOf(marker));
assert.ok(order.every(index => index > 0) && order.every((index, i) => i === 0 || index > order[i - 1]), 'workbench areas are not in source order rail / drawer / preview / timeline');
const css = fs.readFileSync(path.join(root, 'app', 'style.css'), 'utf8');
assert.match(css, /\.caption-rail \{ grid-column: 1;[\s\S]*\.caption-drawer \{ grid-column: 2;[\s\S]*\.caption-stage \{ grid-column: 3;/, 'desktop order must be rail | drawer | preview');
assert.match(css, /\.caption-workbench\[data-drawer=""\] \{ --caption-drawer-w: 0px( !important)?; \}/, 'a closed drawer must give its width to the preview');
assert.ok(body.indexOf('id="captionVideoEditor"') > body.indexOf('id="captionStylePane_video"') && body.indexOf('id="captionVideoEditor"') < body.indexOf('class="caption-stage"'), 'video editor is not in the Video pane');
// U3: the Box and Export tabs are gone; the box is a popover on the preview, Export is a dialog
for (const name of ['box', 'export']) assert.doesNotMatch(body, new RegExp(`id="captionRail_${name}"|id="captionStylePane_${name}"`), `the ${name} pane must be gone (U3)`);
assert.match(body, /<dialog id="captionExportDlg"[\s\S]*id="captionExportProgress"[\s\S]*id="captionExportPanel"[\s\S]*<\/dialog>/, 'Export is a dialog with progress and a start / cancel button');
assert.ok(body.indexOf('id="captionBoxPanel"') > body.indexOf('id="captionBoxHolder"') && body.indexOf('id="captionBoxHolder"') > body.indexOf('class="caption-stage"'), 'the box panel waits in a holder beside the preview until its popover opens');
for (const name of ['captions', 'text', 'effects', 'tracks', 'video']) assert.match(body, new RegExp(`id="captionRail_${name}"[^>]*data-drawer="${name}"`), `the rail has no ${name} item`);
assert.doesNotMatch(body, /id="captionLeftPane_roles"/, 'Style and Word styles are one Text pane (U2)');
assert.ok(body.indexOf('id="captionStylePane_style"') > body.indexOf('id="captionDrawer"') && body.indexOf('id="captionStylePane_style"') < body.indexOf('class="caption-stage"'), 'the Text pane is not in the drawer');
/* slim top bar: undo / redo, mode, menu, export; everything else lives in the ⋯ menu */
const bar = body.slice(body.indexOf('<header class="bar caption-bar">'), body.indexOf('</header>'));
const menu = bar.slice(bar.indexOf('id="captionMenu"'));
for (const id of ['captionUndo', 'captionRedo', 'captionModeEasy', 'captionModePro', 'captionMenuButton', 'captionExport']) assert.match(bar, new RegExp(`id="${id}"`), `top bar lacks #${id}`);
for (const id of ['captionNew', 'captionProjectFile', 'captionSave', 'captionStyleSave', 'captionStyleFile', 'captionHelp', 'captionTerms']) assert.ok(menu.includes(`id="${id}"`), `#${id} is not in the ⋯ menu`);
assert.match(bar, /<div class="brand"><span class="word">Azuria<b>Sub<\/b><\/span>/, 'the brand is Azuria Sub');
assert.ok(body.slice(body.indexOf('id="captionStylePane_effects"')).indexOf('id="captionVariation"') < body.slice(body.indexOf('id="captionStylePane_effects"')).indexOf('id="captionLookPanel"'), 'Randomize everything belongs at the top of the Effects pane');
assert.match(css, /html\[data-product-mode=video-captions\] \{[^}]*#b39d68[^}]*\}/i, 'the captions product must use the Azuria Sub gold');
for (const color of ['#121827', '#414652', '#364c6b', '#b39d68']) assert.ok(css.toLowerCase().includes(color), `palette colour ${color} is missing`);
/* Word styles (roles): a track picker, a compositor-drawn sample, a reset per value; the spoken word's effect lives in Effects only */
const rolesPane = body.slice(body.indexOf('id="captionStylePane_style"'), body.indexOf('id="captionStylePane_effects"'));
assert.ok(rolesPane.indexOf('id="captionRoleSample"') < rolesPane.indexOf('<details'), 'the one sample is at the top of the Text pane');
assert.equal((rolesPane.match(/<canvas/g) || []).length, 1, 'the Text pane has exactly one sample');
assert.ok((rolesPane.match(/<details class="caption-fold/g) || []).length >= 6, 'the Text pane sections fold');
for (const id of ['captionRoleTrack', 'captionRoleSample', 'captionRoleEmphasisAmount', 'captionRoleEmphasisHint', 'captionRoleActiveOverride', 'captionRoleActiveOverrideClear', 'captionRoleActiveOpen', 'captionRolesReset']) {
  assert.match(rolesPane, new RegExp(`id="${id}"`), `Word styles is missing #${id}`);
}
assert.doesNotMatch(body, /id="captionRoleActiveTreatment"/, 'the spoken-word effect is chosen in Effects, not in Word styles');
for (const id of ['captionRoleBaseFont', 'captionRoleBaseColor', 'captionRoleBaseFontSize', 'captionRoleActiveColor', 'captionRoleEmphasisColor', 'captionRoleEmphasisFont', 'captionRoleEmphasisScale', 'captionRoleEmphasisAmount']) {
  assert.match(rolesPane, new RegExp(`data-role-clear="${id}"`), `#${id} has no reset button`);
}
const shell = fs.readFileSync(path.join(root, 'src', '12bx_caption_shell.js'), 'utf8');
assert.match(shell, /const DRAWER_OF_STYLE_TAB = \{ style: 'text', effects: 'effects', tracks: 'tracks', video: 'video' \}/, 'old Style tabs do not route to drawers');
assert.match(shell, /DRAWER_OF_LEFT_TAB = \{ transcript: 'captions', roles: 'text' \}/, 'old left tabs do not route to drawers');
assert.match(shell, /localStorage\.setItem\(PREF_KEY/, 'the open drawer is not kept as a view preference');
assert.doesNotMatch(shell, /store\.|runCommand/, 'the shell must not touch the project');
assert.match(shell, /selectStyleTab, selectLeftTab/, 'the shell must provide W.selectStyleTab for the Effects shortcuts');
assert.match(source, /J\.paintCaptionRoleSample\(/, 'the Word styles sample is not drawn by the caption compositor');
assert.ok(body.indexOf('id="captionTimeline"') > body.indexOf('caption-timeline-strip') && body.indexOf('id="captionPlay"') > body.indexOf('caption-timeline-strip'), 'transport and timeline are not in the bottom strip');
assert.match(source, /function fitPreviewFrame[\s\S]*J\.videoOutputSize[\s\S]*frame\.style\.width/, 'the preview frame does not follow the output format');
assert.match(source, /const boxFrame = \(\) => \{[\s\S]*J\.videoOutputSize/, 'box editor frame must be the output frame, not the source video');
console.log('Gate 5.2 caption workbench tests passed.');
