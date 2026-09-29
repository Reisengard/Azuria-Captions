/* ============================================================
   JIZURA — Video Captions workbench (Gate 5.2)
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;

const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const ui = { store: null, media: null, preview: null, selectedId: null, trackId: null, moveTokens: new Set(), variation: 0, errors: {}, timelineZoom: 1, boundaryDrag: null,
  exporter: null, exportAbort: null };
const captionLooks = {
  clean: ['captionSoftRise', 'captionStill', 'captionFadeOut', 'outline'],
  pop: ['captionPop', 'captionStill', 'captionShrinkOut', 'echo'],
  neon: ['captionBlur', 'captionWave', 'captionBlurOut', 'neon'],
  type: ['captionType', 'captionStill', 'captionFadeOut', 'backplate'],
};
const effectControls = ['captionEffect', 'captionHoldEffect', 'captionExitEffect', 'captionTreatment'];
// Same names as the effect menus; other ids fall back to the registry name.
const PRESET_LABELS = { captionFade: 'Fade', captionSoftRise: 'Rise', captionSoftScale: 'Zoom', captionWordFade: 'Letter Fade', captionSoftReplace: 'Replace', captionImpact: 'Impact',
  captionType: 'Typewriter', captionBlur: 'Blur Reveal', captionWipe: 'Wipe', captionPop: 'Lyric Pop', captionDrop: 'Letter Drop', captionStill: 'Still', captionBreathe: 'Breathe',
  captionWave: 'MV Wave', captionFadeOut: 'Fade out', captionShrinkOut: 'Shrink out', captionBlurOut: 'Blur out' };
const BLOCK_ANIMATION_CONTROLS = { enter: 'captionBlockEnter', hold: 'captionBlockHold', exit: 'captionBlockExit' };
const sourceVideo = () => ui.media && ui.media.current && ui.media.current.video;
const tokenMap = () => new Map((ui.store && ui.store.project.transcript.tokens || []).map(token => [token.id, token]));
const fmt = value => {
  const seconds = Math.max(0, Number(value) || 0), minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
};
const projectId = () => `caption_${Date.now().toString(36)}`;

function emptyProject() {
  const now = new Date().toISOString();
  return { schemaVersion: J.PROJECT_SCHEMA_VERSION, generatorVersion: J.PROJECT_GENERATOR_VERSION,
    mode: 'video-captions', id: projectId(), media: {},
    transcript: { schemaVersion: J.TIMED_TEXT_SCHEMA_VERSION, language: 'und', timingQuality: 'word', tokens: [] },
    tracks: [J.defaultCaptionTrack({ media: {} })], guides: [], segments: [], plans: {}, safeZones: [], seed: 3107, style: { preset: 'creator', intensity: .5, motion: .45, accentColor: '#f5a50c', editor: 'simple' },
    settings: {}, createdAt: now, updatedAt: now };
}

function status(message, error) { const el = $('captionStatus'); if (el) { el.textContent = message; el.classList.toggle('danger-text', !!error); } }
function selectedSegment() { return ui.store && ui.store.project.segments.find(segment => segment.id === ui.selectedId) || null; }
const PRIMARY_TRACK = J.CAPTION_PRIMARY_TRACK_ID;
const segmentTrackId = segment => segment && segment.trackId || PRIMARY_TRACK;
/* The track the side panels edit: the one picked in the track list, else the selected caption's, else the primary. */
function activeTrack() {
  const tracks = ui.store.project.tracks || [], segment = selectedSegment();
  return tracks.find(track => track.id === ui.trackId) || tracks.find(track => track.id === segmentTrackId(segment)) || tracks[0] || null;
}
const trackName = trackId => { const track = J.captionTrack(ui.store.project, trackId); return track ? track.name || track.id : trackId; };
function segmentText(segment) { const tokens = tokenMap(); return (segment && segment.tokenIds || []).map(id => tokens.get(id)).filter(Boolean).map(token => token.text).join(' '); }

const BOX_WARNINGS = { 'box-outside-safe-area': '字幕が推奨セーフエリアの外にあります。', 'box-narrow': '位置ボックスが狭いため、文字がはみ出す可能性があります。', 'box-invalid': '位置ボックスが無効です。' };
const boxWarningText = warning => BOX_WARNINGS[warning.code] || warning.code;

function accessibilityWarnings(segment) {
  if (!segment) return [];
  const stored = ui.store.project.plans[segment.id] || {}, plan = J.captionResolvedPlan(stored), readability = plan.readability || {}, reasons = new Set(readability.reasons || []), warnings = [];
  if (reasons.has('horizontal-overflow') || reasons.has('vertical-overflow')) warnings.push('字幕が表示範囲からはみ出します。文字数・位置・サイズを調整してください。');
  if (reasons.has('too-many-lines')) warnings.push('字幕の行数が多すぎます。字幕あたりの単語数を減らしてください。');
  if (reasons.has('contrast-insufficient') || readability.warnings && readability.warnings.includes('contrast-assisted')) warnings.push('背景とのコントラストを確認してください。アウトラインまたは背景板を推奨します。');
  if ((plan.components || []).some(component => component.metadata && component.metadata.flashes)) warnings.push('点滅を含む演出です。光過敏への配慮から別の演出を推奨します。');
  if (plan.fallback) warnings.push('安全性と読みやすさのため、この字幕は静止表示にフォールバックしました。文字数を減らすか、動きと強さを下げると再計画できます。');

  if (plan.font && document.fonts && typeof document.fonts.check === 'function' && !document.fonts.check(`16px "${String(plan.font).replace(/["\\]/g, '')}"`)) warnings.push('指定フォントを読み込めませんでした。ネットワークを確認するか、別のフォントを選んでください。');
  const frame = ui.store.project.media || {}, box = plan.box || (plan.zone && frame.width > 0 ? J.captionZoneToBox(plan.zone, frame) : null);
  if (box && frame.width > 0 && frame.height > 0) for (const warning of J.captionBoxWarnings(box, frame)) warnings.push(boxWarningText(warning));
  for (const hit of J.captionBoxCollisions(ui.store.project)) if (hit.segmentId === segment.id || hit.otherSegmentId === segment.id) {
    warnings.push(`他のトラックの字幕と位置が重なっています: ${trackName(hit.segmentId === segment.id ? hit.otherTrackId : hit.trackId)} ${fmt(hit.start)}–${fmt(hit.end)}。位置ボックスを調整してください。`);
  }
  return warnings;
}

function setProject(project, keepSelection) {
  ui.store = new J.CaptionStore(project);
  if (!keepSelection || !ui.store.project.segments.some(segment => segment.id === ui.selectedId)) ui.selectedId = ui.store.project.segments[0] && ui.store.project.segments[0].id || null;
  renderAll();
}

