/* ============================================================
   JIZURA — Video Captions workbench: tap sync for captions (C4) and for the words of one caption (C5)
   The video plays; Space (or the Tap button) marks "the next caption starts now". A short tap ends the caption where the next one starts,
   a hold ends it on release. Nothing is committed during the pass: ghosts on the timeline show the new times, Stop sends one batch (one undo), Esc discards.
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb, TL = J.captionTimeline;
const { ui, $, status, sourceVideo, fmt, segmentText, segmentTrackId, selectedSegment, on, emit } = W;
const tr = ui.transport;
const OFFSET_KEY = 'jizura.captionSyncOffset', SYNC_SPEED = .75, PRE_ROLL = 1.5;
let session = null, panel = null;
const parts = {};

const timingLocked = segment => { const fields = segment.locks && Array.isArray(segment.locks.fields) ? segment.locks.fields : []; return ['timing', 'start', 'end'].some(field => fields.includes(field)); };
function loadOffset() { try { const saved = localStorage.getItem(OFFSET_KEY); if (saved !== null) return TL.clampReaction(saved); } catch (error) { /* storage blocked */ } return TL.REACTION_DEFAULT; }
function saveOffset() { try { localStorage.setItem(OFFSET_KEY, String(tr.syncOffset)); } catch (error) { /* view preference only */ } }
const active = () => !!session;
/* Spoken captions with real word times move whole (words included); typed / SRT captions and blocks get a new window. */
function isSpoken(segment) {
  const tokens = W.tokenMap();
  return !J.isCaptionTextBlock(ui.store.project, segment) && segment.tokenIds.every(id => { const token = tokens.get(id); return token && token.timingQuality === 'word'; });
}

const label = item => session.kind === 'words' ? item.text : segmentText(session.byId.get(item.id));
function windows() {
  if (session.kind === 'words') return TL.wordSyncTimes(session.items, session.taps, { offset: tr.syncOffset, start: session.floor, end: session.after }).map(item => ({ id: item.tokenId, start: item.start, end: item.end }));
  return TL.tapSyncWindows(session.items, session.taps, { offset: tr.syncOffset, floor: session.floor, after: session.after, duration: Number(ui.store.project.media.duration) || Infinity });
}
const rowFor = trackId => document.querySelector(`#captionSegmentTrack [data-track-id="${trackId}"]`);
const blockFor = id => document.querySelector(`#captionSegmentTrack [data-segment-id="${id}"]`);

/* Ghosts: the proposed window of every tapped caption, drawn over its row; the original block is dimmed. */
function paint() {
  if (!session) return;
  const list = windows(), pps = ui.timeline.pps, row = rowFor(session.trackId);
  list.forEach((item, index) => {
    let ghost = session.ghosts[index];
    if (!ghost) { ghost = session.ghosts[index] = document.createElement('div'); ghost.className = 'caption-drag-ghost caption-sync-ghost'; ghost.setAttribute('aria-hidden', 'true'); if (row) row.appendChild(ghost); const block = blockFor(item.id); if (block) block.classList.add('is-sync-replaced'); }
    ghost.style.left = `${item.start * pps}px`; ghost.style.width = `${Math.max(2, (item.end - item.start) * pps)}px`; ghost.title = `${fmt(item.start)}–${fmt(item.end)} ${label(session.items[index])}`;
    ghost.classList.toggle('is-held', session.holding === index);
  });
  while (session.ghosts.length > list.length) session.ghosts.pop().remove();   // a looped word pass starts over
}
function renderPanel() {
  if (!panel) return;
  panel.hidden = !session; if (!session) return;
  const done = session.taps.length, total = session.items.length, next = session.items[done];
  parts.next.textContent = next ? `次: 「${label(next)}」（${done + 1} / ${total}）` : `すべてタップしました（${total}件）。「確定」で反映します。`;
  parts.tap.disabled = !next && session.holding === null; parts.tap.classList.toggle('is-down', session.holding !== null);
  parts.offset.value = String(tr.syncOffset); parts.offsetValue.textContent = `${tr.syncOffset.toFixed(2)}s`;
}

