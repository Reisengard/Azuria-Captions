/* ============================================================
   JIZURA — Video Captions workbench: caption list and timeline
   (T1: timeline blocks are kept and updated in place; positions are pixels per second)
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb, TL = J.captionTimeline;
const { ui, $, fmt, status, segmentTrackId, activeTrack, trackName, segmentText, tokenMap, sourceVideo, escapeHtml, runCommand, accessibilityWarnings, selectSegment, on, emit } = W;
const blocks = new Map(), rows = new Map(), labels = new Map();
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
    if (!label) { label = document.createElement('button'); label.type = 'button'; label.className = 'caption-track-name'; label.dataset.trackSelect = item.id; labels.set(item.id, label); }
    if (track.children[index] !== row) track.insertBefore(row, track.children[index] || null);
    if (heads.children[index] !== label) heads.insertBefore(label, heads.children[index] || null);
    const name = item.name || item.id; if (label.textContent !== name) { label.textContent = name; label.title = name; }
    label.setAttribute('aria-pressed', String(!!current && item.id === current.id));
  });
  for (const [id, row] of rows) if (!seen.has(id)) { row.remove(); rows.delete(id); }
  for (const [id, label] of labels) if (!seen.has(id)) { label.remove(); labels.delete(id); }
}

function buildBlock(id) {
  const block = document.createElement('div'); block.className = 'caption-timeline-segment'; block.setAttribute('role', 'button'); block.tabIndex = 0; block.dataset.segmentId = id;
  const text = document.createElement('span'), words = document.createElement('span'); text.className = 'caption-block-text'; words.className = 'caption-block-words';
  block.append(words, text);
  const entry = { block, text, words, handle: null, sig: '', label: '' }; blocks.set(id, entry); return entry;
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
    block.style.left = `${rect.left}px`; block.style.width = `${rect.width}px`;
    block.classList.toggle('selected', segment.id === ui.selectedId); block.classList.toggle('is-now', ui.currentIds.has(segment.id));
    if (row && block.parentNode !== row) row.appendChild(block);
    const rollable = !!J.captionTrackNeighbor(project, segment, 1) && !(segment.locks && segment.locks.segmentation);
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
  drawRuler(); placePlayhead(sourceVideo() ? sourceVideo().currentTime : 0);
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
  ruler.addEventListener('pointerdown', event => { scrubbing = true; event.preventDefault(); ruler.setPointerCapture && ruler.setPointerCapture(event.pointerId); seekTimeline(timelineTimeAt(event.clientX)); });
  ruler.addEventListener('pointermove', event => { if (scrubbing) seekTimeline(timelineTimeAt(event.clientX)); });
  for (const name of ['pointerup', 'pointercancel']) ruler.addEventListener(name, () => { scrubbing = false; });
  $('captionSegmentTrack').addEventListener('pointerdown', event => { const handle = event.target.closest('[data-boundary-segment]'); if (handle) startBoundaryDrag(event, handle.dataset.boundarySegment); });
  window.addEventListener('pointermove', moveBoundary); window.addEventListener('pointerup', finishBoundary);
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
Object.assign(W, { finishBoundary, fitTimeline, markNow, markSelection, moveBoundary, renderSegments, renderTimeline, revealTime, seekTimeline, startBoundaryDrag, timelineFollow, timelineTimeAt, updatePlayhead, zoomTimeline });
W.inits.push(init);
})();