function renderSegments() {
  const list = $('captionSegmentList'), track = $('captionSegmentTrack'), wordTrack = $('captionWordTrack');
  list.replaceChildren(); track.replaceChildren(); wordTrack.replaceChildren();
  const project = ui.store.project, duration = Number(project.media.duration) || Math.max(1, ...project.transcript.tokens.map(token => token.end));
  // One timeline row (and label) per track; later tracks are drawn on top of earlier ones.
  const tracks = project.tracks || [], rows = new Map(), labels = $('captionTrackLabels'), current = activeTrack();
  labels.replaceChildren();
  for (const item of tracks) {
    const row = document.createElement('div'); row.className = 'caption-track-row'; row.dataset.trackId = item.id; track.appendChild(row); rows.set(item.id, row);
    const label = document.createElement('button'); label.type = 'button'; label.className = 'caption-track-name'; label.dataset.trackSelect = item.id; label.textContent = item.name || item.id; label.title = item.name || item.id;
    label.setAttribute('aria-pressed', String(!!current && item.id === current.id)); labels.appendChild(label);
  }
  project.segments.forEach(segment => {
    const text = segmentText(segment), item = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.className = 'caption-segment'; button.dataset.segmentId = segment.id;
    button.setAttribute('aria-selected', String(segment.id === ui.selectedId));
    const warning = accessibilityWarnings(segment).length ? '<span class="caption-segment-warning" aria-label="アクセシビリティ警告">⚠</span>' : '';
    const tag = tracks.length > 1 ? `<span class="caption-segment-track-tag">${escapeHtml(trackName(segmentTrackId(segment)))}</span>` : '';
    button.innerHTML = `<span class="caption-segment-time">${fmt(segment.start)}</span><span>${tag}${escapeHtml(text)} ${warning}</span>`;
    item.appendChild(button); list.appendChild(item);
    const block = document.createElement('div'); block.className = 'caption-timeline-segment' + (segment.id === ui.selectedId ? ' selected' : ''); block.setAttribute('role', 'button'); block.tabIndex = 0;
    block.dataset.segmentId = segment.id; block.textContent = text; block.title = `${fmt(segment.start)}–${fmt(segment.end)} ${text}`;
    block.style.left = `${segment.start / duration * 100}%`; block.style.width = `${Math.max(.25, (segment.end - segment.start) / duration * 100)}%`;
    if (J.captionTrackNeighbor(project, segment, 1) && !(segment.locks && segment.locks.segmentation)) { const handle = document.createElement('span'); handle.className = 'caption-boundary-handle'; handle.dataset.boundarySegment = segment.id; handle.setAttribute('role', 'slider'); handle.setAttribute('aria-label', `${text} の終了境界`); handle.tabIndex = 0; block.appendChild(handle); }
    (rows.get(segmentTrackId(segment)) || rows.values().next().value).appendChild(block);
  });
  for (const token of project.transcript.tokens) { const mark = document.createElement('button'); mark.type = 'button'; mark.className = 'caption-word-mark'; mark.dataset.wordId = token.id; mark.style.left = `${token.start / duration * 100}%`; mark.title = `${token.text} ${fmt(token.start)}–${fmt(token.end)}`; const label = document.createElement('span'); label.textContent = token.text; mark.appendChild(label); wordTrack.appendChild(mark); }
  $('captionTimelineContent').style.width = `${ui.timelineZoom * 100}%`; $('captionTimeline').dataset.zoomed = String(ui.timelineZoom >= 2);
  $('captionTranscriptEmpty').hidden = project.segments.length > 0;
  const quality = project.transcript.timingQuality || 'word';
  $('captionTimingBadge').title = quality === 'estimated' ? 'SRT/VTT and manually entered captions use estimated word timings. Captions are ready to preview.' : '';
  $('captionTimingBadge').textContent = project.transcript.tokens.length ? (quality === 'estimated' ? '推定タイミング' : '単語タイミング') : '未読込';
}

function renderInspector() {
  const segment = selectedSegment(), empty = $('captionInspectorEmpty'), panel = $('captionSegmentInspector');
  empty.hidden = !!segment; panel.hidden = !segment;
  if (!segment) return;
  const plan = ui.store.project.plans[segment.id], resolved = J.captionResolvedPlan(plan);
  const tokens = tokenMap(), segmentTokens = segment.tokenIds.map(id => tokens.get(id)).filter(Boolean);
  $('captionSelectedText').textContent = segmentText(segment); $('captionSelectedStart').value = segment.start.toFixed(2);
  $('captionSelectedEnd').value = segment.end.toFixed(2); $('captionSelectedLayout').textContent = resolved.layout || '—';
  const frame = ui.store.project.media || {}, zone = frame.width > 0 && frame.height > 0 ? J.captionPlanZone(resolved, frame) : null;
  if (zone) Object.assign(document.querySelector('.caption-safe-zone').style, {
    left: `${zone.x / frame.width * 100}%`, top: `${zone.y / frame.height * 100}%`, width: `${zone.width / frame.width * 100}%`, height: `${zone.height / frame.height * 100}%`, right: 'auto', bottom: 'auto',
  });
  const qualities = new Set(segmentTokens.map(token => token.timingQuality));
  $('captionSelectedQuality').textContent = qualities.has('estimated') ? '推定' : qualities.has('segment') ? 'セグメント単位' : '単語単位';
  const error = ui.errors[segment.id], errorEl = $('captionEditError'); errorEl.hidden = !error; errorEl.textContent = error || '';
  const split = $('captionSplitPoint'); split.replaceChildren();
  segmentTokens.slice(1).forEach(token => { const option = document.createElement('option'); option.value = token.id; option.textContent = `「${token.text}」の前`; split.appendChild(option); });
  renderBlockEditor(segment, plan);
  $('captionSplit').disabled = segmentTokens.length < 2 || !!(segment.locks && segment.locks.segmentation);
  $('captionMerge').disabled = !J.captionTrackNeighbor(ui.store.project, segment, 1) || !!(segment.locks && segment.locks.segmentation);
  const moveTargets = (ui.store.project.tracks || []).filter(item => item.id !== segmentTrackId(segment)), moveSelect = $('captionMoveTrack'), keptTarget = moveSelect.value;
  moveSelect.replaceChildren();
  for (const item of moveTargets) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name || item.id; moveSelect.appendChild(option); }
  if (moveTargets.some(item => item.id === keptTarget)) moveSelect.value = keptTarget;
  // A text block moves whole; its words are not split off to another track.
  $('captionMoveSegment').disabled = !moveTargets.length; $('captionMoveTokens').disabled = !moveTargets.length || J.isCaptionTextBlock(ui.store.project, segment);
  const tokenList = $('captionTokenList'); tokenList.replaceChildren();
  for (const token of segmentTokens) {
    const row = document.createElement('div'); row.className = 'caption-token-row'; row.dataset.tokenId = token.id;
    const input = document.createElement('input'); input.type = 'text'; input.value = token.text; input.setAttribute('aria-label', `${token.text} の表示文字`); input.dataset.tokenText = token.id;
    const emphasis = document.createElement('label'); emphasis.className = 'caption-token-emphasis';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = !!(token.manualEmphasis && token.manualEmphasis.enabled); check.dataset.tokenEmphasis = token.id;
    emphasis.append(check, document.createTextNode(' 強調'));
    const meta = document.createElement('span'); meta.className = 'caption-token-meta'; meta.innerHTML = `<span>${fmt(token.start)}–${fmt(token.end)}</span><span>${token.timingQuality === 'estimated' ? '推定' : '単語'}</span>`;
    const moveLabel = document.createElement('label'); moveLabel.className = 'caption-token-move';
    const moveCheck = document.createElement('input'); moveCheck.type = 'checkbox'; moveCheck.checked = ui.moveTokens.has(token.id); moveCheck.dataset.tokenMove = token.id;
    moveLabel.append(moveCheck, document.createTextNode(' 移動'));
    row.append(input, emphasis, moveLabel, meta);
    if (ui.errors[token.id]) { const tokenError = document.createElement('span'); tokenError.className = 'caption-token-error'; tokenError.textContent = ui.errors[token.id]; row.appendChild(tokenError); }
    tokenList.appendChild(row);
  }
  const warningBox = $('captionAccessibility'); warningBox.replaceChildren();
  for (const warning of accessibilityWarnings(segment)) { const item = document.createElement('div'); item.className = 'caption-warning'; item.textContent = warning; warningBox.appendChild(item); }
  const locked = !!(segment.locks && segment.locks.visualPlan); $('captionLock').setAttribute('aria-pressed', String(locked));
  $('captionLock').textContent = locked ? 'ロックを解除' : 'セグメントをロック'; $('captionReroll').disabled = locked;
  const animationDisabled = !!resolved.animationDisabled; $('captionDisableAnimation').setAttribute('aria-pressed', String(animationDisabled));
  $('captionDisableAnimation').textContent = animationDisabled ? 'アニメーションを有効化' : 'アニメーションを無効化'; $('captionDisableAnimation').disabled = locked;
}