function start() {
  if (session) return true;
  const video = sourceVideo(); if (!video) { status('動画を読み込んでください。', true); return false; }
  const project = ui.store.project, selected = selectedSegment(), region = tr.marked;   // only a range marked on the ruler narrows the scope (the loop of a selected caption does not)
  if (!selected && !region) { status('同期を始める字幕を選ぶか、ルーラーで範囲を指定してください。', true); return false; }
  const trackId = selected ? segmentTrackId(selected) : (W.activeTrack() || {}).id;
  const scope = TL.tapSyncScope(project.segments.map(segment => ({ id: segment.id, trackId: segmentTrackId(segment), start: segment.start, end: segment.end, locked: timingLocked(segment) })),
    { trackId, fromId: selected && selected.id, region });
  if (!scope.items.length) { status('同期できる字幕がありません。', true); return false; }
  if (ui.drag || ui.gesture) return false;
  const byId = new Map(project.segments.map(segment => [segment.id, segment]));
  const spoken = scope.items.filter(item => isSpoken(byId.get(item.id))).length;
  W.closeEditor && W.closeEditor(false);
  session = { items: scope.items, floor: scope.floor, after: scope.after, trackId, region, taps: [], holding: null, ghosts: [], byId, video, prevSpeed: tr.speed };
  tr.syncing = true; W.setSpeed(SYNC_SPEED);
  W.seekTimeline(Math.max(0, scope.items[0].start - PRE_ROLL));
  $('captionSync').setAttribute('aria-pressed', 'true'); renderPanel(); paint();
  video.play().catch(error => status(error.message, true));
  status(`同期: 字幕が始まる瞬間に Space を押してください（${scope.items.length}件）。` + (spoken ? ` 音声の字幕 ${spoken} 件は単語ごと動かします（長さは変わりません）。` : '') + (scope.skipped ? ` 固定中の ${scope.skipped} 件は除きます。` : ''));
  parts.tap.focus();
  return true;
}

/* Words of the selected caption: it loops while the words are tapped one by one; a new loop pass starts the taps over. */
function startWords() {
  if (session) return true;
  const video = sourceVideo(), segment = selectedSegment(); if (!video) { status('動画を読み込んでください。', true); return false; }
  if (!segment) { status('単語を同期する字幕を選んでください。', true); return false; }
  if (timingLocked(segment)) { status('この字幕のタイミングは固定中のため、同期できません。', true); return false; }
  if (ui.drag || ui.gesture) return false;
  const tokens = segment.tokenIds.map(id => W.tokenMap().get(id)).filter(Boolean);
  if (!tokens.length) { status('同期できる単語がありません。', true); return false; }
  W.closeEditor && W.closeEditor(false);
  session = { kind: 'words', items: tokens.map(token => ({ id: token.id, text: token.text, start: token.start, end: token.end })), floor: segment.start, after: segment.end, trackId: segmentTrackId(segment), segmentId: segment.id, tokenKey: segment.tokenIds.join(), region: null,
    taps: [], holding: null, ghosts: [], byId: new Map([[segment.id, segment]]), video, prevSpeed: tr.speed, prevLoop: { on: tr.loopOn, region: tr.region }, lastTime: -1 };
  W.setSpeed(SYNC_SPEED); W.setLoop(false); W.setLoop(true);
  tr.region = TL.loopRegion(null, segment, Number(ui.store.project.media.duration) || Infinity);   // the loop is this caption (± the lead), not a range marked on the ruler
  W.seekTimeline(tr.region.start);
  $('captionSync').setAttribute('aria-pressed', 'true'); renderPanel(); paint();
  video.play().catch(error => status(error.message, true));
  status(`単語の同期: 字幕がループします。各単語が始まる瞬間に Space を押してください（${tokens.length}語）。`);
  parts.tap.focus();
  return true;
}

