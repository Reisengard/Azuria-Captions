/* ============================================================
   JIZURA — Video Captions workbench: caption list and timeline (parity with the old strip; rebuilt in T1)
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb;
const { ui, $, fmt, status, segmentTrackId, activeTrack, trackName, segmentText, tokenMap, sourceVideo, escapeHtml, runCommand, accessibilityWarnings, selectSegment, on, emit } = W;
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
    button.type = 'button'; button.className = 'caption-segment'; button.dataset.segmentId = segment.id; button.classList.toggle('is-now', ui.currentIds.has(segment.id));
    button.setAttribute('aria-selected', String(segment.id === ui.selectedId));
    const warning = accessibilityWarnings(segment).length ? '<span class="caption-segment-warning" aria-label="アクセシビリティ警告">⚠</span>' : '';
    const tag = tracks.length > 1 ? `<span class="caption-segment-track-tag">${escapeHtml(trackName(segmentTrackId(segment)))}</span>` : '';
    button.innerHTML = `<span class="caption-segment-time">${fmt(segment.start)}</span><span>${tag}${escapeHtml(text)} ${warning}</span>`;
    item.appendChild(button); list.appendChild(item);
    const block = document.createElement('div'); block.className = 'caption-timeline-segment' + (segment.id === ui.selectedId ? ' selected' : '') + (ui.currentIds.has(segment.id) ? ' is-now' : ''); block.setAttribute('role', 'button'); block.tabIndex = 0;
    block.dataset.segmentId = segment.id; block.textContent = text; block.title = `${fmt(segment.start)}–${fmt(segment.end)} ${text}`;
    block.style.left = `${segment.start / duration * 100}%`; block.style.width = `${Math.max(.25, (segment.end - segment.start) / duration * 100)}%`;
    if (J.captionTrackNeighbor(project, segment, 1) && !(segment.locks && segment.locks.segmentation)) { const handle = document.createElement('span'); handle.className = 'caption-boundary-handle'; handle.dataset.boundarySegment = segment.id; handle.setAttribute('role', 'slider'); handle.setAttribute('aria-label', `${text} の終了境界`); handle.tabIndex = 0; block.appendChild(handle); }
    (rows.get(segmentTrackId(segment)) || rows.values().next().value).appendChild(block);
  });
  for (const token of project.transcript.tokens) { const mark = document.createElement('button'); mark.type = 'button'; mark.className = 'caption-word-mark'; mark.dataset.wordId = token.id; mark.style.left = `${token.start / duration * 100}%`; mark.title = `${token.text} ${fmt(token.start)}–${fmt(token.end)}`; const label = document.createElement('span'); label.textContent = token.text; mark.appendChild(label); wordTrack.appendChild(mark); }
  // Trimmed-away parts of the source are striped in the VIDEO row (caption times stay source times).
  const kept = J.videoClips(project, duration), cuts = [];
  kept.forEach((clip, i) => { const from = i ? kept[i - 1].end : 0; if (clip.start - from > .001) cuts.push([from, clip.start]); });
  if (kept.length && duration - kept[kept.length - 1].end > .001) cuts.push([kept[kept.length - 1].end, duration]);
  $('captionVideoTrack').replaceChildren(...cuts.map(([from, to]) => { const cut = document.createElement('span'); cut.className = 'caption-video-cut'; cut.style.left = `${from / duration * 100}%`; cut.style.width = `${(to - from) / duration * 100}%`; cut.title = `${fmt(from)}–${fmt(to)}`; return cut; }));
  $('captionTimelineContent').style.width = `${ui.timelineZoom * 100}%`; $('captionTimeline').dataset.zoomed = String(ui.timelineZoom >= 2);
  $('captionTranscriptEmpty').hidden = project.segments.length > 0;
  const quality = project.transcript.timingQuality || 'word';
  $('captionTimingBadge').title = quality === 'estimated' ? 'SRT/VTT and manually entered captions use estimated word timings. Captions are ready to preview.' : '';
  $('captionTimingBadge').textContent = project.transcript.tokens.length ? (quality === 'estimated' ? '推定タイミング' : '単語タイミング') : '未読込';
}
function updatePlayhead(time) {
  const duration = sourceVideo() ? Number(sourceVideo().duration) || 0 : Number(ui.store.project.media.duration) || 0;
  $('captionTime').textContent = fmt(time); $('captionDuration').textContent = fmt(duration);
  $('captionScrub').value = duration ? Math.round(time / duration * 1000) : 0;
  $('captionPlayhead').style.left = `calc(66px + (100% - 66px) * ${duration ? time / duration : 0})`;
  markNow(time); emit('time', time);
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
  $('captionSegmentList').addEventListener('click', event => { const target = event.target.closest('[data-segment-id]'); if (target) selectSegment(target.dataset.segmentId); });
  $('captionSegmentTrack').addEventListener('click', event => { const target = event.target.closest('[data-segment-id]'); if (target) selectSegment(target.dataset.segmentId); });
  $('captionSegmentTrack').addEventListener('keydown', event => {
    const handle = event.target.closest('[data-boundary-segment]');
    if (handle && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) { event.preventDefault(); const segment = ui.store.project.segments.find(item => item.id === handle.dataset.boundarySegment), next = J.captionTrackNeighbor(ui.store.project, segment, 1), tokens = tokenMap();
      const min = tokens.get(segment.tokenIds[segment.tokenIds.length - 1]).end, max = tokens.get(next.tokenIds[0]).start, step = event.shiftKey ? .1 : .01, time = Math.max(min, Math.min(max, segment.end + (event.key === 'ArrowRight' ? step : -step)));
      runCommand({ type: 'set-segment-boundary', segmentId: segment.id, time: +time.toFixed(6) }, segment.id); return; }
    const target = event.target.closest('[data-segment-id]'); if (target && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); selectSegment(target.dataset.segmentId); }
  });
  $('captionWordTrack').addEventListener('click', event => { const target = event.target.closest('[data-word-id]'); if (!target || ui.timelineZoom < 2) return; const token = tokenMap().get(target.dataset.wordId); if (token) { seekTimeline(token.start); status(`${token.text}: ${fmt(token.start)}–${fmt(token.end)}`); } });
  $('captionTimeline').addEventListener('click', event => { if (event.target.closest('button,[data-segment-id],.caption-boundary-handle')) return; seekTimeline(timelineTimeAt(event.clientX)); });
  $('captionSegmentTrack').addEventListener('pointerdown', event => { const handle = event.target.closest('[data-boundary-segment]'); if (handle) startBoundaryDrag(event, handle.dataset.boundarySegment); });
  window.addEventListener('pointermove', moveBoundary); window.addEventListener('pointerup', finishBoundary);
  $('captionTimelineIn').addEventListener('click', () => { ui.timelineZoom = Math.min(8, ui.timelineZoom * 2); renderSegments(); });
  $('captionTimelineOut').addEventListener('click', () => { ui.timelineZoom = Math.max(1, ui.timelineZoom / 2); renderSegments(); });
  $('captionTimelineFit').addEventListener('click', () => { ui.timelineZoom = 1; $('captionTimeline').scrollLeft = 0; renderSegments(); });
  for (const id of ['captionSegmentList', 'captionSegmentTrack']) $(id).addEventListener('dblclick', event => { const target = event.target.closest('[data-segment-id]'); if (target) selectSegment(target.dataset.segmentId); });
  on('project', renderSegments); on('selection', markSelection);
}
Object.assign(W, { finishBoundary, markNow, markSelection, moveBoundary, renderSegments, seekTimeline, startBoundaryDrag, timelineTimeAt, updatePlayhead });
W.inits.push(init);
})();