/* Text blocks (typed captions): whole-text edit, delete, and preset animations from the track's style. */
function renderBlockEditor(segment, plan) {
  const project = ui.store.project, isBlock = J.isCaptionTextBlock(project, segment), editor = $('captionBlockEditor');
  editor.hidden = !isBlock; if (!isBlock) return;
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

function commandError(error) {
  const messages = { TOKEN_TEXT_REQUIRED: '単語は空にできません。', SEGMENT_FIELD_LOCKED: 'この項目はロックされています。', CAPTION_BOX_INVALID: '位置ボックスは画面内（0〜100%）に収めてください。',
    SEGMENT_TIMING_INVALID: '開始と終了の時刻を確認してください。', SEGMENT_SPLIT_INVALID: '分割位置を選び直してください。', SEGMENTS_NOT_ADJACENT: '隣り合う字幕だけ結合できます。',
    TRACKS_LIMIT: 'トラックは最大3つまでです。', TRACK_PRIMARY_UNDELETABLE: 'メイントラックは削除できません。', TRACK_NAME_INVALID: 'トラック名は1〜40文字で入力してください。',
    TRACK_STYLE_INVALID: 'トラックのスタイルの値が正しくありません。', TOKENS_REQUIRED: '移動する単語を選んでください。', TRACK_NOTHING_TO_REROLL: 'ロックされていない字幕がありません。',
    TRACK_SEGMENT_OVERLAP: '移動先のトラックで他の字幕と時間が重なります。先にその字幕を移動または短くしてください。',
    TEXT_BLOCK_OVERLAP: 'この時間には同じトラックに別の字幕があります。別のトラックを選ぶか、空いている時間を指定してください。', TOKEN_END_AFTER_DURATION: '字幕の終了が動画の長さを超えています。',
    TEXT_BLOCK_ANIMATION_INVALID: 'ブロックのアニメーションが正しくありません。', SEGMENT_NOT_TEXT_BLOCK: 'テキストブロックではありません。' };
  return messages[error.code] || error.message || '変更を適用できませんでした。';
}

function runCommand(command, errorKey, nextSelection) {
  try {
    ui.store.execute(command); ui.errors = {}; if (nextSelection) ui.selectedId = nextSelection; renderAll(); status('変更を保存しました。'); return true;
  } catch (error) { ui.errors[errorKey || ui.selectedId] = commandError(error); renderInspector(); status(commandError(error), true); return false; }
}

function applyTiming() {
  const segment = selectedSegment(); if (!segment) return;
  const start = Number($('captionSelectedStart').value), end = Number($('captionSelectedEnd').value), tokens = tokenMap();
  // A text block's words follow its timing (spread evenly again); the store refuses an overlap on its track.
  if (J.isCaptionTextBlock(ui.store.project, segment)) { runCommand({ type: 'edit-text-block', segmentId: segment.id, start, end }, segment.id); return; }
  const first = tokens.get(segment.tokenIds[0]), last = tokens.get(segment.tokenIds[segment.tokenIds.length - 1]);
  const previous = J.captionTrackNeighbor(ui.store.project, segment, -1), next = J.captionTrackNeighbor(ui.store.project, segment, 1);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || start > first.start || end < last.end || previous && start < previous.end || next && end > next.start) {
    ui.errors[segment.id] = '字幕は含まれる単語と隣の字幕の範囲内に設定してください。'; renderInspector(); status(ui.errors[segment.id], true); return;
  }
  runCommand({ type: 'set-segment-timing', segmentId: segment.id, start, end, boundarySource: 'manual' }, segment.id);
}

const CAPTION_TECHNIQUE_GROUPS = {
  layout: 'レイアウト',
  enter: '登場',
  hold: '保持',
  exit: '退場',
  decor: '装飾',
  treat: '文字の加工',
  bg: '背景',
  cam: 'カメラ',
  fx: '画面効果',
  trans: 'カット間のつなぎ',
};
const CAPTION_TECHNIQUE_SET_LABELS = [
  ['extra', '追加分の演出も使う'],
  ['wa', '和風の演出も使う'],
  ['typo', '文字PV系の部品を使う'],
  ['kinetic', 'キネティックの部品を使う'],
  ['horror', 'ホラーの演出も使う'],
];
J.CAPTION_TECHNIQUE_DRAW = {
  layout: false, enter: true, hold: true, exit: true,
  decor: false, treat: true, bg: false, cam: false, fx: false, trans: false,
};
const captionTechMemory = { open: new Set(), filters: Object.create(null) };

function captionTechniqueParts(group) {
  const registry = J.registry(group);
  return J.order(group).filter(id => registry[id] && !registry[id].special);
}

function captionTechniqueShown(group, query) {
  const registry = J.registry(group);
  const q = String(query == null ? captionTechMemory.filters[group] || '' : query).trim().toLowerCase();
  return captionTechniqueParts(group).filter(id => !q || (registry[id].name + ' ' + id).trim().toLowerCase().includes(q));
}

function rememberCaptionTechniques(host) {
  if (typeof host.querySelectorAll !== 'function') return;
  host.querySelectorAll('[data-caption-group]').forEach(group => {
    const name = group.dataset.captionGroup;
    if (!name) return;
    if (group.open) captionTechMemory.open.add(name); else captionTechMemory.open.delete(name);
    const filter = typeof group.querySelector === 'function' ? group.querySelector('[data-caption-filter]') : null;
    if (filter) captionTechMemory.filters[name] = filter.value;
  });
}

function fillCaptionTechniqueParts(list, group) {
  list.replaceChildren();
  const registry = J.registry(group);
  const drawn = J.CAPTION_TECHNIQUE_DRAW[group] === true;
  for (const id of captionTechniqueShown(group)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('type', 'checkbox');
    input.setAttribute('data-technique-id', id);
    input.checked = J.captionTechniqueOn(ui.store.project, group, id);
    input.disabled = !drawn;
    input.addEventListener('change', () => {
      if (J.CAPTION_TECHNIQUE_DRAW[group] !== true) return;
      const next = input.checked === true;
      if (J.captionTechniqueOn(ui.store.project, group, id) === next) return;
      runCommand({ type: 'set-technique', group, entries: { [id]: next } });
    });
    const name = document.createElement('span');
    name.textContent = registry[id].name;
    label.append(input, name);
    list.append(label);
  }
}

function renderCaptionTechniqueSets(project) {
  const box = document.createElement('div');
  box.className = 'caption-tech-sets';
  const flags = J.captionTechniques(project);
  for (const [set, labelText] of CAPTION_TECHNIQUE_SET_LABELS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('type', 'checkbox');
    input.setAttribute('data-caption-set', set);
    input.checked = flags[set] === true;
    input.disabled = false;
    input.addEventListener('change', () => {
      const value = input.checked === true;
      if (J.captionTechniques(ui.store.project)[set] === value) return;
      runCommand({ type: 'set-technique', set, value });
    });
    const text = document.createElement('span');
    text.textContent = labelText;
    label.append(input, text);
    box.append(label);
  }
  return box;
}