function tapDown() {
  if (!session || session.holding !== null || session.taps.length >= session.items.length) return;
  session.taps.push({ down: +session.video.currentTime.toFixed(3), up: null }); session.holding = session.taps.length - 1; paint(); renderPanel();
}
function tapUp() {
  if (!session || session.holding === null) return;
  session.taps[session.holding].up = +session.video.currentTime.toFixed(3); session.holding = null; paint(); renderPanel();
}

function wordsCommand() {
  const times = windows().filter(item => { const token = session.items.find(word => word.id === item.id); return Math.abs(token.start - item.start) > 1e-6 || Math.abs(token.end - item.end) > 1e-6; }).map(item => ({ tokenId: item.id, start: item.start, end: item.end }));
  return times.length ? { type: 'retime-tokens', segmentId: session.segmentId, times } : null;
}
function commandFor(item) {
  const segment = session.byId.get(item.id), block = J.isCaptionTextBlock(ui.store.project, segment);
  if (isSpoken(segment)) return Math.abs(item.start - segment.start) < 1e-6 ? null : { type: 'move-segment', segmentId: segment.id, start: item.start };
  if (Math.abs(item.start - segment.start) < 1e-6 && Math.abs(item.end - segment.end) < 1e-6) return null;
  return { type: 'trim-segment', segmentId: segment.id, start: item.start, end: item.end, words: block ? 'keep' : 'fit' };
}
/* One batch = one undo step. Moving captions one after another can overlap for a moment, so the reverse order is tried as well; nothing is changed when both fail. */
function commit() {
  if (session.kind === 'words') {
    const command = wordsCommand(); if (!command) { status('タイミングは変わりませんでした。'); return true; }
    try { ui.store.execute(command); ui.errors = {}; emit('project'); return command.times.length; } catch (error) { status(W.commandError(error), true); return false; }
  }
  const commands = windows().map(commandFor).filter(Boolean);
  if (!commands.length) { status('タイミングは変わりませんでした。'); return true; }
  let failure = null;
  for (const list of [commands, commands.slice().reverse()]) {
    try { ui.store.execute({ type: 'batch', commands: list, label: 'tap sync' }); ui.errors = {}; emit('project'); return commands.length; }
    catch (error) { failure = failure || error; }
  }
  status(W.commandError(failure), true); return false;
}

function end() {
  const s = session; if (!s) return;
  session = null; tr.syncing = false;
  if (s.kind === 'words') { W.setLoop(false); if (s.prevLoop.on) W.setLoop(true); }
  s.ghosts.forEach(ghost => ghost.remove()); document.querySelectorAll('.is-sync-replaced').forEach(block => block.classList.remove('is-sync-replaced'));
  if (!s.video.paused) s.video.pause();
  W.setSpeed(s.prevSpeed); $('captionSync').setAttribute('aria-pressed', 'false'); renderPanel();
  const button = $('captionSync'); if (document.activeElement && panel && panel.contains(document.activeElement)) button.focus();
}
function stop(apply) {
  const s = session; if (!s) return;
  if (s.holding !== null) tapUp();
  if (!apply) { end(); status('同期を破棄しました。変更はありません。'); return; }
  const done = s.taps.length ? commit() : 0;
  if (done === false) return;   // refused: the pass stays open so it can be fixed (Esc discards)
  end();
  if (done) { if (ui.preview) ui.preview.renderNow(); W.toastUndo(s.kind === 'words' ? `${done}語のタイミングを同期しました` : `${done}件の字幕のタイミングを同期しました`); } else if (!s.taps.length) status('タップがなかったため、変更はありません。');
}

/* Called by the transport keyboard handler: Space taps, Enter confirms, Esc discards; the other transport keys are swallowed during a pass. */
function syncKey(event) {
  if (!session) return false;
  const target = event.target || {};
  if (event.code === 'Space') { if (!event.repeat) tapDown(); return true; }
  if (event.code === 'Escape') { stop(false); return true; }
  if ((event.code === 'Enter' || event.code === 'NumpadEnter') && target.tagName !== 'BUTTON') { stop(true); return true; }
  return !!TL.keyAction(event) && target.tagName !== 'BUTTON';
}

