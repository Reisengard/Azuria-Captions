/* ============================================================
   JIZURA — Video Captions workbench: editing the selected caption (inspector, text, timing, new text blocks)
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb;
const { ui, $, fmt, status, selectedSegment, segmentTrackId, activeTrack, trackName, segmentText, tokenMap, sourceVideo, runCommand, lookLabel, PRESET_LABELS, accessibilityWarnings, selectSegment, on } = W;
const BLOCK_ANIMATION_CONTROLS = { enter: 'captionBlockEnter', hold: 'captionBlockHold', exit: 'captionBlockExit' };
/* ---- Caption tab: the selected caption ----
   Header with previous / next, warnings first, then the words as chips (press one to fix its text or emphasis,
   ✂ between two words splits there), timing with nudges and "at playhead", and the rarer actions folded away. */
const tokenEmphasisState = token => { const manual = token && token.manualEmphasis; return manual && typeof manual.enabled === 'boolean' ? (manual.enabled ? 'on' : 'off') : 'auto'; };
const EMPHASIS_VALUES = { auto: null, on: { enabled: true, reason: 'editor' }, off: { enabled: false, reason: 'editor' } };

function renderInspector() {
  const segment = selectedSegment(), empty = $('captionInspectorEmpty'), panel = $('captionSegmentInspector');
  empty.hidden = !!segment; panel.hidden = !segment;
  if (!segment) return;
  const project = ui.store.project, plan = project.plans[segment.id], resolved = J.captionResolvedPlan(plan), tracks = project.tracks || [];
  const tokens = tokenMap(), segmentTokens = segment.tokenIds.map(id => tokens.get(id)).filter(Boolean);
  const isBlock = J.isCaptionTextBlock(project, segment), locked = !!(segment.locks && segment.locks.visualPlan), cutLocked = !!(segment.locks && segment.locks.segmentation);
  if (!segment.tokenIds.includes(ui.wordId)) ui.wordId = null;
  // Header: where this caption is, in time order across every track.
  const order = project.segments, at = order.indexOf(segment), tags = [`${fmt(segment.start)}–${fmt(segment.end)}`];
  if (tracks.length > 1) tags.push(trackName(segmentTrackId(segment)));
  if (isBlock) tags.push('テキストブロック');
  if (locked) tags.push('固定中');
  $('captionNavPosition').textContent = `${at + 1} / ${order.length}`; $('captionNavMeta').textContent = tags.join(' · ');
  $('captionPrev').disabled = at <= 0; $('captionNext').disabled = at < 0 || at >= order.length - 1;
  const frame = project.media || {}, zone = frame.width > 0 && frame.height > 0 ? J.captionPlanZone(resolved, frame) : null;
  if (zone) Object.assign(document.querySelector('.caption-safe-zone').style, {
    left: `${zone.x / frame.width * 100}%`, top: `${zone.y / frame.height * 100}%`, width: `${zone.width / frame.width * 100}%`, height: `${zone.height / frame.height * 100}%`, right: 'auto', bottom: 'auto',
  });
  const error = ui.errors[segment.id], errorEl = $('captionEditError'); errorEl.hidden = !error; errorEl.textContent = error || '';
  const warningBox = $('captionAccessibility'); warningBox.replaceChildren();
  for (const warning of accessibilityWarnings(segment)) { const item = document.createElement('div'); item.className = 'caption-warning'; item.textContent = warning; warningBox.appendChild(item); }
  // Text
  renderBlockEditor(segment, plan);
  renderWordChips(segment, segmentTokens, resolved, isBlock, cutLocked);
  renderWordEditor(segment, segmentTokens, resolved, isBlock);
  // Timing
  const start = $('captionSelectedStart'), end = $('captionSelectedEnd');
  if (document.activeElement !== start) start.value = segment.start.toFixed(2);
  if (document.activeElement !== end) end.value = segment.end.toFixed(2);
  const previous = J.captionTrackNeighbor(project, segment, -1), next = J.captionTrackNeighbor(project, segment, 1), cutFixed = item => !!(item && item.locks && item.locks.segmentation);
  $('captionMergePrev').disabled = !previous || cutLocked || cutFixed(previous);
  $('captionMerge').disabled = !next || cutLocked || cutFixed(next);
  $('captionStartAtPlayhead').disabled = $('captionEndAtPlayhead').disabled = !sourceVideo();
  // Track (only with somewhere to move to)
  const moveTargets = tracks.filter(item => item.id !== segmentTrackId(segment)), moveSelect = $('captionMoveTrack'), keptTarget = moveSelect.value;
  $('captionMoveSection').hidden = !moveTargets.length;
  moveSelect.replaceChildren();
  for (const item of moveTargets) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name || item.id; moveSelect.appendChild(option); }
  if (moveTargets.some(item => item.id === keptTarget)) moveSelect.value = keptTarget;
  $('captionMoveSegment').disabled = !moveTargets.length;
  // A text block moves whole; its words are not split off to another track.
  $('captionMoveWords').hidden = isBlock;
  const picker = $('captionMoveWordPicker'); picker.replaceChildren();
  for (const token of segmentTokens) {
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'caption-word-chip'; chip.dataset.moveWord = token.id; chip.textContent = token.text;
    chip.setAttribute('aria-pressed', String(ui.moveTokens.has(token.id))); picker.appendChild(chip);
  }
  const picked = segmentTokens.filter(token => ui.moveTokens.has(token.id)).length;
  $('captionMoveTokens').disabled = !moveTargets.length || isBlock || !picked; $('captionMoveTokens').textContent = picked ? `選んだ単語を移動（${picked}）` : '選んだ単語を移動';
  // Look and motion
  $('captionLookSummary').textContent = `登場: ${lookLabel('enter', resolved.entrance) || '—'} · 表示中: ${lookLabel('hold', resolved.hold) || '—'} · 退場: ${lookLabel('exit', resolved.exit) || '—'}`;
  $('captionReroll').disabled = locked; $('captionEditLook').disabled = locked;
  $('captionDisableAnimation').checked = !!resolved.animationDisabled; $('captionDisableAnimation').disabled = locked;
  $('captionLock').checked = locked;
  // Details
  const qualities = new Set(segmentTokens.map(token => token.timingQuality));
  $('captionSelectedQuality').textContent = qualities.has('estimated') ? '推定（SRT/VTT・手入力）' : qualities.has('segment') ? '字幕単位' : '単語単位';
  $('captionSelectedLayout').textContent = lookLabel('layout', resolved.layout) || '—';
}