function renderCaptionTechniqueGroup(group, labelText) {
  const details = document.createElement('details');
  details.className = 'caption-tech-group';
  details.setAttribute('data-caption-group', group);
  details.open = captionTechMemory.open.has(group);
  const summary = document.createElement('summary');
  const name = document.createElement('span');
  name.className = 'caption-tech-name';
  name.textContent = labelText;
  const count = document.createElement('span');
  count.className = 'caption-tech-count';
  const parts = captionTechniqueParts(group);
  count.textContent = `${parts.filter(id => J.captionTechniqueOn(ui.store.project, group, id)).length}/${parts.length}`;
  summary.append(name, count);
  const filter = document.createElement('input');
  filter.type = 'search';
  filter.setAttribute('type', 'search');
  filter.className = 'caption-tech-filter';
  filter.setAttribute('data-caption-filter', group);
  filter.placeholder = '手法を名前で絞り込み';
  filter.setAttribute('placeholder', '手法を名前で絞り込み');
  filter.setAttribute('aria-label', '手法を名前で絞り込み');
  filter.value = captionTechMemory.filters[group] || '';
  const drawn = J.CAPTION_TECHNIQUE_DRAW[group] === true;
  const tools = document.createElement('div');
  tools.className = 'caption-tech-tools';
  for (const [action, text] of [['on', 'すべてON'], ['off', 'すべてOFF'], ['flip', '反転']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('type', 'button');
    button.className = 'ghost small';
    button.textContent = text;
    button.disabled = !drawn;
    button.addEventListener('click', () => {
      if (J.CAPTION_TECHNIQUE_DRAW[group] !== true) return;
      captionTechMemory.filters[group] = filter.value;
      const entries = {};
      for (const id of captionTechniqueShown(group, filter.value)) {
        const current = J.captionTechniqueOn(ui.store.project, group, id);
        const next = action === 'on' ? true : action === 'off' ? false : !current;
        if (next !== current) entries[id] = next;
      }
      if (!Object.keys(entries).length) return;
      runCommand({ type: 'set-technique', group, entries });
    });
    tools.append(button);
  }
  const note = document.createElement('p');
  note.className = 'caption-tech-note';
  note.textContent = 'This group is not drawn on the video yet.';
  note.hidden = drawn;
  const list = document.createElement('div');
  list.className = 'caption-tech-parts';
  fillCaptionTechniqueParts(list, group);
  filter.addEventListener('input', () => {
    captionTechMemory.filters[group] = filter.value;
    fillCaptionTechniqueParts(list, group);
  });
  details.append(summary, tools, filter, note, list);
  return details;
}

function renderCaptionTechniques() {
  const host = $('captionTechniqueHost');
  if (!host || typeof host.append !== 'function' || typeof host.replaceChildren !== 'function' || typeof J.order !== 'function' || typeof J.captionTechniques !== 'function') return;
  rememberCaptionTechniques(host);
  const groups = Object.entries(CAPTION_TECHNIQUE_GROUPS).map(([group, label]) => renderCaptionTechniqueGroup(group, label));
  host.replaceChildren(renderCaptionTechniqueSets(ui.store.project), ...groups);
}

function renderActions() {
  const hasTranscript = ui.store.project.transcript.tokens.length > 0;
  $('captionUndo').disabled = !ui.store.canUndo(); $('captionRedo').disabled = !ui.store.canRedo();
  $('captionVariation').disabled = !hasTranscript; $('captionSave').disabled = !(hasTranscript || sourceVideo() || ui.store.project.settings.videoEdit);
  $('captionExport').disabled = ui.exportAbort ? false : !sourceVideo();
  $('captionStyle').value = ui.store.project.style && ui.store.project.style.preset || 'creator';
  const style = ui.store.project.style || {}, segmentation = style.segmentation || {};
  const editor = style.editor === 'advanced' ? 'advanced' : 'simple';
  $('captionEditor').value = editor;
  $('captionTechniqueHost').hidden = editor !== 'advanced';
  renderCaptionTechniques();
  $('captionHoldEffect').value = style.holdEffect || 'auto'; $('captionExitEffect').value = style.exitEffect || 'auto';
  $('captionEffect').value = style.effect || 'auto'; $('captionTreatment').value = style.captionTreatment || 'outline';
  document.querySelectorAll('[data-caption-look]').forEach(button => {
    button.setAttribute('aria-pressed', String(captionLooks[button.dataset.captionLook].every((value, i) => $(effectControls[i]).value === value)));
  });
  const simplified = Object.values(ui.store.project.plans || {}).filter(stored => J.captionResolvedPlan(stored).fallback).length;
  $('captionEffectsSummary').textContent = effectControls.map(id => {
    const control = $(id); return control.options[control.selectedIndex]?.text || 'Match style';
  }).join(' / ') + (simplified ? ` · ${simplified} simplified for readability` : '');
  $('captionIntensity').value = Math.round((style.intensity == null ? .5 : style.intensity) * 100);
  $('captionMotion').value = Math.round((style.motion == null ? .45 : style.motion) * 100);
  $('captionDensity').value = segmentation.maxWords || 6; $('captionDensityValue').value = $('captionDensity').value;
  $('captionPosition').value = style.position || 'bottom'; $('captionAccent').value = style.accentColor || '#f5a50c';
  $('captionWritingMode').value = style.writingMode || 'horizontal'; $('captionEmphasisStrength').value = Math.round((style.emphasisStrength == null ? 1 : style.emphasisStrength) * 100);
  $('captionReducedMotion').checked = !!(ui.store.project.settings && ui.store.project.settings.reducedMotionPreview);
  $('captionPreviewFrame').dataset.reducedMotion = String($('captionReducedMotion').checked);
  $('captionProfileNote').textContent = style.preset === 'jizura-mv' ? '動きと注目度が高いスタイルです。必要に応じて「プレビューの動きを減らす」を有効にしてください。'
    : style.preset === 'punchy' ? '強調をはっきり見せる、中程度の動きのスタイルです。' : '読みやすさを優先した標準スタイルです。';
}

function renderAll() {
  if (ui.selectedId && !ui.store.project.segments.some(segment => segment.id === ui.selectedId)) ui.selectedId = ui.store.project.segments[0] && ui.store.project.segments[0].id || null;
  if (!(ui.store.project.tracks || []).some(track => track.id === ui.trackId)) ui.trackId = segmentTrackId(selectedSegment());
  if (ui.videoEditor) ui.videoEditor.refresh();
  if (ui.preview && J.videoOutputSize) { const size = J.videoOutputSize(ui.store.project); ui.preview.designWidth = size.width; ui.preview.designHeight = size.height; }
  renderSegments(); renderInspector(); renderTracksPanel(); renderManualTrack(); renderBoxPanel(); renderRolesPanel(); renderActions(); updatePlayhead(sourceVideo() && sourceVideo().currentTime || 0); if (ui.preview) ui.preview.renderNow();
}
function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }

function selectSegment(id, seek) {
  const segment = ui.store.project.segments.find(item => item.id === id); if (!segment) return;
  if (id !== ui.selectedId) ui.moveTokens.clear();
  ui.selectedId = id; ui.trackId = segmentTrackId(segment); if (seek && sourceVideo()) { sourceVideo().currentTime = segment.start; if (ui.preview) ui.preview.renderNow(segment.start); }
  const overridden = ui.store.project.plans[id] && ui.store.project.plans[id].manual && ui.store.project.plans[id].manual.box;
  $('captionBoxScope').value = overridden ? 'segment' : 'track';
  renderSegments(); renderInspector(); renderTracksPanel(); renderBoxPanel(); renderRolesPanel();
}

/* Which caption the playhead selects: the current one while it is on screen, else the active track's. */
function segmentAt(time) {
  const visible = J.captionSegmentsAt(ui.store.project, time), track = activeTrack();
  return visible.find(segment => segment.id === ui.selectedId) || visible.find(segment => track && segmentTrackId(segment) === track.id) || null;
}
function drawCaptions(ctx, time, info) {
  return J.drawCaptionOverlay(ctx, ui.store.project, time, Object.assign({}, info, { reducedMotion: !!ui.store.project.settings.reducedMotionPreview }));
}

/* ---- Placement box tool (delta plan step 4) ----
   Drag to move, drag the right handle to change width, arrow keys nudge, or type X/Y/W/H.
   Snap targets are the centre lines, the social-safe edges and thirds; hold Alt to drag freely.
   Editing never moves text on its own: unfit or unsafe boxes only produce warnings. */
const BOX_STEP = 0.005, BOX_STEP_BIG = 0.02;
const boxFrame = () => { const media = ui.store.project.media; return media && media.width > 0 && media.height > 0 ? { width: media.width, height: media.height } : { width: 1080, height: 1920 }; };

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

/* ---- roles (base / active / emphasis) ----
   Values are stored on the track. Only the base role re-plans (it changes what fits); the others restyle words in place. */
const ROLE_CONTROLS = {
  captionRoleBaseFont: ['base', 'font'], captionRoleBaseColor: ['base', 'color'], captionRoleBaseFontSize: ['base', 'fontSize'],
  captionRoleActiveTreatment: ['active', 'treatment'], captionRoleActiveColor: ['active', 'color'],
  captionRoleEmphasisFont: ['emphasis', 'font'], captionRoleEmphasisColor: ['emphasis', 'color'],
  captionRoleEmphasisScale: ['emphasis', 'scale'], captionRoleEmphasisThreshold: ['emphasis', 'threshold'],
};
let roleFontsLoaded = '';
const roleTrack = () => activeTrack();

