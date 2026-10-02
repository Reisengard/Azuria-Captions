/* ============================================================
   JIZURA — Video Captions workbench: Tracks panel and the placement box
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb;
const { ui, $, fmt, status, selectedSegment, PRIMARY_TRACK, segmentTrackId, activeTrack, trackName, runCommand, commandError, boxWarningText, on, emit } = W;
/* ---- Placement box tool (delta plan step 4) ----
   Drag to move, drag the right handle to change width, arrow keys nudge, or type X/Y/W/H.
   Snap targets are the centre lines, the social-safe edges and thirds; hold Alt to drag freely.
   Editing never moves text on its own: unfit or unsafe boxes only produce warnings. */
const BOX_STEP = 0.005, BOX_STEP_BIG = 0.02;
/* The frame a box is edited in is the output frame (post format), not the source video: the preview shows the output. */
const boxFrame = () => {
  const media = ui.store.project.media, out = J.videoOutputSize && J.videoOutputSize(ui.store.project);
  if (out && out.width > 0 && out.height > 0) return { width: out.width, height: out.height };
  return media && media.width > 0 && media.height > 0 ? { width: media.width, height: media.height } : { width: 1080, height: 1920 };
};

function boxContext() {
  const project = ui.store.project, segment = selectedSegment(), track = activeTrack();
  const onTrack = !!(segment && track && segmentTrackId(segment) === track.id);
  if ($('captionBoxScope').value === 'segment' && onTrack) return { scope: 'segment', segment, track, box: J.captionEffectiveBox(project, segment, project.plans[segment.id]) };
  return { scope: 'track', track, box: track && track.box };
}

function commitBox(context, box) {
  const command = context.scope === 'segment' ? { type: 'set-segment-box', segmentId: context.segment.id, box } : { type: 'set-track-box', trackId: context.track.id, box };
  return runCommand(command, context.segment && context.segment.id);
}

function renderBoxPanel() {
  const segment = selectedSegment(), track = activeTrack(), scope = $('captionBoxScope'), segmentOption = $('captionBoxScopeSegment');
  const onTrack = !!(segment && track && segmentTrackId(segment) === track.id);
  segmentOption.disabled = !onTrack;
  if (!onTrack && scope.value === 'segment') scope.value = 'track';
  const context = boxContext(), box = context.box, enabled = !!box;
  for (const [id, key] of [['captionBoxX', 'x'], ['captionBoxY', 'y'], ['captionBoxWidth', 'width'], ['captionBoxHeight', 'height']]) {
    $(id).disabled = !enabled; $(id).value = enabled ? +(box[key] * 100).toFixed(2) : '';
  }
  $('captionBoxReset').disabled = !enabled;
  const warnings = $('captionBoxWarnings'); warnings.replaceChildren();
  if (enabled) for (const warning of J.captionBoxWarnings(box, boxFrame())) { const item = document.createElement('div'); item.className = 'caption-warning'; item.textContent = boxWarningText(warning); warnings.appendChild(item); }
  buildBoxGhosts(); paintBoxEditor();
}

/* Other tracks' boxes appear as dashed outlines while one track's box is edited. */
function buildBoxGhosts() {
  const host = $('captionBoxGhosts'); if (!host) return;
  host.replaceChildren();
  const active = activeTrack();
  for (const track of ui.store.project.tracks || []) {
    if (active && track.id === active.id) continue;
    const ghost = document.createElement('div'); ghost.className = 'caption-box-ghost'; ghost.dataset.ghostTrack = track.id;
    const label = document.createElement('span'); label.textContent = track.name || track.id; ghost.appendChild(label); host.appendChild(ghost);
  }
  host.hidden = !host.childElementCount;
}