function build() {
  panel = document.createElement('div'); panel.id = 'captionSyncPanel'; panel.className = 'caption-sync-panel'; panel.setAttribute('role', 'group'); panel.setAttribute('aria-label', 'タップ同期'); panel.hidden = true;
  const make = (tag, props) => Object.assign(document.createElement(tag), props);
  parts.next = make('div', { id: 'captionSyncNext', className: 'caption-sync-next' }); parts.next.setAttribute('role', 'status');
  parts.tap = make('button', { id: 'captionSyncTap', type: 'button', className: 'primary caption-sync-tap', textContent: 'タップ（Space）' });
  parts.tap.title = '字幕が始まる瞬間に押します。長く押すと、離した位置が終わりになります。';
  parts.offset = make('input', { id: 'captionSyncOffset', type: 'range', min: '0', max: String(TL.REACTION_MAX), step: '0.01' }); parts.offset.setAttribute('aria-label', '反応遅れの補正');
  parts.offsetValue = make('output', { id: 'captionSyncOffsetValue' });
  const label = make('label', { className: 'caption-sync-offset', title: 'タップの時刻からこの秒数だけ引きます' }); label.append(make('span', { textContent: '反応遅れ' }), parts.offset, parts.offsetValue);
  parts.done = make('button', { id: 'captionSyncDone', type: 'button', className: 'small', textContent: '確定（Enter）' });
  parts.cancel = make('button', { id: 'captionSyncCancel', type: 'button', className: 'small', textContent: '破棄（Esc）' });
  panel.append(parts.next, parts.tap, label, parts.done, parts.cancel);
  panel.addEventListener('pointerdown', event => event.stopPropagation());
  $('captionPreviewFrame').appendChild(panel);
}

function init() {
  tr.syncOffset = loadOffset(); tr.syncing = false; build();
  $('captionSync').addEventListener('click', () => { if (session) stop(true); else start(); });
  $('captionSyncWords').addEventListener('click', () => { if (session) stop(true); else startWords(); });
  parts.tap.addEventListener('pointerdown', event => { if (event.button) return; event.preventDefault(); tapDown(); });
  for (const name of ['pointerup', 'pointercancel']) parts.tap.addEventListener(name, tapUp);
  parts.offset.addEventListener('input', () => { tr.syncOffset = TL.clampReaction(parts.offset.value); parts.offsetValue.textContent = `${tr.syncOffset.toFixed(2)}s`; paint(); });
  parts.offset.addEventListener('change', saveOffset);
  parts.done.addEventListener('click', () => stop(true)); parts.cancel.addEventListener('click', () => stop(false));
  document.addEventListener('keyup', event => { if (session && event.code === 'Space') { event.preventDefault(); tapUp(); } }, true);
  window.addEventListener('blur', tapUp);
  on('time', time => {
    if (!session) return;
    if (session.kind === 'words' && time < session.lastTime - .3 && session.taps.length) { session.taps = []; session.holding = null; renderPanel(); }   // the loop wrapped: a fresh pass
    session.lastTime = time; paint(); if (session.region && !session.video.paused && time >= session.region.end) session.video.pause(); });
  on('project', () => {
    if (session && session.kind === 'words') { const segment = ui.store.project.segments.find(item => item.id === session.segmentId); if (!segment || segment.tokenIds.join() !== session.tokenKey) end(); return; }
    if (session && !session.items.every(item => session.byId.has(item.id) && ui.store.project.segments.some(segment => segment.id === item.id))) end(); });
}
Object.assign(W, { syncActive: active, syncKey, syncStart: start, syncWordsStart: startWords, syncStop: stop, syncTapDown: tapDown, syncTapUp: tapUp });
W.inits.push(init);
})();