function renderWordChips(segment, segmentTokens, resolved, isBlock, cutLocked) {
  const list = $('captionTokenList'), emphasized = new Set(J.captionEmphasizedTokenIds(ui.store.project, segment, resolved, segmentTokens));
  list.replaceChildren();
  segmentTokens.forEach((token, index) => {
    if (index > 0 && !isBlock && !cutLocked) {
      const cut = document.createElement('button'); cut.type = 'button'; cut.className = 'caption-word-cut'; cut.dataset.splitBefore = token.id; cut.textContent = '✂';
      cut.title = `「${token.text}」の前で分割`; cut.setAttribute('aria-label', cut.title); list.appendChild(cut);
    }
    const chip = document.createElement('button'); chip.type = 'button'; chip.className = 'caption-word-chip'; chip.dataset.wordId = token.id; chip.textContent = token.text;
    chip.dataset.emphasis = tokenEmphasisState(token); chip.classList.toggle('is-emphasized', emphasized.has(token.id)); chip.classList.toggle('has-error', !!ui.errors[token.id]);
    chip.setAttribute('aria-pressed', String(ui.wordId === token.id)); chip.title = `${fmt(token.start)}–${fmt(token.end)}${emphasized.has(token.id) ? ' · 強調' : ''}`;
    list.appendChild(chip);
  });
  $('captionWordHint').textContent = isBlock ? '文字は上の欄でまとめて書き換えます。単語を押すと強調を変えられます。'
    : cutLocked ? '単語を押すと修正・強調できます。この字幕は固定中のため分割できません。' : '単語を押すと修正・強調できます。✂ で字幕を分けます。';
}