function positionBoxGhosts() {
  const host = $('captionBoxGhosts'), canvas = $('captionPreview'), frame = $('captionPreviewFrame'), media = ui.store.project.media;
  if (!host || host.hidden || !canvas.getBoundingClientRect || !frame.getBoundingClientRect) return;
  const rect = canvas.getBoundingClientRect(), parent = frame.getBoundingClientRect(), visible = !!(media && media.width > 0 && ui.preview);
  host.querySelectorAll('[data-ghost-track]').forEach(ghost => {
    const track = J.captionTrack(ui.store.project, ghost.dataset.ghostTrack), box = track && track.box;
    ghost.hidden = !(visible && J.isCaptionBox(box)); if (ghost.hidden) return;
    Object.assign(ghost.style, { left: `${rect.left - parent.left + box.x * rect.width}px`, top: `${rect.top - parent.top + box.y * rect.height}px`,
      width: `${box.width * rect.width}px`, height: `${box.height * rect.height}px` });
  });
}

function paintBoxEditor(override) {
  positionBoxGhosts();
  const editor = $('captionBoxEditor'), canvas = $('captionPreview'), frame = $('captionPreviewFrame');
  if (!editor || !canvas.getBoundingClientRect || !frame.getBoundingClientRect) return;
  const box = override || boxContext().box, media = ui.store.project.media;
  editor.hidden = !(box && media && media.width > 0 && ui.preview);
  if (editor.hidden) return;
  const rect = canvas.getBoundingClientRect(), parent = frame.getBoundingClientRect();
  Object.assign(editor.style, { left: `${rect.left - parent.left + box.x * rect.width}px`, top: `${rect.top - parent.top + box.y * rect.height}px`,
    width: `${box.width * rect.width}px`, height: `${box.height * rect.height}px` });
}

function paintSnapLines(hits) {
  const canvas = $('captionPreview'), frame = $('captionPreviewFrame'), rect = canvas.getBoundingClientRect(), parent = frame.getBoundingClientRect();
  const x = (hits || []).find(hit => hit.axis === 'x'), y = (hits || []).find(hit => hit.axis === 'y');
  $('captionBoxSnapX').hidden = !x; $('captionBoxSnapY').hidden = !y;
  if (x) $('captionBoxSnapX').style.left = `${rect.left - parent.left + x.at * rect.width}px`;
  if (y) $('captionBoxSnapY').style.top = `${rect.top - parent.top + y.at * rect.height}px`;
}

function startBoxDrag(event) {
  const context = boxContext(); if (!context.box || event.button > 0) return;
  event.preventDefault(); if (event.currentTarget.setPointerCapture) try { event.currentTarget.setPointerCapture(event.pointerId); } catch (_) { /* synthetic pointers */ }
  ui.boxDrag = { context, origin: J.roundCaptionBox(context.box), x: event.clientX, y: event.clientY, mode: event.target.dataset && event.target.dataset.boxHandle ? 'resize' : 'move', box: null };
}

function moveBoxDrag(event) {
  const drag = ui.boxDrag; if (!drag) return;
  const rect = $('captionPreview').getBoundingClientRect(); if (!(rect.width > 0 && rect.height > 0)) return;
  const dx = (event.clientX - drag.x) / rect.width, dy = (event.clientY - drag.y) / rect.height, o = drag.origin;
  let next = drag.mode === 'resize' ? { x: o.x, y: o.y, width: o.width + dx, height: o.height } : { x: o.x + dx, y: o.y + dy, width: o.width, height: o.height };
  next = J.clampCaptionBox(next);
  let hits = [];
  if (!event.altKey) { const snapped = J.snapCaptionBox(next, boxFrame(), { mode: drag.mode }); next = snapped.box; hits = snapped.hits; }
  drag.box = next; paintBoxEditor(next); paintSnapLines(hits);
  status(`位置 X ${(next.x * 100).toFixed(1)}% · Y ${(next.y * 100).toFixed(1)}% · 幅 ${(next.width * 100).toFixed(1)}%`);
}

