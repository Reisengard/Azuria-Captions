/* ============================================================
   JIZURA — Video Captions workbench (Gate 5.2)
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;

const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
const ui = { store: null, media: null, preview: null, selectedId: null, variation: 0, errors: {}, timelineZoom: 1, boundaryDrag: null,
  exporter: null, exportAbort: null };
const captionLooks = {
  clean: ['captionSoftRise', 'captionStill', 'captionFadeOut', 'outline'],
  pop: ['captionPop', 'captionStill', 'captionShrinkOut', 'echo'],
  neon: ['captionBlur', 'captionWave', 'captionBlurOut', 'neon'],
  type: ['captionType', 'captionStill', 'captionFadeOut', 'backplate'],
};
const effectControls = ['captionEffect', 'captionHoldEffect', 'captionExitEffect', 'captionTreatment'];
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
    segments: [], plans: {}, safeZones: [], seed: 3107, style: { preset: 'creator', intensity: .5, motion: .45, accentColor: '#f5a50c', editor: 'simple' },
    settings: {}, createdAt: now, updatedAt: now };
}

function status(message, error) { const el = $('captionStatus'); if (el) { el.textContent = message; el.classList.toggle('danger-text', !!error); } }
function selectedSegment() { return ui.store && ui.store.project.segments.find(segment => segment.id === ui.selectedId) || null; }
function segmentText(segment) { const tokens = tokenMap(); return (segment && segment.tokenIds || []).map(id => tokens.get(id)).filter(Boolean).map(token => token.text).join(' '); }

function accessibilityWarnings(segment) {
  if (!segment) return [];
  const stored = ui.store.project.plans[segment.id] || {}, plan = J.captionResolvedPlan(stored), readability = plan.readability || {}, reasons = new Set(readability.reasons || []), warnings = [];
  if (reasons.has('horizontal-overflow') || reasons.has('vertical-overflow')) warnings.push('字幕が表示範囲からはみ出します。文字数・位置・サイズを調整してください。');
  if (reasons.has('too-many-lines')) warnings.push('字幕の行数が多すぎます。字幕あたりの単語数を減らしてください。');
  if (reasons.has('contrast-insufficient') || readability.warnings && readability.warnings.includes('contrast-assisted')) warnings.push('背景とのコントラストを確認してください。アウトラインまたは背景板を推奨します。');
  if ((plan.components || []).some(component => component.metadata && component.metadata.flashes)) warnings.push('点滅を含む演出です。光過敏への配慮から別の演出を推奨します。');
  if (plan.fallback) warnings.push('安全性と読みやすさのため、この字幕は静止表示にフォールバックしました。文字数を減らすか、動きと強さを下げると再計画できます。');

  if (plan.font && document.fonts && typeof document.fonts.check === 'function' && !document.fonts.check(`16px "${String(plan.font).replace(/["\\]/g, '')}"`)) warnings.push('指定フォントを読み込めませんでした。ネットワークを確認するか、別のフォントを選んでください。');
  const frame = ui.store.project.media || {}, zone = plan.zone;
  if (zone && frame.width > 0 && frame.height > 0) { const safe = J.captionSocialSafeRect(frame); if (zone.x < safe.x || zone.y < safe.y || zone.x + zone.width > safe.x + safe.width || zone.y + zone.height > safe.y + safe.height) warnings.push('字幕が推奨セーフエリアの外にあります。'); }
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
  project.segments.forEach((segment, segmentIndex) => {
    const text = segmentText(segment), item = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.className = 'caption-segment'; button.dataset.segmentId = segment.id;
    button.setAttribute('aria-selected', String(segment.id === ui.selectedId));
    const warning = accessibilityWarnings(segment).length ? '<span class="caption-segment-warning" aria-label="アクセシビリティ警告">⚠</span>' : '';
    button.innerHTML = `<span class="caption-segment-time">${fmt(segment.start)}</span><span>${escapeHtml(text)} ${warning}</span>`;
    item.appendChild(button); list.appendChild(item);
    const block = document.createElement('div'); block.className = 'caption-timeline-segment' + (segment.id === ui.selectedId ? ' selected' : ''); block.setAttribute('role', 'button'); block.tabIndex = 0;
    block.dataset.segmentId = segment.id; block.textContent = text; block.title = `${fmt(segment.start)}–${fmt(segment.end)} ${text}`;
    block.style.left = `${segment.start / duration * 100}%`; block.style.width = `${Math.max(.25, (segment.end - segment.start) / duration * 100)}%`;
    if (segmentIndex < project.segments.length - 1 && !(segment.locks && segment.locks.segmentation)) { const handle = document.createElement('span'); handle.className = 'caption-boundary-handle'; handle.dataset.boundarySegment = segment.id; handle.setAttribute('role', 'slider'); handle.setAttribute('aria-label', `${text} の終了境界`); handle.tabIndex = 0; block.appendChild(handle); }
    track.appendChild(block);
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
  const zone = resolved.zone, frame = ui.store.project.media || {};
  if (zone && frame.width > 0 && frame.height > 0) Object.assign(document.querySelector('.caption-safe-zone').style, {
    left: `${zone.x / frame.width * 100}%`, top: `${zone.y / frame.height * 100}%`, width: `${zone.width / frame.width * 100}%`, height: `${zone.height / frame.height * 100}%`, right: 'auto', bottom: 'auto',
  });
  const qualities = new Set(segmentTokens.map(token => token.timingQuality));
  $('captionSelectedQuality').textContent = qualities.has('estimated') ? '推定' : qualities.has('segment') ? 'セグメント単位' : '単語単位';
  const error = ui.errors[segment.id], errorEl = $('captionEditError'); errorEl.hidden = !error; errorEl.textContent = error || '';
  const split = $('captionSplitPoint'); split.replaceChildren();
  segmentTokens.slice(1).forEach(token => { const option = document.createElement('option'); option.value = token.id; option.textContent = `「${token.text}」の前`; split.appendChild(option); });
  $('captionSplit').disabled = segmentTokens.length < 2 || !!(segment.locks && segment.locks.segmentation);
  const segmentIndex = ui.store.project.segments.indexOf(segment); $('captionMerge').disabled = segmentIndex >= ui.store.project.segments.length - 1 || !!(segment.locks && segment.locks.segmentation);
  const tokenList = $('captionTokenList'); tokenList.replaceChildren();
  for (const token of segmentTokens) {
    const row = document.createElement('div'); row.className = 'caption-token-row'; row.dataset.tokenId = token.id;
    const input = document.createElement('input'); input.type = 'text'; input.value = token.text; input.setAttribute('aria-label', `${token.text} の表示文字`); input.dataset.tokenText = token.id;
    const emphasis = document.createElement('label'); emphasis.className = 'caption-token-emphasis';
    const check = document.createElement('input'); check.type = 'checkbox'; check.checked = !!(token.manualEmphasis && token.manualEmphasis.enabled); check.dataset.tokenEmphasis = token.id;
    emphasis.append(check, document.createTextNode(' 強調'));
    const meta = document.createElement('span'); meta.className = 'caption-token-meta'; meta.innerHTML = `<span>${fmt(token.start)}–${fmt(token.end)}</span><span>${token.timingQuality === 'estimated' ? '推定' : '単語'}</span>`;
    row.append(input, emphasis, meta);
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

function commandError(error) {
  const messages = { TOKEN_TEXT_REQUIRED: '単語は空にできません。', SEGMENT_FIELD_LOCKED: 'この項目はロックされています。',
    SEGMENT_TIMING_INVALID: '開始と終了の時刻を確認してください。', SEGMENT_SPLIT_INVALID: '分割位置を選び直してください。', SEGMENTS_NOT_ADJACENT: '隣り合う字幕だけ結合できます。' };
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
  const first = tokens.get(segment.tokenIds[0]), last = tokens.get(segment.tokenIds[segment.tokenIds.length - 1]);
  const index = ui.store.project.segments.indexOf(segment), previous = ui.store.project.segments[index - 1], next = ui.store.project.segments[index + 1];
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
  if (ui.videoEditor) ui.videoEditor.refresh();
  if (ui.preview && J.videoOutputSize) { const size = J.videoOutputSize(ui.store.project); ui.preview.designWidth = size.width; ui.preview.designHeight = size.height; }
  renderSegments(); renderInspector(); renderActions(); updatePlayhead(sourceVideo() && sourceVideo().currentTime || 0); if (ui.preview) ui.preview.renderNow();
}
function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }

function selectSegment(id, seek) {
  const segment = ui.store.project.segments.find(item => item.id === id); if (!segment) return;
  ui.selectedId = id; if (seek && sourceVideo()) { sourceVideo().currentTime = segment.start; if (ui.preview) ui.preview.renderNow(segment.start); }
  renderSegments(); renderInspector();
}

function segmentAt(time) { return ui.store.project.segments.find(segment => time >= segment.start && time < segment.end) || null; }
function drawCaptions(ctx, time, info) {
  return J.drawCaptionOverlay(ctx, ui.store.project, time, Object.assign({}, info, { reducedMotion: !!ui.store.project.settings.reducedMotionPreview }));
}

function alignPreviewZone() {
  const canvas = $('captionPreview'), frame = $('captionPreviewFrame');
  if (!canvas.getBoundingClientRect || !frame.getBoundingClientRect) return;
  const guide = document.querySelector('.caption-safe-zone'), segment = selectedSegment();
  if (!guide) return;
  const plan = segment && J.captionResolvedPlan(ui.store.project.plans[segment.id]), zone = plan && plan.zone;
  guide.hidden = !zone;
  if (!zone) return;
  const box = canvas.getBoundingClientRect(), parent = frame.getBoundingClientRect(), media = ui.store.project.media;
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
  const segment = ui.store.project.segments.find(item => item.id === segmentId), index = ui.store.project.segments.indexOf(segment), next = ui.store.project.segments[index + 1]; if (!segment || !next) return;
  const tokens = tokenMap(), min = tokens.get(segment.tokenIds[segment.tokenIds.length - 1]).end, max = tokens.get(next.tokenIds[0]).start;
  ui.boundaryDrag = { segmentId, min, max, time: segment.end }; event.preventDefault(); event.target.setPointerCapture && event.target.setPointerCapture(event.pointerId);
}

function moveBoundary(event) {
  if (!ui.boundaryDrag) return; ui.boundaryDrag.time = Math.max(ui.boundaryDrag.min, Math.min(ui.boundaryDrag.max, timelineTimeAt(event.clientX)));
  const segment = ui.store.project.segments.find(item => item.id === ui.boundaryDrag.segmentId), next = ui.store.project.segments[ui.store.project.segments.indexOf(segment) + 1], duration = Number(ui.store.project.media.duration) || 1;
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
    if (runCommand({ type: 'add-caption', text: $('captionManualText').value,
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
    if (handle && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); const segment = ui.store.project.segments.find(item => item.id === handle.dataset.boundarySegment), index = ui.store.project.segments.indexOf(segment), next = ui.store.project.segments[index + 1], tokens = tokenMap();
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
  $('captionSelectedStart').addEventListener('change', applyTiming); $('captionSelectedEnd').addEventListener('change', applyTiming);
  $('captionSplit').addEventListener('click', () => { const segment = selectedSegment(), beforeTokenId = $('captionSplitPoint').value; if (!segment || !beforeTokenId) return;
    const nextId = ui.store.nextSegmentId(); if (runCommand({ type: 'split-segment', segmentId: segment.id, beforeTokenId, newSegmentId: nextId, boundarySource: 'manual' }, segment.id, nextId)) selectSegment(nextId, true); });
  $('captionMerge').addEventListener('click', () => { const segment = selectedSegment(); if (!segment) return; const index = ui.store.project.segments.indexOf(segment), next = ui.store.project.segments[index + 1];
    if (next) runCommand({ type: 'merge-segments', segmentId: segment.id, nextSegmentId: next.id, boundarySource: 'manual' }, segment.id, segment.id); });
  $('captionTokenList').addEventListener('change', event => {
    const textId = event.target.dataset.tokenText, emphasisId = event.target.dataset.tokenEmphasis;
    if (textId) runCommand({ type: 'edit-token-text', tokenId: textId, text: event.target.value.trim() }, textId);
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
