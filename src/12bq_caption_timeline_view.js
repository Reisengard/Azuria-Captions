/* ============================================================
   JIZURA — Video Captions workbench: caption list and timeline
   (T1: timeline blocks are kept and updated in place; positions are pixels per second)
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb, TL = J.captionTimeline;
const { ui, $, fmt, status, commandError, segmentTrackId, activeTrack, trackName, segmentText, tokenMap, sourceVideo, escapeHtml, runCommand, accessibilityWarnings, selectSegment, on, emit } = W;
const blocks = new Map(), rows = new Map(), labels = new Map(), headParts = new Map();
let expectedScroll = null, scrubbing = false, wordsFrame = 0;

const scrollEl = () => $('captionTimelineScroll');
const viewportWidth = () => scrollEl().clientWidth || 600;
function mediaDuration() { const project = ui.store.project; return Number(project.media.duration) || Math.max(1, ...project.transcript.tokens.map(token => token.end)); }
/* Scrolls from code are remembered so the scroll handler can tell them from the user's (a manual scroll stops following the playhead). */
function setScroll(value) {
  const el = scrollEl(), target = TL.clampScroll(value, mediaDuration(), ui.timeline.pps, viewportWidth());
  if (Math.abs(el.scrollLeft - target) >= 1) { expectedScroll = target; el.scrollLeft = target; }
}
/* Zoom about a pixel inside the viewport; the time under it stays put. */
function zoomTimeline(factor, anchorX) {
  const duration = mediaDuration(), width = viewportWidth();
  const next = TL.zoomAround({ pps: ui.timeline.pps, scrollLeft: scrollEl().scrollLeft }, factor, anchorX === undefined ? width / 2 : anchorX, duration, width);
  ui.timeline.fit = next.pps <= TL.fitPps(duration, width) + 1e-9; ui.timeline.pps = next.pps; renderTimeline(); setScroll(next.scrollLeft);
}
function fitTimeline() { ui.timeline.fit = true; renderTimeline(); setScroll(0); }
function timelineFollow(on) { ui.timeline.follow = !!on; }
function revealTime(time) {
  const el = scrollEl(), x = TL.timeToX(time, ui.timeline.pps);
  if (x < el.scrollLeft || x > el.scrollLeft + viewportWidth()) setScroll(x - viewportWidth() * .3);
}

function drawRuler() {
  const canvas = $('captionRuler'), ctx = canvas.getContext && canvas.getContext('2d'); if (!ctx) return;
  const width = viewportWidth(), dpr = window.devicePixelRatio || 1, height = 22;
  if (canvas.width !== Math.round(width * dpr)) { canvas.width = Math.round(width * dpr); canvas.height = height * dpr; canvas.style.width = `${width}px`; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, height);
  const css = getComputedStyle(document.documentElement), faint = css.getPropertyValue('--faint').trim() || '#777', muted = css.getPropertyValue('--muted').trim() || '#aaa';
  const duration = mediaDuration(), pps = ui.timeline.pps, left = scrollEl().scrollLeft, range = TL.visibleRange(left, width, pps, duration, 40);
  ctx.font = '9px monospace'; ctx.textBaseline = 'top';
  for (const tick of TL.rulerTicks(pps, range.from, range.to, duration)) {
    const x = Math.round(tick.time * pps - left) + .5;
    ctx.fillStyle = tick.major ? muted : faint; ctx.fillRect(x, tick.major ? 10 : 16, 1, tick.major ? 12 : 6);
    if (tick.label) { ctx.fillStyle = muted; ctx.fillText(tick.label, x + 3, 2); }
  }
}

/* One row and one header per track, reused between renders. */
function syncRows(project) {
  const track = $('captionSegmentTrack'), heads = $('captionTrackLabels'), current = activeTrack(), seen = new Set();
  (project.tracks || []).forEach((item, index) => {
    seen.add(item.id);
    let row = rows.get(item.id), label = labels.get(item.id);
    if (!row) { row = document.createElement('div'); row.className = 'caption-track-row'; row.dataset.trackId = item.id; rows.set(item.id, row); }
    if (!label) label = buildHead(item.id);
    if (track.children[index] !== row) track.insertBefore(row, track.children[index] || null);
    if (heads.children[index] !== label) heads.insertBefore(label, heads.children[index] || null);
    const name = item.name || item.id, { name: button, grip } = headParts.get(item.id);
    if (button.textContent !== name) { button.textContent = name; label.title = name; }
    grip.hidden = !!item.primary;
    button.setAttribute('aria-pressed', String(!!current && item.id === current.id));
  });
  for (const [id, row] of rows) if (!seen.has(id)) { row.remove(); rows.delete(id); }
  for (const [id, label] of labels) if (!seen.has(id)) { label.remove(); labels.delete(id); headParts.delete(id); }
  const add = $('captionTrackAddInline'); if (add) add.hidden = (project.tracks || []).length >= J.CAPTION_MAX_TRACKS;
}