function finishBoxDrag(cancel) {
  const drag = ui.boxDrag; if (!drag) return; ui.boxDrag = null; paintSnapLines(null);
  if (cancel === true || !drag.box || JSON.stringify(J.roundCaptionBox(drag.box)) === JSON.stringify(drag.origin)) { renderBoxPanel(); return; }
  commitBox(drag.context, J.roundCaptionBox(drag.box));
}

function nudgeBox(event) {
  const arrows = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }, move = arrows[event.key];
  if (event.key === 'Escape' && ui.boxDrag) { finishBoxDrag(true); return; }
  if (!move) return;
  const context = boxContext(); if (!context.box) return;
  event.preventDefault();
  const step = event.shiftKey ? BOX_STEP_BIG : BOX_STEP, o = context.box;
  // Keyboard nudges stop at the frame edge instead of being rejected.
  commitBox(context, J.roundCaptionBox(J.clampCaptionBox({ x: o.x + move[0] * step, y: o.y + move[1] * step, width: o.width, height: o.height })));
  const editor = $('captionBoxEditor'); if (editor) editor.focus();
}

function applyBoxInputs(input) {
  const context = boxContext(); if (!context.box) return;
  // Only the edited field changes; the displayed values are rounded, so the others keep their exact stored value.
  const keys = { captionBoxX: 'x', captionBoxY: 'y', captionBoxWidth: 'width', captionBoxHeight: 'height' }, key = keys[input.id];
  commitBox(context, J.roundCaptionBox(Object.assign({}, context.box, { [key]: Number(input.value) / 100 })));
}

function resetBox() {
  const context = boxContext(); if (!context.box) return;
  if (context.scope === 'segment') runCommand({ type: 'set-segment-box', segmentId: context.segment.id, box: null }, context.segment.id);
  else runCommand({ type: 'set-track-box', trackId: context.track.id, reset: true });
}
/* ---- tracks (delta plan step 6) ----
   Up to three tracks show captions at once. The list picks the track the box and role panels edit; the
   timeline has one row per track; other tracks' boxes show as dashed outlines while a box is edited. */
function renderTracksPanel() {
  const project = ui.store.project, tracks = project.tracks || [], track = activeTrack(), list = $('captionTrackList');
  list.replaceChildren();
  for (const item of tracks) {
    const li = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.className = 'caption-track-item'; button.dataset.trackSelect = item.id; button.setAttribute('aria-pressed', String(!!track && item.id === track.id));
    const name = document.createElement('span'), meta = document.createElement('small');
    name.textContent = item.name || item.id; meta.textContent = `${J.captionTrackSegments(project, item.id).length}件の字幕${item.primary ? '・メイン' : ''}`;
    button.append(name, meta); li.appendChild(button); list.appendChild(li);
  }
  const index = track ? tracks.indexOf(track) : -1, own = track && track.style || {};
  $('captionTrackAdd').disabled = tracks.length >= J.CAPTION_MAX_TRACKS;
  $('captionTrackReroll').disabled = !track || !J.captionTrackSegments(project, track.id).length;
  const name = $('captionTrackName'); name.disabled = !track; if (document.activeElement !== name) name.value = track ? track.name || '' : '';
  $('captionTrackForward').disabled = !track || track.primary || index >= tracks.length - 1;
  $('captionTrackBack').disabled = !track || track.primary || index <= 1;
  $('captionTrackDelete').disabled = !track || track.primary;
  $('captionTrackPreset').disabled = !track; $('captionTrackPreset').value = own.preset || '';
  $('captionTrackTreatment').disabled = !track; $('captionTrackTreatment').value = own.captionTreatment || '';
  const accent = $('captionTrackAccent'); accent.disabled = !track; if (own.accentColor) accent.value = own.accentColor; accent.dataset.unset = own.accentColor ? '' : '1';
  $('captionTrackAccentClear').disabled = !track || !own.accentColor;
  const warnings = $('captionTrackWarnings'); warnings.replaceChildren();
  const seen = new Set();
  for (const hit of J.captionBoxCollisions(project)) {
    const key = [hit.trackId, hit.otherTrackId].sort().join('|'); if (seen.has(key)) continue; seen.add(key);
    const item = document.createElement('div'); item.className = 'caption-warning';
    item.textContent = `トラックの位置ボックスが重なっています: ${trackName(hit.trackId)} / ${trackName(hit.otherTrackId)} ${fmt(hit.start)}`; warnings.appendChild(item);
  }
}