function renderWordEditor(segment, segmentTokens, resolved, isBlock) {
  const token = segmentTokens.find(item => item.id === ui.wordId), editor = $('captionWordEditor');
  editor.hidden = !token; if (!token) return;
  $('captionWordTextField').hidden = isBlock;
  const input = $('captionWordText'); if (document.activeElement !== input) input.value = token.text;
  const state = tokenEmphasisState(token);
  editor.querySelectorAll('[data-emphasis]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.emphasis === state)));
  const project = ui.store.project, on = J.captionEmphasizedTokenIds(project, segment, resolved, [token]).length > 0, track = J.captionTrack(project, segmentTrackId(segment));
  const meta = $('captionWordMeta');
  meta.textContent = [`${fmt(token.start)}–${fmt(token.end)}`, token.timingQuality === 'estimated' ? '推定タイミング' : '単語タイミング', on ? '強調されています' : '強調されていません'].join(' · ');
  if (on && !J.captionRoleStylesEmphasis(track)) meta.textContent += '（強調の見た目は「文字スタイル」で設定します）';
  meta.classList.toggle('danger-text', !!ui.errors[token.id]); if (ui.errors[token.id]) meta.textContent = ui.errors[token.id];
}

/* Text blocks (typed captions): whole-text edit and delete in the text section; preset animations in "Look and motion". */
function renderBlockEditor(segment, plan) {
  const project = ui.store.project, isBlock = J.isCaptionTextBlock(project, segment), editor = $('captionBlockEditor');
  editor.hidden = !isBlock; $('captionBlockAnimation').hidden = !isBlock; if (!isBlock) return;
  const text = $('captionBlockText'); if (document.activeElement !== text) text.value = segmentText(segment);
  const locked = !!(segment.locks && segment.locks.visualPlan), chosen = J.captionTextBlockAnimation(plan), options = J.captionTextBlockAnimationOptions(project, segmentTrackId(segment));
  for (const [key, id] of Object.entries(BLOCK_ANIMATION_CONTROLS)) {
    const select = $(id), ids = options[key].slice(); if (chosen[key] && !ids.includes(chosen[key])) ids.push(chosen[key]);
    select.replaceChildren();
    const auto = document.createElement('option'); auto.value = ''; auto.textContent = '自動（スタイルに合わせる）'; select.appendChild(auto);
    for (const value of ids) { const def = J.registry(J.CAPTION_TEXT_BLOCK_ANIMATION[key].group)[value], option = document.createElement('option'); option.value = value; option.textContent = PRESET_LABELS[value] || def && def.name || value; select.appendChild(option); }
    select.value = chosen[key] || ''; select.disabled = locked;
  }
}

function selectWord(tokenId) {
  const token = tokenMap().get(tokenId); if (!token) return;
  ui.wordId = ui.wordId === tokenId ? null : tokenId;
  if (ui.wordId) W.seekTimeline(token.start);
  renderInspector();
  if (ui.wordId && !$('captionWordTextField').hidden) $('captionWordText').focus();
}

function splitBefore(tokenId) {
  const segment = selectedSegment(); if (!segment || !tokenId) return;
  const nextId = ui.store.nextSegmentId();
  if (runCommand({ type: 'split-segment', segmentId: segment.id, beforeTokenId: tokenId, newSegmentId: nextId, boundarySource: 'manual' }, segment.id, nextId)) { selectSegment(nextId, true); status('字幕を2つに分けました。元に戻すで戻せます。'); }
}

function mergeWith(direction) {
  const segment = selectedSegment(); if (!segment) return;
  const other = J.captionTrackNeighbor(ui.store.project, segment, direction); if (!other) return;
  const [first, second] = direction < 0 ? [other, segment] : [segment, other];
  if (runCommand({ type: 'merge-segments', segmentId: first.id, nextSegmentId: second.id, boundarySource: 'manual' }, segment.id, first.id)) status('字幕を結合しました。');
}

function stepCaption(direction) {
  const order = ui.store.project.segments, at = order.indexOf(selectedSegment()), target = at < 0 ? null : order[at + direction];
  if (target) selectSegment(target.id, true);
}

function nudgeTiming(key, step) {
  const input = $(key === 'start' ? 'captionSelectedStart' : 'captionSelectedEnd');
  input.value = Math.max(0, Number(input.value) + step).toFixed(2); applyTiming();
}

function timingAtPlayhead(key) {
  const video = sourceVideo(); if (!video) return;
  $(key === 'start' ? 'captionSelectedStart' : 'captionSelectedEnd').value = Number(video.currentTime).toFixed(2); applyTiming();
}

function openSegmentLook() {
  if (!selectedSegment()) return;
  ui.lookScope = 'segment'; ui.lookSignature = null; W.selectStyleTab('effects'); W.renderLookPanel();
}

function applyBlockText() {
  const segment = selectedSegment(); if (!segment) return;
  if (runCommand({ type: 'edit-text-block', segmentId: segment.id, text: $('captionBlockText').value }, segment.id)) status('テキストブロックを更新しました。');
}

function deleteBlock() {
  const segment = selectedSegment(); if (!segment || !J.isCaptionTextBlock(ui.store.project, segment)) return;
  if (!window.confirm(`テキストブロック「${segmentText(segment)}」を削除します。「元に戻す」で復元できます。続けますか？`)) return;
  if (runCommand({ type: 'delete-text-block', segmentId: segment.id }, segment.id)) status('テキストブロックを削除しました。');
}

function setBlockAnimation(key, value) {
  const segment = selectedSegment(); if (!segment) return;
  runCommand({ type: 'edit-text-block', segmentId: segment.id, animation: { [key]: value || null } }, segment.id);
}
function renderManualTrack() {
  const select = $('captionManualTrack'), kept = select.value, tracks = ui.store.project.tracks || [];
  select.replaceChildren();
  for (const track of tracks) { const option = document.createElement('option'); option.value = track.id; option.textContent = track.name || track.id; select.appendChild(option); }
  select.value = tracks.some(track => track.id === kept) ? kept : (activeTrack() || tracks[0] || {}).id || '';
  $('captionManualTrackField').hidden = tracks.length < 2;
}
function applyTiming() {
  const segment = selectedSegment(); if (!segment) return;
  const start = Number($('captionSelectedStart').value), end = Number($('captionSelectedEnd').value);
  // The timing rules (window inside the video, words kept, no overlap on the track, a block's words re-spread) live in the store.
  runCommand({ type: 'trim-segment', segmentId: segment.id, start, end, words: 'keep' }, segment.id);
}

function init() {
  $('captionManualAdd').addEventListener('click', () => {
    const startText = $('captionManualStart').value, endText = $('captionManualEnd').value;
    const id = ui.store.nextSegmentId();
    if (runCommand({ type: 'create-text-block', text: $('captionManualText').value, trackId: $('captionManualTrack').value || undefined,
      start: startText === '' ? NaN : Number(startText), end: endText === '' ? NaN : Number(endText) }, id, id)) {
      selectSegment(id, true);   // seek there too, or the playhead would select the caption under it again
      $('captionManualText').value = '';
      $('captionManualStart').value = endText;
      $('captionManualEnd').value = Number(endText) + 3;
    }
  });
  $('captionLock').addEventListener('change', event => { const segment = selectedSegment(); if (!segment) return; runCommand({ type: 'set-segment-locks', segmentId: segment.id, locked: event.target.checked }, segment.id); });
  $('captionReroll').addEventListener('click', () => { const segment = selectedSegment(); if (!segment) return; ui.variation += 1; if (runCommand({ type: 'randomize-caption-look', segmentId: segment.id, variation: ui.variation }, segment.id)) status('選択した字幕をランダムに決めました。'); });
  $('captionDisableAnimation').addEventListener('change', event => { const segment = selectedSegment(); if (!segment) return;
    runCommand({ type: 'set-segment-animation-disabled', segmentId: segment.id, disabled: event.target.checked }, segment.id); });
  $('captionEditLook').addEventListener('click', openSegmentLook);
  $('captionBlockApply').addEventListener('click', applyBlockText); $('captionBlockDelete').addEventListener('click', deleteBlock);
  for (const [key, id] of Object.entries(BLOCK_ANIMATION_CONTROLS)) $(id).addEventListener('change', event => setBlockAnimation(key, event.target.value));
  $('captionSelectedStart').addEventListener('change', applyTiming); $('captionSelectedEnd').addEventListener('change', applyTiming);
  document.querySelectorAll('[data-nudge]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); nudgeTiming(button.dataset.nudge, Number(button.dataset.step)); }));
  $('captionStartAtPlayhead').addEventListener('click', () => timingAtPlayhead('start')); $('captionEndAtPlayhead').addEventListener('click', () => timingAtPlayhead('end'));
  $('captionMergePrev').addEventListener('click', () => mergeWith(-1)); $('captionMerge').addEventListener('click', () => mergeWith(1));
  $('captionPrev').addEventListener('click', () => stepCaption(-1)); $('captionNext').addEventListener('click', () => stepCaption(1));
  $('captionTokenList').addEventListener('click', event => {
    const cut = event.target.closest('[data-split-before]'), chip = event.target.closest('[data-word-id]');
    if (cut) splitBefore(cut.dataset.splitBefore); else if (chip) selectWord(chip.dataset.wordId);
  });
  $('captionWordText').addEventListener('change', event => { if (ui.wordId) runCommand({ type: 'edit-token-text', tokenId: ui.wordId, text: event.target.value.trim() }, ui.wordId); });
  $('captionWordText').addEventListener('keydown', event => { if (event.key === 'Escape') { ui.wordId = null; renderInspector(); } });
  document.querySelectorAll('#captionWordEditor [data-emphasis]').forEach(button => button.addEventListener('click', () => {
    if (ui.wordId) runCommand({ type: 'set-manual-emphasis', tokenId: ui.wordId, value: EMPHASIS_VALUES[button.dataset.emphasis] }, ui.wordId);
  }));
  $('captionMoveWordPicker').addEventListener('click', event => {
    const chip = event.target.closest('[data-move-word]'); if (!chip) return;
    if (ui.moveTokens.has(chip.dataset.moveWord)) ui.moveTokens.delete(chip.dataset.moveWord); else ui.moveTokens.add(chip.dataset.moveWord);
    renderInspector();
  });
  on('project', () => { renderInspector(); renderManualTrack(); }); on('selection', renderInspector); on('error', renderInspector);
}
Object.assign(W, { BLOCK_ANIMATION_CONTROLS, EMPHASIS_VALUES, applyBlockText, applyTiming, deleteBlock, mergeWith, nudgeTiming, openSegmentLook, renderBlockEditor, renderInspector, renderManualTrack, renderWordChips, renderWordEditor, selectWord, setBlockAnimation, splitBefore, stepCaption, timingAtPlayhead, tokenEmphasisState });
W.inits.push(init);
})();