/* ---- Track headers (T4): grip = drag to reorder, double-click the name = rename, ⋯ = menu ---- */
function buildHead(id) {
  const head = document.createElement('div'); head.className = 'caption-track-head'; head.dataset.trackHead = id;
  const grip = document.createElement('span'); grip.className = 'caption-track-grip'; grip.dataset.trackGrip = id; grip.textContent = '⠿'; grip.title = 'ドラッグで重なり順を変更'; grip.setAttribute('aria-hidden', 'true');
  const name = document.createElement('button'); name.type = 'button'; name.className = 'caption-track-name'; name.dataset.trackSelect = id;
  const more = document.createElement('button'); more.type = 'button'; more.className = 'caption-track-more'; more.dataset.trackMenu = id; more.textContent = '⋯'; more.setAttribute('aria-haspopup', 'menu'); more.setAttribute('aria-label', 'トラックのメニュー');
  head.append(grip, name, more); labels.set(id, head); headParts.set(id, { grip, name, more }); return head;
}
function renameInline(trackId) {
  const head = labels.get(trackId), track = J.captionTrack(ui.store.project, trackId); if (!head || !track || head.dataset.renaming) return;
  const button = headParts.get(trackId).name, input = document.createElement('input'); input.className = 'caption-track-rename'; input.value = track.name || ''; input.maxLength = 40; input.setAttribute('aria-label', 'トラック名');
  let done = false;
  const close = commit => { if (done) return; done = true; const value = input.value.trim(); input.remove(); button.hidden = false; delete head.dataset.renaming; if (commit && value && value !== (track.name || '')) W.renameTrack(trackId, value); };
  input.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Enter') { event.preventDefault(); close(true); } else if (event.key === 'Escape') { event.preventDefault(); close(false); } });
  input.addEventListener('blur', () => close(true));
  head.dataset.renaming = '1'; button.hidden = true; head.insertBefore(input, button); input.focus(); input.select();
}
/* Small menu anchored under a button: arrows move, Enter runs, Esc / outside click closes and returns focus. */
let openMenuEl = null;
function closeMenu(restore) {
  if (!openMenuEl) return; const { menu, anchor } = openMenuEl; openMenuEl = null; menu.remove();
  document.removeEventListener('pointerdown', onMenuOutside, true); if (restore && anchor.isConnected) anchor.focus();
}
function onMenuOutside(event) { if (openMenuEl && !openMenuEl.menu.contains(event.target)) closeMenu(false); }
function openMenu(anchor, items) {
  closeMenu(false);
  const menu = document.createElement('div'); menu.className = 'caption-menu'; menu.setAttribute('role', 'menu');
  for (const item of items) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'caption-menu-item'; button.setAttribute('role', 'menuitem'); button.textContent = item.label; button.disabled = !!item.disabled;
    button.addEventListener('click', () => { closeMenu(true); item.run(); }); menu.appendChild(button);
  }
  menu.addEventListener('keydown', event => {
    const list = [...menu.querySelectorAll('button:not(:disabled)')], at = list.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeMenu(true); }
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); event.stopPropagation(); if (list.length) list[(at + (event.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus(); }
    else if (event.key === 'Tab') closeMenu(false);
  });
  document.body.appendChild(menu); openMenuEl = { menu, anchor };
  const rect = anchor.getBoundingClientRect(), box = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(4, Math.min(rect.left, window.innerWidth - box.width - 4))}px`;
  menu.style.top = `${rect.bottom + box.height + 4 > window.innerHeight ? Math.max(4, rect.top - box.height - 4) : rect.bottom + 4}px`;
  document.addEventListener('pointerdown', onMenuOutside, true);
  const first = menu.querySelector('button:not(:disabled)'); if (first) first.focus();
}
function openTrackMenu(trackId) {
  const project = ui.store.project, tracks = project.tracks || [], track = J.captionTrack(project, trackId), anchor = headParts.has(trackId) ? headParts.get(trackId).more : null; if (!track || !anchor) return;
  const index = tracks.indexOf(track), primary = !!track.primary;
  openMenu(anchor, [
    { label: '名前を変更', run: () => renameInline(trackId) },
    { label: '上へ（下に重なる）', disabled: primary || index <= 1, run: () => W.reorderTrack(-1, trackId) },
    { label: '下へ（上に重なる）', disabled: primary || index >= tracks.length - 1, run: () => W.reorderTrack(1, trackId) },
    { label: 'エフェクトをランダムに決める', run: () => W.rerollTrack(trackId) },
    { label: 'トラックを削除', disabled: primary, run: () => W.deleteTrack(trackId) }
  ]);
}
/* Dragging the grip reorders: a line shows where the track will land; one reorder-track command on release, Esc cancels. */
let headDrag = null;
function startHeadDrag(event) {
  const grip = event.target.closest('[data-track-grip]'); if (!grip || event.button !== 0 || ui.drag || ui.boundaryDrag) return;
  event.preventDefault(); const id = grip.dataset.trackGrip, line = document.createElement('div'); line.className = 'caption-track-drop'; line.hidden = true; $('captionTrackLabels').appendChild(line);
  headDrag = { id, pointerId: event.pointerId, y: event.clientY, started: false, line, to: null }; labels.get(id).classList.add('is-grabbed');
}
function moveHeadDrag(event) {
  const drag = headDrag; if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.started && Math.abs(event.clientY - drag.y) < DRAG_THRESHOLD) return; drag.started = true;
  const tracks = ui.store.project.tracks || [], centers = tracks.map(item => { const rect = labels.get(item.id).getBoundingClientRect(); return rect.top + rect.height / 2; });
  drag.to = TL.reorderIndex(centers, event.clientY); const target = labels.get(tracks[drag.to].id), host = $('captionTrackLabels').getBoundingClientRect(), rect = target.getBoundingClientRect(), from = tracks.findIndex(item => item.id === drag.id);
  drag.line.hidden = drag.to === from; drag.line.style.top = `${(drag.to > from ? rect.bottom : rect.top) - host.top - 1}px`;
}
function endHeadDrag(commit) {
  const drag = headDrag; if (!drag) return; headDrag = null; drag.line.remove(); const head = labels.get(drag.id); if (head) head.classList.remove('is-grabbed');
  if (!commit || !drag.started || drag.to === null) return;
  const from = (ui.store.project.tracks || []).findIndex(item => item.id === drag.id); if (from >= 0 && drag.to !== from) W.reorderTrack(drag.to - from, drag.id);
}
/* Alt+↑ / Alt+↓: the selected caption moves to the track above / below, keeping its time. */
function moveSelectedTrack(direction) {
  const segment = W.selectedSegment(); if (!segment) { status('字幕を選んでください。', true); return true; }
  const target = TL.adjacentTrackId(ui.store.project.tracks || [], segmentTrackId(segment), direction);
  if (!target) { status(direction < 0 ? 'これより上のトラックはありません。' : 'これより下のトラックはありません。', true); return true; }
  runCommand({ type: 'move-segment', segmentId: segment.id, start: segment.start, trackId: target }, segment.id); if (ui.preview) ui.preview.renderNow();
  return true;
}

function buildBlock(id) {
  const block = document.createElement('div'); block.className = 'caption-timeline-segment'; block.setAttribute('role', 'button'); block.tabIndex = 0; block.dataset.segmentId = id;
  const text = document.createElement('span'), words = document.createElement('span'); text.className = 'caption-block-text'; words.className = 'caption-block-words';
  const lock = document.createElement('span'); lock.className = 'caption-lock-badge'; lock.textContent = '🔒'; lock.hidden = true; lock.setAttribute('aria-hidden', 'true');
  block.append(words, text, lock);
  for (const edge of ['start', 'end']) { const grip = document.createElement('span'); grip.className = `caption-trim-handle is-${edge}`; grip.dataset.trim = edge; block.appendChild(grip); }
  const entry = { block, text, words, lock, handle: null, sig: '', label: '' }; blocks.set(id, entry); return entry;
}

/* Words are ticks inside their block, drawn only when zoomed in and the block is near the viewport; rebuilt only when their signature changes. */
function syncBlockWords(entry, segment, tokens, range, pps) {
  const show = TL.wordTicksVisible(pps) && TL.overlapsRange(segment, range);
  const sig = show ? `${pps}|${segment.start}|` + segment.tokenIds.map(id => { const token = tokens.get(id); return token ? `${id}:${token.start}:${token.text}` : id; }).join(',') : '';
  if (sig === entry.sig) return; entry.sig = sig;
  const marks = [];
  if (show) for (const id of segment.tokenIds) {
    const token = tokens.get(id), x = token ? (token.start - segment.start) * pps - 1 : -1; if (!token || x < 2) continue;
    const mark = document.createElement('span'); mark.className = 'caption-word-mark'; mark.dataset.wordId = id; mark.style.left = `${x}px`; mark.title = `${token.text} ${fmt(token.start)}–${fmt(token.end)}`;
    const label = document.createElement('span'); label.textContent = token.text; mark.appendChild(label); marks.push(mark);
  }
  entry.words.replaceChildren(...marks);
}

function renderTimeline() {
  const project = ui.store.project, duration = mediaDuration(), width = viewportWidth(), state = ui.timeline;
  state.pps = state.fit || !state.pps ? TL.fitPps(duration, width) : TL.clampPps(state.pps, duration, width);
  const pps = state.pps, tokens = tokenMap(), range = TL.visibleRange(scrollEl().scrollLeft, width, pps, duration, 300), seen = new Set();
  $('captionTimelineContent').style.width = `${Math.max(width, TL.contentWidth(duration, pps))}px`;
  $('captionTimeline').dataset.wordLabels = String(TL.wordLabelsVisible(pps));
  syncRows(project);
  const firstRow = rows.values().next().value;
  for (const segment of project.segments) {
    seen.add(segment.id);
    const entry = blocks.get(segment.id) || buildBlock(segment.id), { block } = entry, text = segmentText(segment), rect = TL.blockRect(segment, pps), row = rows.get(segmentTrackId(segment)) || firstRow;
    if (entry.label !== text) { entry.label = text; entry.text.textContent = text; }
    block.title = `${fmt(segment.start)}–${fmt(segment.end)} ${text}`;
    block.setAttribute('aria-label', `${text}, ${fmt(segment.start)}–${fmt(segment.end)}, ${trackName(segmentTrackId(segment))}`);
    const locked = segmentTimingLocked(segment); entry.lock.hidden = !locked; block.classList.toggle('is-locked', locked);
    block.style.left = `${rect.left}px`; block.style.width = `${rect.width}px`;
    block.classList.toggle('selected', segment.id === ui.selectedId); block.classList.toggle('is-now', ui.currentIds.has(segment.id));
    if (row && block.parentNode !== row) row.appendChild(block);
    const next = J.captionTrackNeighbor(project, segment, 1), rollable = !!next && next.start - segment.end < .02 && !(segment.locks && segment.locks.segmentation);   // only the seam of two touching captions rolls; any other end edge trims
    if (rollable && !entry.handle) { const handle = document.createElement('span'); handle.className = 'caption-boundary-handle'; handle.dataset.boundarySegment = segment.id; handle.setAttribute('role', 'slider'); handle.tabIndex = 0; block.appendChild(handle); entry.handle = handle; }
    else if (!rollable && entry.handle) { entry.handle.remove(); entry.handle = null; }
    if (entry.handle) entry.handle.setAttribute('aria-label', `${text} の終了境界`);
    syncBlockWords(entry, segment, tokens, range, pps);
  }
  for (const [id, entry] of blocks) if (!seen.has(id)) { entry.block.remove(); blocks.delete(id); }
  // Trimmed-away parts of the source are striped in the VIDEO row (caption times stay source times).
  const kept = J.videoClips(project, duration), cuts = [];
  kept.forEach((clip, i) => { const from = i ? kept[i - 1].end : 0; if (clip.start - from > .001) cuts.push([from, clip.start]); });
  if (kept.length && duration - kept[kept.length - 1].end > .001) cuts.push([kept[kept.length - 1].end, duration]);
  $('captionVideoTrack').replaceChildren(...cuts.map(([from, to]) => { const cut = document.createElement('span'); cut.className = 'caption-video-cut'; cut.style.left = `${from * pps}px`; cut.style.width = `${(to - from) * pps}px`; cut.title = `${fmt(from)}–${fmt(to)}`; return cut; }));
  drawRuler(); placeLoop(); placePlayhead(sourceVideo() ? sourceVideo().currentTime : 0);
}
/* Scrolling only changes which blocks are near the viewport: word ticks are (re)built for those. */
function updateWords() {
  wordsFrame = 0; if (!ui.store) return;
  const project = ui.store.project, tokens = tokenMap(), range = TL.visibleRange(scrollEl().scrollLeft, viewportWidth(), ui.timeline.pps, mediaDuration(), 300);
  for (const segment of project.segments) { const entry = blocks.get(segment.id); if (entry) syncBlockWords(entry, segment, tokens, range, ui.timeline.pps); }
}

function renderList() {
  const list = $('captionSegmentList'), project = ui.store.project, tracks = project.tracks || [];
  list.replaceChildren();
  project.segments.forEach(segment => {
    const text = segmentText(segment), item = document.createElement('li'), button = document.createElement('button');
    button.type = 'button'; button.className = 'caption-segment'; button.dataset.segmentId = segment.id; button.classList.toggle('is-now', ui.currentIds.has(segment.id));
    button.setAttribute('aria-selected', String(segment.id === ui.selectedId));
    const warning = accessibilityWarnings(segment).length ? '<span class="caption-segment-warning" aria-label="アクセシビリティ警告">⚠</span>' : '';
    const tag = tracks.length > 1 ? `<span class="caption-segment-track-tag">${escapeHtml(trackName(segmentTrackId(segment)))}</span>` : '';
    button.innerHTML = `<span class="caption-segment-time">${fmt(segment.start)}</span><span>${tag}${escapeHtml(text)} ${warning}</span>`;
    item.appendChild(button); list.appendChild(item);
  });
  $('captionTranscriptEmpty').hidden = project.segments.length > 0;
  const quality = project.transcript.timingQuality || 'word';
  $('captionTimingBadge').title = quality === 'estimated' ? 'SRT/VTT and manually entered captions use estimated word timings. Captions are ready to preview.' : '';
  $('captionTimingBadge').textContent = project.transcript.tokens.length ? (quality === 'estimated' ? '推定タイミング' : '単語タイミング') : '未読込';
}
function renderSegments() { renderList(); renderTimeline(); }

/* The marked / looping range: a band over the rows, brighter while looping. */
function placeLoop() {
  const band = $('captionLoopRegion'), region = ui.transport.marked || (ui.transport.loopOn ? ui.transport.region : null);
  band.hidden = !region; if (!region) return;
  band.style.left = `${TL.timeToX(region.start, ui.timeline.pps)}px`; band.style.width = `${Math.max(2, (region.end - region.start) * ui.timeline.pps)}px`;
  band.classList.toggle('is-looping', ui.transport.loopOn);
}
function placePlayhead(time) { $('captionPlayhead').style.transform = `translateX(${TL.timeToX(time, ui.timeline.pps)}px)`; }
function updatePlayhead(time) {
  const video = sourceVideo(), duration = video ? Number(video.duration) || 0 : Number(ui.store.project.media.duration) || 0;
  $('captionTime').textContent = fmt(time); $('captionDuration').textContent = fmt(duration);
  $('captionScrub').value = duration ? Math.round(time / duration * 1000) : 0;
  placePlayhead(time);
  if (ui.timeline.follow && video && !video.paused) {
    const el = scrollEl(), next = TL.followScroll(el.scrollLeft, viewportWidth(), TL.timeToX(time, ui.timeline.pps), mediaDuration(), ui.timeline.pps);
    if (next !== el.scrollLeft) setScroll(next);
  }
  markNow(time); emit('time', time);
}

function seekTimeline(time) {
  const duration = Number(ui.store.project.media.duration) || 0, target = Math.max(0, Math.min(duration, time));
  if (sourceVideo()) { sourceVideo().currentTime = target; if (ui.preview) ui.preview.renderNow(target); } else updatePlayhead(target);
  revealTime(target);
}

function timelineTimeAt(clientX) {
  const el = scrollEl(), rect = el.getBoundingClientRect();
  return TL.xToTime(clientX - rect.left + el.scrollLeft, ui.timeline.pps, Number(ui.store.project.media.duration) || 0);
}

/* ---- Moving and trimming by drag (T3). A ghost shows where the caption would land; only a valid drop sends a command. ---- */
const DRAG_THRESHOLD = 4;
const lockedFields = segment => segment.locks && Array.isArray(segment.locks.fields) ? segment.locks.fields : [];
const segmentTimingLocked = segment => ['timing', 'start', 'end'].some(field => lockedFields(segment).includes(field));
const DRAG_MESSAGES = { TRACK_SEGMENT_OVERLAP: '他の字幕と重なります。', SEGMENT_TIMING_INVALID: '短すぎるか、動画の外です。', SEGMENT_WORDS_OUTSIDE: '単語の範囲より狭くできません。', SEGMENT_FIELD_LOCKED: 'この字幕はロック中です。' };

function dragLayout() {
  const project = ui.store.project, tokens = tokenMap();
  return { duration: mediaDuration(), segments: project.segments.map(segment => {
    const first = tokens.get(segment.tokenIds[0]), last = tokens.get(segment.tokenIds[segment.tokenIds.length - 1]);
    return { id: segment.id, start: segment.start, end: segment.end, trackId: segmentTrackId(segment), firstWord: first ? first.start : NaN, lastWord: last ? last.end : NaN,
      block: !!J.isCaptionTextBlock(project, segment), locked: segmentTimingLocked(segment), trackLocked: lockedFields(segment).includes('trackAssignment') };
  }) };
}
/* Snap targets are collected once, when the drag starts (the preview moves the playhead while dragging). */
function dragTargets(layout, segmentId) {
  const project = ui.store.project, video = sourceVideo(), tokens = tokenMap(), me = layout.segments.find(item => item.id === segmentId), { before, after } = TL.trackNeighbors(layout, me);
  const cuts = []; for (const clip of J.videoClips(project, layout.duration)) cuts.push(clip.start, clip.end);
  const wordTimes = [];
  for (const near of [before, after]) if (near) { const segment = project.segments.find(item => item.id === near.id); for (const id of segment.tokenIds) { const token = tokens.get(id); if (token) wordTimes.push(token.start, token.end); } }
  return TL.snapTargets({ duration: layout.duration, playhead: video ? video.currentTime : undefined, loop: ui.transport.marked || (ui.transport.loopOn ? ui.transport.region : null), cuts, segments: layout.segments, excludeId: segmentId, wordTimes });
}
function rowIdAt(clientY) {
  let best = null, distance = Infinity;
  for (const [id, row] of rows) { const rect = row.getBoundingClientRect(), d = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0; if (d < distance) { distance = d; best = id; } }
  return best;
}
function startSegmentDrag(event) {
  if (event.button !== 0 || ui.drag || ui.boundaryDrag) return;
  const block = event.target.closest('.caption-timeline-segment'); if (!block || event.target.closest('[data-boundary-segment]')) return;
  const segment = ui.store.project.segments.find(item => item.id === block.dataset.segmentId); if (!segment) return;
  if (segmentTimingLocked(segment)) { status(commandError({ code: 'SEGMENT_FIELD_LOCKED' }), true); return; }
  const grip = event.target.closest('[data-trim]'), mode = grip ? `trim-${grip.dataset.trim}` : 'move', edge = mode === 'trim-end' ? segment.end : segment.start;
  ui.drag = { mode, segmentId: segment.id, block, pointerId: event.pointerId, x: event.clientX, y: event.clientY, grab: timelineTimeAt(event.clientX) - edge, started: false, result: null, frame: 0 };
}
function beginDrag(drag) {
  const video = sourceVideo(); drag.started = true; drag.originTime = video ? video.currentTime : 0; drag.layout = dragLayout(); drag.targets = dragTargets(drag.layout, drag.segmentId);
  if (video && !video.paused) video.pause();
  try { drag.block.setPointerCapture(drag.pointerId); } catch (error) { /* synthetic pointers cannot be captured */ }
  drag.block.classList.add('is-dragging'); document.body.classList.add('is-caption-dragging');
  drag.ghost = document.createElement('div'); drag.ghost.className = 'caption-drag-ghost'; drag.ghost.setAttribute('aria-hidden', 'true');
  drag.line = document.createElement('div'); drag.line.className = 'caption-drag-snap'; drag.line.hidden = true; drag.line.setAttribute('aria-hidden', 'true');
  drag.readout = document.createElement('div'); drag.readout.className = 'caption-drag-readout'; drag.readout.setAttribute('aria-hidden', 'true');
  $('captionTimelineContent').append(drag.line, drag.readout);
  if (ui.selectedId !== drag.segmentId) selectSegment(drag.segmentId);
}
function showDrag(drag, result) {
  const pps = ui.timeline.pps, row = rows.get(result.trackId);
  if (row && drag.ghost.parentNode !== row) row.appendChild(drag.ghost);
  drag.ghost.style.left = `${result.start * pps}px`; drag.ghost.style.width = `${Math.max(2, (result.end - result.start) * pps)}px`;
  drag.ghost.classList.toggle('is-invalid', !result.valid); drag.ghost.dataset.reason = result.valid ? '' : DRAG_MESSAGES[result.code] || commandError({ code: result.code });
  const edge = result.mode === 'trim-end' ? result.end : result.start;
  drag.line.hidden = !result.snappedTo; if (result.snappedTo) { drag.line.style.left = `${result.snappedTo.time * pps}px`; drag.line.dataset.kind = result.snappedTo.kind; }
  drag.readout.style.left = `${edge * pps}px`; drag.readout.textContent = result.mode === 'move' ? `${fmt(result.start)}–${fmt(result.end)}` : fmt(edge);
  drag.readout.classList.toggle('is-invalid', !result.valid);
}
/* The preview shows the frame at the dragged edge (once per animation frame). */
function previewDragTime(drag, time) {
  drag.previewTime = time; if (drag.frame) return;
  drag.frame = requestAnimationFrame(() => { drag.frame = 0; const video = sourceVideo(); if (!video || ui.drag !== drag) return; video.currentTime = drag.previewTime; if (ui.preview) ui.preview.renderNow(drag.previewTime); });
}
function moveSegmentDrag(event) {
  const drag = ui.drag; if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.started) { if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < DRAG_THRESHOLD) return; beginDrag(drag); }
  const segment = ui.store.project.segments.find(item => item.id === drag.segmentId);
  const result = TL.resolveDrag({ layout: drag.layout, segmentId: drag.segmentId, mode: drag.mode, time: timelineTimeAt(event.clientX), grab: drag.grab, trackId: drag.mode === 'move' ? rowIdAt(event.clientY) : segmentTrackId(segment),
    pps: ui.timeline.pps, snap: ui.transport.snap && !event.altKey, shift: event.shiftKey, targets: drag.targets });
  drag.result = result; showDrag(drag, result);
  previewDragTime(drag, result.mode === 'trim-end' ? Math.max(result.start, result.end - .02) : result.start);
}
/* Takes the drag down (ghost kept for the caller to remove or flash); `restoreTime` puts the video back. */
function endSegmentDrag(restoreTime) {
  const drag = ui.drag; ui.drag = null; if (!drag) return null;
  if (drag.frame) cancelAnimationFrame(drag.frame);
  if (!drag.started) return drag;
  drag.block.classList.remove('is-dragging'); document.body.classList.remove('is-caption-dragging');
  drag.line.remove(); drag.readout.remove();
  try { drag.block.releasePointerCapture(drag.pointerId); } catch (error) { /* already released */ }
  if (restoreTime !== undefined && sourceVideo()) { sourceVideo().currentTime = restoreTime; if (ui.preview) ui.preview.renderNow(restoreTime); }
  return drag;
}
function finishSegmentDrag(event) {
  const drag = ui.drag; if (!drag || event.pointerId !== drag.pointerId) return;
  if (!drag.started) { ui.drag = null; return; }
  const result = drag.result, video = sourceVideo(), time = video ? video.currentTime : undefined;
  endSegmentDrag();
  if (!result || !result.changed) { drag.ghost.remove(); return; }
  if (!result.valid) {   // refused: the red ghost stays a moment and says why; the caption was never moved
    drag.ghost.classList.add('is-invalid'); setTimeout(() => drag.ghost.remove(), 900);
    status(DRAG_MESSAGES[result.code] || commandError({ code: result.code }), true); return;
  }
  drag.ghost.remove();
  const segment = ui.store.project.segments.find(item => item.id === drag.segmentId);
  const command = result.mode === 'move' ? { type: 'move-segment', segmentId: drag.segmentId, start: result.start }
    : result.mode === 'trim-start' ? { type: 'trim-segment', segmentId: drag.segmentId, start: result.start, words: result.words }
    : { type: 'trim-segment', segmentId: drag.segmentId, end: result.end, words: result.words };
  if (result.mode === 'move' && result.trackId !== segmentTrackId(segment)) command.trackId = result.trackId;
  runCommand(command, drag.segmentId); if (ui.preview) ui.preview.renderNow(time);
}
/* Esc or pointercancel: everything back as it was, no command. */
function cancelSegmentDrag() {
  const drag = ui.drag; if (!drag) return false;
  endSegmentDrag(drag.started ? drag.originTime : undefined);
  if (drag.started) { drag.ghost.remove(); status('ドラッグを取り消しました。'); }
  return true;
}
const dragging = () => !!(ui.drag && ui.drag.started);
/* `,` / `.`: nudge the selected caption; it stops at its neighbours like a drag does. */
function nudgeSegment(direction) {
  const segment = W.selectedSegment(); if (!segment) { status('字幕を選んでください。', true); return true; }
  const result = TL.nudge(dragLayout(), segment.id, direction);
  if (!result.valid) { status(DRAG_MESSAGES[result.code] || commandError({ code: result.code }), true); return true; }
  if (!result.changed) { status('これ以上動かせません。', true); return true; }
  runCommand({ type: 'move-segment', segmentId: segment.id, start: result.start }, segment.id); if (ui.preview) ui.preview.renderNow();
  return true;
}

function startBoundaryDrag(event, segmentId) {
  const segment = ui.store.project.segments.find(item => item.id === segmentId), next = segment && J.captionTrackNeighbor(ui.store.project, segment, 1); if (!segment || !next) return;
  const tokens = tokenMap(), min = tokens.get(segment.tokenIds[segment.tokenIds.length - 1]).end, max = tokens.get(next.tokenIds[0]).start;
  ui.boundaryDrag = { segmentId, min, max, time: segment.end }; event.preventDefault(); event.target.setPointerCapture && event.target.setPointerCapture(event.pointerId);
}

function moveBoundary(event) {
  if (!ui.boundaryDrag) return; ui.boundaryDrag.time = Math.max(ui.boundaryDrag.min, Math.min(ui.boundaryDrag.max, timelineTimeAt(event.clientX)));
  const segment = ui.store.project.segments.find(item => item.id === ui.boundaryDrag.segmentId), next = J.captionTrackNeighbor(ui.store.project, segment, 1), pps = ui.timeline.pps;
  const left = blocks.get(segment.id), right = blocks.get(next.id);
  if (left && right) { left.block.style.width = `${Math.max(2, (ui.boundaryDrag.time - segment.start) * pps)}px`; right.block.style.left = `${ui.boundaryDrag.time * pps}px`; right.block.style.width = `${Math.max(2, (next.end - ui.boundaryDrag.time) * pps)}px`; }
  status(`境界 ${fmt(ui.boundaryDrag.time)}（${fmt(ui.boundaryDrag.min)}〜${fmt(ui.boundaryDrag.max)}）`);
}

function finishBoundary() {
  if (!ui.boundaryDrag) return; const drag = ui.boundaryDrag; ui.boundaryDrag = null;
  runCommand({ type: 'set-segment-boundary', segmentId: drag.segmentId, time: +drag.time.toFixed(6) }, drag.segmentId); if (ui.preview) ui.preview.renderNow();
}

/* The captions on screen at this time get a "now showing" mark. The selection is not touched. */
function markNow(time) {
  const ids = new Set(J.captionSegmentsAt(ui.store.project, time).map(segment => segment.id));
  if (ids.size === ui.currentIds.size && [...ids].every(id => ui.currentIds.has(id))) return;
  ui.currentIds = ids;
  for (const host of [$('captionSegmentList'), $('captionSegmentTrack')]) host.querySelectorAll('[data-segment-id]').forEach(node => node.classList.toggle('is-now', ids.has(node.dataset.segmentId)));
}

/* A selection change only moves the marks; the strip is not rebuilt. */
function markSelection() {
  const id = ui.selectedId, current = activeTrack();
  $('captionSegmentList').querySelectorAll('[data-segment-id]').forEach(node => node.setAttribute('aria-selected', String(node.dataset.segmentId === id)));
  $('captionSegmentTrack').querySelectorAll('[data-segment-id]').forEach(node => node.classList.toggle('selected', node.dataset.segmentId === id));
  $('captionTrackLabels').querySelectorAll('[data-track-select]').forEach(node => node.setAttribute('aria-pressed', String(!!current && node.dataset.trackSelect === current.id)));
}

function init() {
  const scroll = scrollEl(), ruler = $('captionRuler');
  $('captionSegmentList').addEventListener('click', event => { const target = event.target.closest('[data-segment-id]'); if (target) selectSegment(target.dataset.segmentId); });
  const heads = $('captionTrackLabels');
  heads.addEventListener('click', event => { const more = event.target.closest('[data-track-menu]'); if (more) openTrackMenu(more.dataset.trackMenu); });
  heads.addEventListener('dblclick', event => { const name = event.target.closest('[data-track-select]'); if (name) renameInline(name.dataset.trackSelect); });
  heads.addEventListener('pointerdown', startHeadDrag);
  $('captionTrackAddInline').addEventListener('click', () => W.addTrack());
  $('captionSegmentTrack').addEventListener('click', event => {
    const word = event.target.closest('[data-word-id]'), target = event.target.closest('[data-segment-id]');
    if (target) selectSegment(target.dataset.segmentId);
    if (word) { const token = tokenMap().get(word.dataset.wordId); if (token) { seekTimeline(token.start); status(`${token.text}: ${fmt(token.start)}–${fmt(token.end)}`); } }
  });
  $('captionSegmentTrack').addEventListener('keydown', event => {
    const handle = event.target.closest('[data-boundary-segment]');
    if (handle && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); const segment = ui.store.project.segments.find(item => item.id === handle.dataset.boundarySegment), next = J.captionTrackNeighbor(ui.store.project, segment, 1), tokens = tokenMap();
      const min = tokens.get(segment.tokenIds[segment.tokenIds.length - 1]).end, max = tokens.get(next.tokenIds[0]).start, step = event.shiftKey ? .1 : .01, time = Math.max(min, Math.min(max, segment.end + (event.key === 'ArrowRight' ? step : -step)));
      runCommand({ type: 'set-segment-boundary', segmentId: segment.id, time: +time.toFixed(6) }, segment.id); return; }
    const target = event.target.closest('[data-segment-id]'); if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectSegment(target.dataset.segmentId); }
  });
  // Empty space in the rows or the video row moves the playhead; the ruler scrubs while dragging.
  scroll.addEventListener('click', event => { if (event.target.closest('[data-segment-id],.caption-boundary-handle,#captionRuler')) return; seekTimeline(timelineTimeAt(event.clientX)); });
  // Alt+drag, or a drag in the upper half of the ruler, marks the loop region; a plain click there still moves the playhead.
  let marking = null;
  ruler.addEventListener('pointerdown', event => {
    event.preventDefault(); ruler.setPointerCapture && ruler.setPointerCapture(event.pointerId);
    const upper = event.clientY - ruler.getBoundingClientRect().top < ruler.getBoundingClientRect().height / 2;
    if (event.altKey || upper) { marking = { from: timelineTimeAt(event.clientX), x: event.clientX, moved: false }; return; }
    scrubbing = true; seekTimeline(timelineTimeAt(event.clientX));
  });
  ruler.addEventListener('pointermove', event => {
    if (marking) { if (!marking.moved && Math.abs(event.clientX - marking.x) < 4) return; marking.moved = true; W.setMarked(TL.markRegion(marking.from, timelineTimeAt(event.clientX), mediaDuration())); return; }
    if (scrubbing) seekTimeline(timelineTimeAt(event.clientX));
  });
  ruler.addEventListener('pointerup', event => { if (marking && !marking.moved) { if (ui.transport.marked) W.setMarked(null); seekTimeline(timelineTimeAt(event.clientX)); } marking = null; scrubbing = false; });
  ruler.addEventListener('pointercancel', () => { marking = null; scrubbing = false; });
  $('captionSegmentTrack').addEventListener('pointerdown', event => { const handle = event.target.closest('[data-boundary-segment]'); if (handle) startBoundaryDrag(event, handle.dataset.boundarySegment); else startSegmentDrag(event); });
  window.addEventListener('pointermove', event => { moveBoundary(event); moveSegmentDrag(event); moveHeadDrag(event); });
  window.addEventListener('pointerup', event => { finishBoundary(); finishSegmentDrag(event); endHeadDrag(true); });
  window.addEventListener('pointercancel', () => { cancelSegmentDrag(); endHeadDrag(false); });
  // Esc cancels a drag before any other Esc handler (stop loop, deselect) sees it.
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && headDrag) { endHeadDrag(false); event.preventDefault(); event.stopImmediatePropagation(); return; } if (event.key === 'Escape' && ui.drag && cancelSegmentDrag()) { event.preventDefault(); event.stopImmediatePropagation(); } }, true);
  scroll.addEventListener('wheel', event => {
    if (event.ctrlKey || event.metaKey) { event.preventDefault(); ui.timeline.follow = false; zoomTimeline(Math.exp(-event.deltaY * .0025), event.clientX - scroll.getBoundingClientRect().left); return; }
    if (scroll.scrollWidth <= scroll.clientWidth + 1) return;
    event.preventDefault(); scroll.scrollLeft += (Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY) * (event.deltaMode === 1 ? 16 : 1);
  }, { passive: false });
  scroll.addEventListener('scroll', () => {
    if (expectedScroll !== null && Math.abs(scroll.scrollLeft - expectedScroll) < 1) expectedScroll = null; else { expectedScroll = null; ui.timeline.follow = false; }
    ui.timeline.scrollLeft = scroll.scrollLeft; drawRuler(); if (!wordsFrame) wordsFrame = requestAnimationFrame(updateWords);
  });
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (ui.store) renderTimeline(); }).observe(scroll);
  $('captionTimelineIn').addEventListener('click', () => { ui.timeline.follow = false; zoomTimeline(2); });
  $('captionTimelineOut').addEventListener('click', () => { ui.timeline.follow = false; zoomTimeline(.5); });
  $('captionTimelineFit').addEventListener('click', fitTimeline);
  for (const id of ['captionSegmentList', 'captionSegmentTrack']) $(id).addEventListener('dblclick', event => { const target = event.target.closest('[data-segment-id]'); if (target) selectSegment(target.dataset.segmentId, true); });
  on('project', renderSegments); on('selection', markSelection);
}
Object.assign(W, { moveSelectedTrack, openTrackMenu, renameInline, cancelSegmentDrag, dragging, nudgeSegment, finishBoundary, fitTimeline, markNow, markSelection, moveBoundary, placeLoop, renderSegments, renderTimeline, revealTime, seekTimeline, startBoundaryDrag, timelineFollow, timelineTimeAt, updatePlayhead, zoomTimeline });
W.inits.push(init);
})();