function selectTrack(trackId) {
  const project = ui.store.project, track = J.captionTrack(project, trackId); if (!track || !(project.tracks || []).includes(track)) return;
  ui.trackId = track.id;
  const segment = selectedSegment();
  if (!segment || segmentTrackId(segment) !== track.id) ui.selectedId = (J.captionTrackSegments(project, track.id)[0] || {}).id || null;
  ui.moveTokens.clear(); emit('project');
}

function addTrack() {
  const id = J.nextCaptionTrackId(ui.store.project);
  if (runCommand({ type: 'add-track', trackId: id })) { ui.trackId = id; emit('project'); status('トラックを追加しました。'); }
}

function deleteTrack(trackId) {
  const track = trackId ? J.captionTrack(ui.store.project, trackId) : activeTrack(); if (!track || track.primary) return;
  const count = J.captionTrackSegments(ui.store.project, track.id).length;
  if (!window.confirm(`トラック「${track.name || track.id}」を削除します。このトラックの字幕（${count}件）と単語も削除されます。「元に戻す」で復元できます。続けますか？`)) return;
  if (runCommand({ type: 'remove-track', trackId: track.id })) { ui.trackId = PRIMARY_TRACK; emit('project'); status('トラックを削除しました。'); }
}

function reorderTrack(step, trackId) {
  const project = ui.store.project, track = trackId ? J.captionTrack(project, trackId) : activeTrack(); if (!track) return false;
  return runCommand({ type: 'reorder-track', trackId: track.id, toIndex: project.tracks.indexOf(track) + step });
}
function renameTrack(trackId, name) { return runCommand({ type: 'rename-track', trackId, name }); }
function rerollTrack(trackId) {
  if (!J.captionTrackSegments(ui.store.project, trackId).length) { status('このトラックには字幕がありません。', true); return false; }
  const done = runCommand({ type: 'randomize-caption-look', trackId, variation: ++ui.variation }); if (done) status('トラックのエフェクトをランダムに決めました。');
  return done;
}

function moveToTrack(whole) {
  const segment = selectedSegment(), target = $('captionMoveTrack').value; if (!segment || !target) return;
  const ids = whole ? segment.tokenIds.slice() : Array.from(ui.moveTokens).filter(id => segment.tokenIds.includes(id));
  if (!ids.length) { status(commandError({ code: 'TOKENS_REQUIRED' }), true); return; }
  const command = whole ? { type: 'move-segment-to-track', segmentId: segment.id, trackId: target } : { type: 'move-tokens-to-track', tokenIds: ids, trackId: target };
  ui.moveTokens.clear();
  if (runCommand(command, segment.id)) {
    const owner = ui.store.project.segments.find(item => item.tokenIds.includes(ids[0]));
    ui.trackId = target; if (owner) ui.selectedId = owner.id; emit('project'); status('字幕を別のトラックへ移動しました。');
  }
}

function applyTrackStyle(field, value) {
  const track = activeTrack(); if (!track) return;
  runCommand({ type: 'set-track-style', trackId: track.id, style: { [field]: value } });
}
function alignPreviewZone() {
  const canvas = $('captionPreview'), frame = $('captionPreviewFrame');
  if (!canvas.getBoundingClientRect || !frame.getBoundingClientRect) return;
  const guide = document.querySelector('.caption-safe-zone'), segment = selectedSegment();
  if (!guide) return;
  const plan = segment && J.captionResolvedPlan(ui.store.project.plans[segment.id]), media = ui.store.project.media;
  const zone = plan && media && media.width > 0 ? J.captionPlanZone(plan, media) : null;
  guide.hidden = !zone;
  paintBoxEditor();
  if (!zone) return;
  const box = canvas.getBoundingClientRect(), parent = frame.getBoundingClientRect();
  Object.assign(guide.style, { left: `${box.left - parent.left + zone.x / media.width * box.width}px`,
    top: `${box.top - parent.top + zone.y / media.height * box.height}px`,
    width: `${zone.width / media.width * box.width}px`, height: `${zone.height / media.height * box.height}px`, right: 'auto', bottom: 'auto' });
}