function fillRoleOptions() {
  const option = (value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };
  for (const [id, emptyLabel] of [['captionRoleBaseFont', 'スタイルに合わせる'], ['captionRoleEmphasisFont', '使わない']]) {
    const select = $(id); select.replaceChildren(option('', emptyLabel));
    for (const key of J.CAPTION_FONTS) select.appendChild(option(key, J.FONTS[key] ? J.FONTS[key].label : key));
  }
  const treatment = $('captionRoleActiveTreatment'); treatment.replaceChildren(option('', 'スタイルに合わせる'));
  for (const id of Object.keys(J.CAPTION_ACTIVE || {})) treatment.appendChild(option(id, J.CAPTION_ACTIVE[id].name || id));
}

function renderRolesPanel() {
  const track = roleTrack(), roles = track && track.roles || {}, enabled = !!track;
  for (const [id, [role, field]] of Object.entries(ROLE_CONTROLS)) {
    const input = $(id), value = roles[role] && roles[role][field];
    input.disabled = !enabled;
    if (input.type === 'color') { if (value) input.value = value; input.dataset.unset = value ? '' : '1'; }
    else input.value = value == null ? '' : value;
  }
  document.querySelectorAll('[data-role-clear]').forEach(button => { button.disabled = !enabled; });
  $('captionRolesReset').disabled = !enabled;
  const warnings = $('captionRolesWarnings'); warnings.replaceChildren();
  const project = ui.store.project, used = J.captionRoleFonts(project);
  for (const font of J.captionFontStatus(project).filter(item => used.includes(item.key))) {
    const message = !font.ready ? '指定フォントを読み込めませんでした。ネットワークを確認するか、別のフォントを選んでください。'
      : !font.bundled ? `${font.label}: アプリに同梱されていないため、環境によって文字幅が変わる場合があります。` : null;
    if (message) { const item = document.createElement('div'); item.className = 'caption-warning'; item.textContent = message; warnings.appendChild(item); }
  }
  const signature = used.join(',');
  if (signature !== roleFontsLoaded) {
    roleFontsLoaded = signature;
    if (used.length && J.ensureCaptionFonts) J.ensureCaptionFonts(project).then(() => { if (ui.preview) ui.preview.renderNow(); renderRolesPanel(); }).catch(() => {});
  }
}

function applyRoleInput(input) {
  const track = roleTrack(); if (!track) return;
  const [role, field] = ROLE_CONTROLS[input.id];
  let value = input.value === '' ? null : input.type === 'number' ? Number(input.value) : input.value;
  if (input.type === 'color') input.dataset.unset = '';
  runCommand({ type: 'set-track-roles', trackId: track.id, roles: { [role]: { [field]: value } } });
}

function clearRoleInput(button) {
  const track = roleTrack(), [role, field] = ROLE_CONTROLS[button.dataset.roleClear] || []; if (!track || !role) return;
  runCommand({ type: 'set-track-roles', trackId: track.id, roles: { [role]: { [field]: null } } });
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
  ui.moveTokens.clear(); renderAll();
}

function addTrack() {
  const id = J.nextCaptionTrackId(ui.store.project);
  if (runCommand({ type: 'add-track', trackId: id })) { ui.trackId = id; renderAll(); status('トラックを追加しました。'); }
}

function deleteTrack() {
  const track = activeTrack(); if (!track || track.primary) return;
  const count = J.captionTrackSegments(ui.store.project, track.id).length;
  if (!window.confirm(`トラック「${track.name || track.id}」を削除します。このトラックの字幕（${count}件）と単語も削除されます。「元に戻す」で復元できます。続けますか？`)) return;
  if (runCommand({ type: 'remove-track', trackId: track.id })) { ui.trackId = PRIMARY_TRACK; renderAll(); status('トラックを削除しました。'); }
}

function reorderTrack(step) {
  const project = ui.store.project, track = activeTrack(); if (!track) return;
  runCommand({ type: 'reorder-track', trackId: track.id, toIndex: project.tracks.indexOf(track) + step });
}

