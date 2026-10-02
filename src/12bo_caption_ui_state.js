/* ============================================================
   JIZURA — Video Captions workbench: shared state, event bus, selection, helpers
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb = { inits: [] };
const $ = id => document.getElementById(id);
const clone = value => JSON.parse(JSON.stringify(value));
/* A tiny event bus: the workbench modules subscribe to 'project' (the store changed or was replaced), 'selection', 'time' (playhead) and 'error' (a command was refused).
   Lower priority numbers run first. */
const listeners = Object.create(null);
function on(name, fn, priority) {
  const list = listeners[name] || (listeners[name] = []);
  list.push({ fn, priority: priority || 0 }); list.sort((a, b) => a.priority - b.priority);
}
function emit(name, detail) { for (const item of (listeners[name] || []).slice()) item.fn(detail); }

/* Selection is state of its own: the playhead never changes it (it only marks the captions on screen in `currentIds`).
   `ui.selectedId`, `ui.trackId` and `ui.wordId` read and write this object. */
const ui = { store: null, media: null, preview: null, moveTokens: new Set(), variation: 0, lookScope: 'project', errors: {}, timelineZoom: 1, boundaryDrag: null,
  exporter: null, exportAbort: null, currentIds: new Set(), selection: { segmentIds: new Set(), trackId: null, wordId: null } };
Object.defineProperties(ui, {
  selectedId: { enumerable: true, get() { const ids = ui.selection.segmentIds; return ids.size ? ids.values().next().value : null; },
    set(id) { ui.selection.segmentIds = id ? new Set([id]) : new Set(); } },
  trackId: { enumerable: true, get() { return ui.selection.trackId; }, set(id) { ui.selection.trackId = id; } },
  wordId: { enumerable: true, get() { return ui.selection.wordId; }, set(id) { ui.selection.wordId = id; } },
});
function toggleSelect(id) {
  const ids = new Set(ui.selection.segmentIds);
  if (ids.has(id)) ids.delete(id); else if (ui.store.project.segments.some(segment => segment.id === id)) ids.add(id);
  ui.selection.segmentIds = ids; emit('selection');
}
function clearSelection() { ui.selection.segmentIds = new Set(); ui.selection.wordId = null; emit('selection'); }

const LOOK_FIELD_NAMES = { layout: 'レイアウト', enter: '登場', hold: '表示中', exit: '退場', active: '話している単語', treat: '文字の加工' };
const PRESET_LABELS = { captionFade: 'Fade', captionSoftRise: 'Rise', captionSoftScale: 'Zoom', captionWordFade: 'Letter Fade', captionSoftReplace: 'Replace', captionImpact: 'Impact',
  captionType: 'Typewriter', captionBlur: 'Blur Reveal', captionWipe: 'Wipe', captionPop: 'Lyric Pop', captionDrop: 'Letter Drop', captionStill: 'Still', captionBreathe: 'Breathe',
  captionWave: 'MV Wave', captionFadeOut: 'Fade out', captionShrinkOut: 'Shrink out', captionBlurOut: 'Blur out',
  captionBottomStack: 'Stack', captionBottomTwoLine: 'Two lines', captionCenterStack: 'Centered stack', captionLeftAnchor: 'Left anchor', captionRightAnchor: 'Right anchor', captionTwoLinePunch: 'Two-line punch', captionSingleWordHero: 'One-word hero', captionOutlined: 'Outlined text',
  captionBackplate: 'Backplate', captionActiveColor: 'Color', captionActiveScale: 'Scale', captionActiveLift: 'Lift', captionActiveWeight: 'Weight', captionActiveUnderline: 'Underline' };