function onSelectionChanged() {
  const id = ui.selectedId, plan = id && ui.store.project.plans[id], overridden = plan && plan.manual && plan.manual.box;
  $('captionBoxScope').value = overridden ? 'segment' : 'track';
  renderTracksPanel(); renderBoxPanel();
}

function init() {
  const boxEditor = $('captionBoxEditor');
  boxEditor.addEventListener('pointerdown', startBoxDrag); boxEditor.addEventListener('pointermove', moveBoxDrag);
  boxEditor.addEventListener('pointerup', () => finishBoxDrag()); boxEditor.addEventListener('pointercancel', () => finishBoxDrag(true)); boxEditor.addEventListener('keydown', nudgeBox);
  for (const id of ['captionBoxX', 'captionBoxY', 'captionBoxWidth', 'captionBoxHeight']) $(id).addEventListener('change', () => applyBoxInputs($(id)));
  $('captionBoxScope').addEventListener('change', renderBoxPanel); $('captionBoxReset').addEventListener('click', resetBox);
  $('captionTrackList').addEventListener('click', event => { const target = event.target.closest('[data-track-select]'); if (target) selectTrack(target.dataset.trackSelect); });
  $('captionTrackLabels').addEventListener('click', event => { const target = event.target.closest('[data-track-select]'); if (target) selectTrack(target.dataset.trackSelect); });
  $('captionTrackAdd').addEventListener('click', addTrack); $('captionTrackDelete').addEventListener('click', () => deleteTrack());
  $('captionTrackForward').addEventListener('click', () => reorderTrack(1)); $('captionTrackBack').addEventListener('click', () => reorderTrack(-1));
  $('captionTrackName').addEventListener('change', () => { const track = activeTrack(); if (track) runCommand({ type: 'rename-track', trackId: track.id, name: $('captionTrackName').value }); });
  $('captionTrackReroll').addEventListener('click', () => { const track = activeTrack(); if (track) rerollTrack(track.id); });
  $('captionTrackPreset').addEventListener('change', () => applyTrackStyle('preset', $('captionTrackPreset').value || null));
  $('captionTrackTreatment').addEventListener('change', () => applyTrackStyle('captionTreatment', $('captionTrackTreatment').value || null));
  $('captionTrackAccent').addEventListener('change', () => { $('captionTrackAccent').dataset.unset = ''; applyTrackStyle('accentColor', $('captionTrackAccent').value); });
  $('captionTrackAccentClear').addEventListener('click', () => applyTrackStyle('accentColor', null));
  $('captionMoveSegment').addEventListener('click', () => moveToTrack(true)); $('captionMoveTokens').addEventListener('click', () => moveToTrack(false));
  on('project', () => { renderTracksPanel(); renderBoxPanel(); }); on('selection', onSelectionChanged);
}
Object.assign(W, { BOX_STEP, addTrack, renameTrack, rerollTrack, alignPreviewZone, applyBoxInputs, applyTrackStyle, boxContext, boxFrame, buildBoxGhosts, commitBox, deleteTrack, finishBoxDrag, moveBoxDrag, moveToTrack, nudgeBox, onSelectionChanged, paintBoxEditor, paintSnapLines, positionBoxGhosts, renderBoxPanel, renderTracksPanel, reorderTrack, resetBox, selectTrack, startBoxDrag });
W.inits.push(init);
})();