function moveToTrack(whole) {
  const segment = selectedSegment(), target = $('captionMoveTrack').value; if (!segment || !target) return;
  const ids = whole ? segment.tokenIds.slice() : Array.from(ui.moveTokens).filter(id => segment.tokenIds.includes(id));
  if (!ids.length) { status(commandError({ code: 'TOKENS_REQUIRED' }), true); return; }
  const command = whole ? { type: 'move-segment-to-track', segmentId: segment.id, trackId: target } : { type: 'move-tokens-to-track', tokenIds: ids, trackId: target };
  ui.moveTokens.clear();
  if (runCommand(command, segment.id)) {
    const owner = ui.store.project.segments.find(item => item.tokenIds.includes(ids[0]));
    ui.trackId = target; if (owner) ui.selectedId = owner.id; renderAll(); status('字幕を別のトラックへ移動しました。');
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

async function exportCaptions() {
  if (ui.exportAbort) { ui.exportAbort.abort(); status('書き出しをキャンセルしています…'); return; }
  const current = ui.media && ui.media.current; if (!current) return;
  let writable = null;
  try {
    if (typeof window.showSaveFilePicker === 'function') { const handle = await window.showSaveFilePicker({ suggestedName: `jizura-${ui.store.project.id}.mp4`,
      types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] }); writable = await handle.createWritable(); }
  } catch (error) { if (error && error.name === 'AbortError') return; throw error; }
  ui.exportAbort = new AbortController(); ui.exporter = new J.CaptionVideoExporter(); const button = $('captionExport'); button.textContent = 'キャンセル'; button.disabled = false;
  try {
    const result = await ui.exporter.export(current.file, clone(ui.store.project), { writable, signal: ui.exportAbort.signal,
      onProgress: event => { const labels = { checking: '書き出し環境を確認中', video: '字幕付き映像を書き出し中', audio: '元の音声を保持中', finalizing: 'MP4を仕上げています' };
        status(`${labels[event.phase] || '書き出し中'}… ${Math.round(event.progress * 100)}%`); } });
    if (result.blob) await J.saveFile(`jizura-${ui.store.project.id}.mp4`, result.blob);
    status(`書き出しました（${result.frameCount}フレーム・音声${result.audio.mode !== 'none' ? '保持' : 'なし'}・${result.metrics.elapsedSeconds.toFixed(1)}秒）。`);
  } catch (error) { const recovery = J.recoveryForError ? J.recoveryForError(error) : { display: error.message || '書き出しに失敗しました。' };
    status(error.code === 'MEDIA_EXPORT_CANCELLED' ? '書き出しをキャンセルしました。' : recovery.display, error.code !== 'MEDIA_EXPORT_CANCELLED'); }
  finally { ui.exportAbort = null; ui.exporter = null; button.textContent = '書き出し'; renderActions(); }
}

function updatePlayhead(time) {
  const duration = sourceVideo() ? Number(sourceVideo().duration) || 0 : Number(ui.store.project.media.duration) || 0;
  $('captionTime').textContent = fmt(time); $('captionDuration').textContent = fmt(duration);
  $('captionScrub').value = duration ? Math.round(time / duration * 1000) : 0;
  $('captionPlayhead').style.left = `calc(66px + (100% - 66px) * ${duration ? time / duration : 0})`;
  const active = segmentAt(time); if (active && active.id !== ui.selectedId) selectSegment(active.id, false);
}

function seekTimeline(time) {
  const duration = Number(ui.store.project.media.duration) || 0, target = Math.max(0, Math.min(duration, time));
  if (sourceVideo()) { sourceVideo().currentTime = target; if (ui.preview) ui.preview.renderNow(target); } else updatePlayhead(target);
}

function timelineTimeAt(clientX) {
  const content = $('captionTimelineContent'), rect = content.getBoundingClientRect(), label = 66;
  return Math.max(0, Math.min(1, (clientX - rect.left - label) / Math.max(1, rect.width - label))) * (Number(ui.store.project.media.duration) || 0);
}

function startBoundaryDrag(event, segmentId) {
  const segment = ui.store.project.segments.find(item => item.id === segmentId), next = segment && J.captionTrackNeighbor(ui.store.project, segment, 1); if (!segment || !next) return;
  const tokens = tokenMap(), min = tokens.get(segment.tokenIds[segment.tokenIds.length - 1]).end, max = tokens.get(next.tokenIds[0]).start;
  ui.boundaryDrag = { segmentId, min, max, time: segment.end }; event.preventDefault(); event.target.setPointerCapture && event.target.setPointerCapture(event.pointerId);
}

function moveBoundary(event) {
  if (!ui.boundaryDrag) return; ui.boundaryDrag.time = Math.max(ui.boundaryDrag.min, Math.min(ui.boundaryDrag.max, timelineTimeAt(event.clientX)));
  const segment = ui.store.project.segments.find(item => item.id === ui.boundaryDrag.segmentId), next = J.captionTrackNeighbor(ui.store.project, segment, 1), duration = Number(ui.store.project.media.duration) || 1;
  const left = $('captionSegmentTrack').querySelector(`[data-segment-id="${segment.id}"]`), right = $('captionSegmentTrack').querySelector(`[data-segment-id="${next.id}"]`);
  if (left && right) { left.style.width = `${(ui.boundaryDrag.time - segment.start) / duration * 100}%`; right.style.left = `${ui.boundaryDrag.time / duration * 100}%`; right.style.width = `${(next.end - ui.boundaryDrag.time) / duration * 100}%`; }
  status(`境界 ${fmt(ui.boundaryDrag.time)}（${fmt(ui.boundaryDrag.min)}〜${fmt(ui.boundaryDrag.max)}）`);
}

function finishBoundary() {
  if (!ui.boundaryDrag) return; const drag = ui.boundaryDrag; ui.boundaryDrag = null;
  runCommand({ type: 'set-segment-boundary', segmentId: drag.segmentId, time: +drag.time.toFixed(6) }, drag.segmentId); if (ui.preview) ui.preview.renderNow();
}

async function importVideo(file, expectedMedia) {
  status(expectedMedia ? '動画を照合しています…' : '動画を読み込んでいます…');
  if (!ui.media) ui.media = new J.MediaSourceController();
  if (ui.preview) { ui.preview.disconnect(); ui.preview = null; }
  let loaded;
  try { loaded = expectedMedia ? await ui.media.relink([file], expectedMedia) : await ui.media.load([file]); }
  catch (error) { if (expectedMedia && error.code === 'MEDIA_RELINK_MISMATCH') { $('captionRelinkNotice').hidden = false; status('選択した動画は、このプロジェクトの元動画と一致しません。', true); } throw error; }
  const project = clone(ui.store.project), frozenPlans = JSON.stringify(project.plans); project.media = loaded.projectMedia;
  // An untouched default box follows the new frame; a box the user edited stays exactly as set.
  if (!expectedMedia) { J.captionSyncDefaultBoxes(project); J.captionSyncTrackBoxes(project); }
  setProject(project, true); $('captionMediaName').textContent = `${loaded.metadata.name} · ${loaded.metadata.width}×${loaded.metadata.height}`;
  if (expectedMedia && JSON.stringify(ui.store.project.plans) !== frozenPlans) throw new Error('Relinking changed frozen caption plans.');
  $('captionRelinkNotice').hidden = true; $('captionPreviewEmpty').hidden = true; $('captionPlay').disabled = false; $('captionScrub').disabled = false;
  ui.preview = new J.MediaPreviewController({ video: loaded.video, canvas: $('captionPreview'), designWidth: J.videoOutputSize(project).width, designHeight: J.videoOutputSize(project).height, constrainAspect: true,
    renderSource: (ctx, source, width, height) => J.drawVideoEdit(ctx, source, width, height, ui.store.project),
    renderCaptions: drawCaptions, onFrame: frame => {
      updatePlayhead(frame.mediaTime);
      alignPreviewZone();
      if (ui.videoEditor) ui.videoEditor.paint();
      const clips = J.videoClips(ui.store.project);
      if (!loaded.video.paused && !loaded.video.seeking && !clips.some(clip => frame.mediaTime >= clip.start && frame.mediaTime < clip.end)) {
        const next = clips.find(clip => clip.start > frame.mediaTime);
        if (next) loaded.video.currentTime = next.start; else loaded.video.pause();
      }
    },
    onError: error => status(error.message || 'Video preview could not render a frame.', true) }).connect();
  loaded.video.addEventListener('play', () => { $('captionPlay').textContent = '❚❚'; }); loaded.video.addEventListener('pause', () => { $('captionPlay').textContent = '▶'; });
  status('動画を読み込みました。文字起こしを追加できます。');
}

async function openProject(file) {
  status('プロジェクトを開いています…');
  const loaded = J.loadProject(await file.text());
  if (loaded.mode !== 'video-captions') { const error = new Error('Video Captions プロジェクトを選んでください。'); error.code = 'CAPTION_PROJECT_REQUIRED'; throw error; }
  if (ui.preview) ui.preview.disconnect(); if (ui.media) ui.media.close(); ui.preview = null; ui.media = null; ui.selectedId = null;
  setProject(loaded); $('captionProjectName').textContent = file.name.replace(/\.json$/i, '') || loaded.id;
  const needsRelink = !!(loaded.media && (loaded.media.fingerprint || loaded.media.relinkRequired));
  $('captionRelinkNotice').hidden = !needsRelink; $('captionPreviewEmpty').hidden = false; $('captionPlay').disabled = true; $('captionScrub').disabled = true;
  $('captionMediaName').textContent = needsRelink ? `${loaded.media.name || '元動画'} · 再リンクが必要` : '動画未選択';
  status(needsRelink ? 'プロジェクトを開きました。元の動画を再リンクしてください。' : 'プロジェクトを開きました。');
}

async function importTranscript(file) {
  const text = await file.text(), ext = file.name.toLowerCase().split('.').pop(), duration = ui.store.project.media.duration;
  const transcript = ext === 'srt' ? J.importSrt(text, { timingQuality: 'estimated', duration }) : ext === 'vtt' ? J.importVtt(text, { timingQuality: 'estimated', duration }) : J.importWordJson(text, { duration });
  const project = clone(ui.store.project); project.transcript = transcript;
  project.segments = J.segmentCaptions(transcript, { duration }).segments;
  const planned = J.planCaptions(project, project.media); project.segments = planned.segments; project.plans = planned.plans; project.updatedAt = new Date().toISOString();
  setProject(project); status(`${project.segments.length}件の字幕を作成しました。`);
}

function replanStyle() {
  const project = clone(ui.store.project), motion = Number($('captionMotion').value) / 100, intensity = Number($('captionIntensity').value) / 100;
  project.style = Object.assign({}, project.style, { preset: $('captionStyle').value, effect: $('captionEffect').value, holdEffect: $('captionHoldEffect').value, exitEffect: $('captionExitEffect').value, captionTreatment: $('captionTreatment').value, intensity, motion, accentColor: $('captionAccent').value,
    editor: $('captionEditor').value === 'advanced' ? 'advanced' : 'simple',
    position: $('captionPosition').value, zones: [$('captionPosition').value], writingMode: $('captionWritingMode').value,
    emphasisStrength: Number($('captionEmphasisStrength').value) / 100,
    motionBudget: { maxIntensity: Math.max(0, Math.round(intensity * 3)), maxMotionCost: .25 + motion * .9, maxAttentionCost: .3 + intensity * .8 } });
  if (runCommand({ type: 'set-caption-style', style: project.style })) status('スタイルを更新しました。');
}

function changeDensity() {
  const maxWords = Number($('captionDensity').value); $('captionDensityValue').value = maxWords;
  if (!ui.store.project.transcript.tokens.length) { ui.store.project.style.segmentation = { maxWords, targetWords: Math.max(1, maxWords - 2) }; return; }
  const unlocked = ui.store.project.segments.some(segment => !(segment.locks && segment.locks.segmentation));
  if (unlocked && !window.confirm('単語数を変えると、ロックされていない字幕の区切りが変わることがあります。続けますか？')) { renderActions(); return; }
  const project = clone(ui.store.project); project.style = Object.assign({}, project.style, { segmentation: Object.assign({}, project.style && project.style.segmentation, { maxWords, targetWords: Math.max(1, maxWords - 2) }) });
  project.segments = J.replanCaptionSegments(project, project.style.segmentation).segments;
  const planned = J.planCaptions(project, project.media); project.plans = planned.plans; setProject(project, true); status('字幕の密度と区切りを更新しました。');
}

function bind() {
  setProject(emptyProject());
  $('captionVideoFile').addEventListener('change', event => { const file = event.target.files[0]; if (file) importVideo(file).catch(error => { if (error.code !== 'MEDIA_RELINK_MISMATCH') status(J.recoveryForError ? J.recoveryForError(error).display : error.message, true); }); event.target.value = ''; });
  $('captionRelinkFile').addEventListener('change', event => { const file = event.target.files[0], expected = clone(ui.store.project.media); if (file) importVideo(file, expected).catch(error => { if (error.code !== 'MEDIA_RELINK_MISMATCH') status(J.recoveryForError ? J.recoveryForError(error).display : error.message, true); }); event.target.value = ''; });
  $('captionProjectFile').addEventListener('change', event => { const file = event.target.files[0]; if (file) openProject(file).catch(error => status(J.recoveryForError ? J.recoveryForError(error).display : error.message, true)); event.target.value = ''; });
  $('captionTranscriptFile').addEventListener('change', event => { const file = event.target.files[0]; if (file) importTranscript(file).catch(error => status(J.recoveryForError ? J.recoveryForError(error).display : error.message, true)); event.target.value = ''; });
  $('captionManualAdd').addEventListener('click', () => {
    const startText = $('captionManualStart').value, endText = $('captionManualEnd').value;
    const id = ui.store.nextSegmentId();
    if (runCommand({ type: 'create-text-block', text: $('captionManualText').value, trackId: $('captionManualTrack').value || undefined,
      start: startText === '' ? NaN : Number(startText), end: endText === '' ? NaN : Number(endText) }, id, id)) {
      $('captionManualText').value = '';
      $('captionManualStart').value = endText;
      $('captionManualEnd').value = Number(endText) + 3;
    }
  });
  $('captionSegmentList').addEventListener('click', event => { const target = event.target.closest('[data-segment-id]'); if (target) selectSegment(target.dataset.segmentId, true); });
  $('captionSegmentTrack').addEventListener('click', event => { const target = event.target.closest('[data-segment-id]'); if (target) selectSegment(target.dataset.segmentId, true); });
  $('captionSegmentTrack').addEventListener('keydown', event => {
    const handle = event.target.closest('[data-boundary-segment]');
    if (handle && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); const segment = ui.store.project.segments.find(item => item.id === handle.dataset.boundarySegment), next = J.captionTrackNeighbor(ui.store.project, segment, 1), tokens = tokenMap();
      const min = tokens.get(segment.tokenIds[segment.tokenIds.length - 1]).end, max = tokens.get(next.tokenIds[0]).start, step = event.shiftKey ? .1 : .01, time = Math.max(min, Math.min(max, segment.end + (event.key === 'ArrowRight' ? step : -step)));
      runCommand({ type: 'set-segment-boundary', segmentId: segment.id, time: +time.toFixed(6) }, segment.id); return; }
    const target = event.target.closest('[data-segment-id]'); if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectSegment(target.dataset.segmentId, true); }
  });
  $('captionWordTrack').addEventListener('click', event => { const target = event.target.closest('[data-word-id]'); if (!target || ui.timelineZoom < 2) return; const token = tokenMap().get(target.dataset.wordId); if (token) { seekTimeline(token.start); status(`${token.text}: ${fmt(token.start)}–${fmt(token.end)}`); } });
  $('captionTimeline').addEventListener('click', event => { if (event.target.closest('button,[data-segment-id],.caption-boundary-handle')) return; seekTimeline(timelineTimeAt(event.clientX)); });
  $('captionSegmentTrack').addEventListener('pointerdown', event => { const handle = event.target.closest('[data-boundary-segment]'); if (handle) startBoundaryDrag(event, handle.dataset.boundarySegment); });
  window.addEventListener('pointermove', moveBoundary); window.addEventListener('pointerup', finishBoundary);
  $('captionTimelineIn').addEventListener('click', () => { ui.timelineZoom = Math.min(8, ui.timelineZoom * 2); renderSegments(); });
  $('captionTimelineOut').addEventListener('click', () => { ui.timelineZoom = Math.max(1, ui.timelineZoom / 2); renderSegments(); });
  $('captionTimelineFit').addEventListener('click', () => { ui.timelineZoom = 1; $('captionTimeline').scrollLeft = 0; renderSegments(); });
  $('captionPlay').addEventListener('click', () => { if (!sourceVideo()) return; if (sourceVideo().paused) { const clips = J.videoClips(ui.store.project), time = sourceVideo().currentTime; if (time >= clips[clips.length - 1].end) sourceVideo().currentTime = clips[0].start; else if (!clips.some(c => time >= c.start && time < c.end)) sourceVideo().currentTime = (clips.find(c => c.start > time) || clips[0]).start; sourceVideo().play().catch(error => status(error.message, true)); } else sourceVideo().pause(); });
  $('captionScrub').addEventListener('input', event => { if (!sourceVideo()) return; sourceVideo().currentTime = sourceVideo().duration * Number(event.target.value) / 1000; if (ui.preview) ui.preview.renderNow(); });
  $('captionUndo').addEventListener('click', () => { if (ui.store.undo()) renderAll(); }); $('captionRedo').addEventListener('click', () => { if (ui.store.redo()) renderAll(); });
  $('captionVariation').addEventListener('click', () => { const varied = J.createCaptionVisualVariation(ui.store.project, { variation: ++ui.variation, media: ui.store.project.media }); setProject(varied, true); status('新しいビジュアル案を作りました。'); });
  $('captionSave').addEventListener('click', () => J.saveFile(`jizura-${ui.store.project.id}.json`, ui.store.serialize()));
  $('captionExport').addEventListener('click', () => exportCaptions().catch(error => status(error.message, true)));
  $('captionNew').addEventListener('click', () => { if (ui.preview) ui.preview.disconnect(); if (ui.media) ui.media.close(); ui.media = null; ui.preview = null; ui.selectedId = null; setProject(emptyProject()); $('captionProjectName').textContent = '無題の字幕プロジェクト'; $('captionRelinkNotice').hidden = true; $('captionPreviewEmpty').hidden = false; $('captionMediaName').textContent = '動画未選択'; $('captionPlay').disabled = true; $('captionScrub').disabled = true; status('新しいプロジェクトを作成しました。'); });
  $('captionLock').addEventListener('click', () => { const segment = selectedSegment(); if (!segment) return; const locked = !!(segment.locks && segment.locks.visualPlan); runCommand({ type: 'set-segment-locks', segmentId: segment.id, locked: !locked }, segment.id); });
  $('captionReroll').addEventListener('click', () => { const segment = selectedSegment(); if (!segment) return; setProject(J.rerollCaptionVisual(ui.store.project, segment.id, { media: ui.store.project.media }), true); status('選択した字幕を再抽選しました。'); });
  $('captionDisableAnimation').addEventListener('click', () => { const segment = selectedSegment(); if (!segment) return; const plan = J.captionResolvedPlan(ui.store.project.plans[segment.id]);
    runCommand({ type: 'set-segment-animation-disabled', segmentId: segment.id, disabled: !plan.animationDisabled }, segment.id); });
  $('captionBlockApply').addEventListener('click', applyBlockText); $('captionBlockDelete').addEventListener('click', deleteBlock);
  for (const [key, id] of Object.entries(BLOCK_ANIMATION_CONTROLS)) $(id).addEventListener('change', event => setBlockAnimation(key, event.target.value));
  $('captionSelectedStart').addEventListener('change', applyTiming); $('captionSelectedEnd').addEventListener('change', applyTiming);
  $('captionSplit').addEventListener('click', () => { const segment = selectedSegment(), beforeTokenId = $('captionSplitPoint').value; if (!segment || !beforeTokenId) return;
    const nextId = ui.store.nextSegmentId(); if (runCommand({ type: 'split-segment', segmentId: segment.id, beforeTokenId, newSegmentId: nextId, boundarySource: 'manual' }, segment.id, nextId)) selectSegment(nextId, true); });
  $('captionMerge').addEventListener('click', () => { const segment = selectedSegment(); if (!segment) return; const next = J.captionTrackNeighbor(ui.store.project, segment, 1);
    if (next) runCommand({ type: 'merge-segments', segmentId: segment.id, nextSegmentId: next.id, boundarySource: 'manual' }, segment.id, segment.id); });
  $('captionTokenList').addEventListener('change', event => {
    const textId = event.target.dataset.tokenText, emphasisId = event.target.dataset.tokenEmphasis, moveId = event.target.dataset.tokenMove;
    if (moveId) { if (event.target.checked) ui.moveTokens.add(moveId); else ui.moveTokens.delete(moveId); }
    else if (textId) runCommand({ type: 'edit-token-text', tokenId: textId, text: event.target.value.trim() }, textId);
    else if (emphasisId) runCommand({ type: 'set-manual-emphasis', tokenId: emphasisId, value: event.target.checked ? { enabled: true, reason: 'editor' } : null }, emphasisId);
  });
  $('captionEffect').addEventListener('change', () => {
    if ($('captionEffect').value !== 'auto') {
      $('captionStyle').value = 'jizura-mv';
      $('captionIntensity').value = Math.max(70, Number($('captionIntensity').value));
      $('captionMotion').value = Math.max(65, Number($('captionMotion').value));
    }
    replanStyle();
  });
  for (const id of ['captionHoldEffect', 'captionExitEffect']) $(id).addEventListener('change', () => {
    $('captionStyle').value = 'jizura-mv'; replanStyle();
  });
  document.querySelectorAll('[data-caption-look]').forEach(button => button.addEventListener('click', () => {
    captionLooks[button.dataset.captionLook].forEach((value, i) => { $(effectControls[i]).value = value; });
    $('captionStyle').value = 'jizura-mv'; $('captionIntensity').value = 70; $('captionMotion').value = 65;
    replanStyle();
  }));
  $('captionEditor').addEventListener('change', replanStyle);
  $('captionTreatment').addEventListener('change', replanStyle);
  $('captionStyle').addEventListener('change', () => { $('captionEffect').value = 'auto'; $('captionHoldEffect').value = 'auto'; $('captionExitEffect').value = 'auto'; replanStyle(); }); $('captionIntensity').addEventListener('change', replanStyle); $('captionMotion').addEventListener('change', replanStyle); $('captionAccent').addEventListener('change', replanStyle);
  const boxEditor = $('captionBoxEditor');
  boxEditor.addEventListener('pointerdown', startBoxDrag); boxEditor.addEventListener('pointermove', moveBoxDrag);
  boxEditor.addEventListener('pointerup', () => finishBoxDrag()); boxEditor.addEventListener('pointercancel', () => finishBoxDrag(true)); boxEditor.addEventListener('keydown', nudgeBox);
  for (const id of ['captionBoxX', 'captionBoxY', 'captionBoxWidth', 'captionBoxHeight']) $(id).addEventListener('change', () => applyBoxInputs($(id)));
  $('captionBoxScope').addEventListener('change', renderBoxPanel); $('captionBoxReset').addEventListener('click', resetBox);
  $('captionTrackList').addEventListener('click', event => { const target = event.target.closest('[data-track-select]'); if (target) selectTrack(target.dataset.trackSelect); });
  $('captionTrackLabels').addEventListener('click', event => { const target = event.target.closest('[data-track-select]'); if (target) selectTrack(target.dataset.trackSelect); });
  $('captionTrackAdd').addEventListener('click', addTrack); $('captionTrackDelete').addEventListener('click', deleteTrack);
  $('captionTrackForward').addEventListener('click', () => reorderTrack(1)); $('captionTrackBack').addEventListener('click', () => reorderTrack(-1));
  $('captionTrackName').addEventListener('change', () => { const track = activeTrack(); if (track) runCommand({ type: 'rename-track', trackId: track.id, name: $('captionTrackName').value }); });
  $('captionTrackReroll').addEventListener('click', () => { const track = activeTrack(); if (track && runCommand({ type: 'reroll-track', trackId: track.id })) status('トラックの字幕を再抽選しました。'); });
  $('captionTrackPreset').addEventListener('change', () => applyTrackStyle('preset', $('captionTrackPreset').value || null));
  $('captionTrackTreatment').addEventListener('change', () => applyTrackStyle('captionTreatment', $('captionTrackTreatment').value || null));
  $('captionTrackAccent').addEventListener('change', () => { $('captionTrackAccent').dataset.unset = ''; applyTrackStyle('accentColor', $('captionTrackAccent').value); });
  $('captionTrackAccentClear').addEventListener('click', () => applyTrackStyle('accentColor', null));
  $('captionMoveSegment').addEventListener('click', () => moveToTrack(true)); $('captionMoveTokens').addEventListener('click', () => moveToTrack(false));
  fillRoleOptions();
  for (const id of Object.keys(ROLE_CONTROLS)) $(id).addEventListener('change', () => applyRoleInput($(id)));
  document.querySelectorAll('[data-role-clear]').forEach(button => button.addEventListener('click', () => clearRoleInput(button)));
  $('captionRolesReset').addEventListener('click', () => { const track = roleTrack(); if (track) runCommand({ type: 'set-track-roles', trackId: track.id, reset: true }); });
  window.addEventListener('resize', () => paintBoxEditor());
  $('captionPosition').addEventListener('change', replanStyle); $('captionWritingMode').addEventListener('change', replanStyle); $('captionEmphasisStrength').addEventListener('change', replanStyle);
  $('captionReducedMotion').addEventListener('change', event => { runCommand({ type: 'set-project-setting', field: 'reducedMotionPreview', value: event.target.checked }, ui.selectedId); status(event.target.checked ? 'プレビューの動きを減らしました。' : '通常のプレビュー動作に戻しました。'); });
  $('captionDensity').addEventListener('input', () => { $('captionDensityValue').value = $('captionDensity').value; }); $('captionDensity').addEventListener('change', changeDensity);
  $('app').addEventListener('jizura:product-mode', event => {
    if (!sourceVideo()) return;
    if (event.detail.mode !== 'video-captions') sourceVideo().pause();
    else if (ui.preview) ui.preview.renderNow();
  });
  window.addEventListener('beforeunload', () => { if (ui.exportAbort) ui.exportAbort.abort(); if (ui.preview) ui.preview.disconnect(); if (ui.media) ui.media.close(); });
}

const captionSetTechnique = J.CaptionStore.prototype.setTechnique;
J.CaptionStore.prototype.setTechnique = function (command) {
  captionSetTechnique.call(this, command);
  if (command.group && J.CAPTION_TECHNIQUE_DRAW[command.group] === true && this.project.transcript.tokens.length) {
    this.project.plans = J.planCaptions(this.project, this.project.media).plans;
  }
};

/* The single-file build places scripts after the complete body. Initializing
   here avoids depending on listener ordering with the preserved lyric UI. */
bind();
if (J.mountVideoEditor) ui.videoEditor = J.mountVideoEditor({ host: $('captionVideoEditor'), project: () => ui.store.project, video: sourceVideo,
  commit: value => runCommand({ type: 'set-video-edits', value }), status });
J.captionWorkbench = ui;
})();