const lookLabel = (key, id) => {
  if (!id) return '';
  const group = J.CAPTION_LOOK_FIELDS[key].group, def = group === 'active' ? J.CAPTION_ACTIVE[id] : J.registry(group)[id];
  return PRESET_LABELS[id] || def && def.name || id;
};
const sourceVideo = () => ui.media && ui.media.current && ui.media.current.video;
const tokenMap = () => new Map((ui.store && ui.store.project.transcript.tokens || []).map(token => [token.id, token]));
const fmt = value => {
  const seconds = Math.max(0, Number(value) || 0), minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
};
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
  for (const item of plan.lookWarnings || []) {
    if (item.code === 'look-unavailable') warnings.push(`${LOOK_FIELD_NAMES[item.field] || item.field}: 選んだエフェクトはこの字幕では使えないため、安全な標準に置き換えました。`);
    if (item.code === 'font-reduced') warnings.push(`文字が入りきらないため、サイズを ${item.from} から ${item.to} に下げました。文字数か位置ボックスを調整すると元のサイズに戻せます。`);
  }
  if ((plan.overBudget || []).length) warnings.push('動きが多めの組み合わせです。読みにくい場合は、エフェクトを控えめにしてください。');
  if (plan.fallback) warnings.push('安全性と読みやすさのため、この字幕は静止表示にフォールバックしました。文字数を減らすか、動きと強さを下げると再計画できます。');

  if (plan.font && document.fonts && typeof document.fonts.check === 'function' && !document.fonts.check(`16px "${String(plan.font).replace(/["\\]/g, '')}"`)) warnings.push('指定フォントを読み込めませんでした。ネットワークを確認するか、別のフォントを選んでください。');
  const frame = ui.store.project.media || {}, box = plan.box || (plan.zone && frame.width > 0 ? J.captionZoneToBox(plan.zone, frame) : null);
  if (box && frame.width > 0 && frame.height > 0) for (const warning of J.captionBoxWarnings(box, frame)) warnings.push(boxWarningText(warning));
  for (const hit of J.captionBoxCollisions(ui.store.project)) if (hit.segmentId === segment.id || hit.otherSegmentId === segment.id) {
    warnings.push(`他のトラックの字幕と位置が重なっています: ${trackName(hit.segmentId === segment.id ? hit.otherTrackId : hit.trackId)} ${fmt(hit.start)}–${fmt(hit.end)}。位置ボックスを調整してください。`);
  }
  return warnings;
}
function commandError(error) {
  const messages = { TOKEN_TEXT_REQUIRED: '単語は空にできません。', SEGMENT_FIELD_LOCKED: 'この項目はロックされています。', CAPTION_BOX_INVALID: '位置ボックスは画面内（0〜100%）に収めてください。',
    SEGMENT_TIMING_INVALID: '開始と終了の時刻を確認してください。', SEGMENT_SPLIT_INVALID: '分割位置を選び直してください。', SEGMENTS_NOT_ADJACENT: '隣り合う字幕だけ結合できます。',
    TRACKS_LIMIT: 'トラックは最大3つまでです。', TRACK_PRIMARY_UNDELETABLE: 'メイントラックは削除できません。', TRACK_NAME_INVALID: 'トラック名は1〜40文字で入力してください。',
    TRACK_STYLE_INVALID: 'トラックのスタイルの値が正しくありません。', TOKENS_REQUIRED: '移動する単語を選んでください。', TRACK_NOTHING_TO_REROLL: 'ロックされていない字幕がありません。',
    TRACK_SEGMENT_OVERLAP: '移動先のトラックで他の字幕と時間が重なります。先にその字幕を移動または短くしてください。',
    SEGMENT_WORDS_OUTSIDE: '字幕は含まれる単語と隣の字幕の範囲内に設定してください。',
    TEXT_BLOCK_OVERLAP: 'この時間には同じトラックに別の字幕があります。別のトラックを選ぶか、空いている時間を指定してください。', TOKEN_END_AFTER_DURATION: '字幕の終了が動画の長さを超えています。',
    CAPTION_LOOK_INVALID: '選んだエフェクトが正しくありません。', TEXT_BLOCK_ANIMATION_INVALID: 'ブロックのアニメーションが正しくありません。', SEGMENT_NOT_TEXT_BLOCK: 'テキストブロックではありません。' };
  return messages[error.code] || error.message || '変更を適用できませんでした。';
}
function runCommand(command, errorKey, nextSelection) {
  try {
    ui.store.execute(command); ui.errors = {}; if (nextSelection) ui.selectedId = nextSelection; emit('project'); status('変更を保存しました。'); return true;
  } catch (error) { ui.errors[errorKey || ui.selectedId] = commandError(error); emit('error'); status(commandError(error), true); return false; }
}
function escapeHtml(value) { const node = document.createElement('span'); node.textContent = value; return node.innerHTML; }
function selectSegment(id, seek) {
  const segment = ui.store.project.segments.find(item => item.id === id); if (!segment) return;
  if (id !== ui.selectedId) { ui.moveTokens.clear(); ui.wordId = null; }
  ui.selectedId = id; ui.trackId = segmentTrackId(segment);
  if (seek && sourceVideo()) { sourceVideo().currentTime = segment.start; if (ui.preview) ui.preview.renderNow(segment.start); }
  emit('selection');
}

Object.assign(W, { $, BOX_WARNINGS, LOOK_FIELD_NAMES, PRESET_LABELS, PRIMARY_TRACK, accessibilityWarnings, activeTrack, boxWarningText, clearSelection, clone, commandError, emit, escapeHtml, fmt, lookLabel, on, runCommand, segmentText, segmentTrackId, selectSegment, selectedSegment, sourceVideo, status, toggleSelect, tokenMap, trackName, ui });
})();
