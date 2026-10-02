/* ============================================================
   JIZURA — Video Captions timeline: pure maths (no DOM). Units are pixels per second (pps).
   ============================================================ */
(() => {
'use strict';
const MAX_PPS = 400, MIN_BLOCK_PX = 2, TICK_MIN_PX = 80;
const TICK_STEPS = [.01, .02, .05, .1, .2, .5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800, 3600];
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const timeToX = (time, pps) => time * pps;
const xToTime = (x, pps, duration) => clamp(x / Math.max(1e-9, pps), 0, Math.max(0, duration));
const contentWidth = (duration, pps) => Math.max(0, duration) * pps;
/* "Whole video fits" is the lowest zoom; the highest is MAX_PPS. */
const fitPps = (duration, viewportWidth) => duration > 0 && viewportWidth > 0 ? viewportWidth / duration : 1;
const clampPps = (pps, duration, viewportWidth) => clamp(pps, Math.min(fitPps(duration, viewportWidth), MAX_PPS), MAX_PPS);
const clampScroll = (scrollLeft, duration, pps, viewportWidth) => clamp(scrollLeft, 0, Math.max(0, contentWidth(duration, pps) - viewportWidth));

/* Zoom by `factor` so that the time under `anchorX` (a pixel inside the viewport) stays under it. */
function zoomAround({ pps, scrollLeft }, factor, anchorX, duration, viewportWidth) {
  const next = clampPps(pps * factor, duration, viewportWidth), anchorTime = (scrollLeft + anchorX) / pps;
  return { pps: next, scrollLeft: clampScroll(anchorTime * next - anchorX, duration, next, viewportWidth) };
}

/* The smallest step whose labelled ticks are at least TICK_MIN_PX apart; minor ticks subdivide it. */
const MINOR_DIVISIONS = { .01: 2, .02: 2, .2: 4, 2: 4, 15: 3, 30: 3, 60: 6, 120: 4 };
function tickStep(pps) {
  const major = TICK_STEPS.find(step => step * pps >= TICK_MIN_PX) || TICK_STEPS[TICK_STEPS.length - 1];
  return { major, minor: major / (MINOR_DIVISIONS[major] || 5) };
}
function formatTick(time, step) {
  const decimals = step >= 1 ? 0 : step >= .1 ? 1 : 2, minutes = Math.floor(time / 60), seconds = time - minutes * 60;
  return `${minutes}:${seconds.toFixed(decimals).padStart(decimals ? decimals + 3 : 2, '0')}`;
}
/* Ticks inside [from, to] seconds: { time, major, label? } — minor ticks have no label. */
function rulerTicks(pps, from, to, duration) {
  const { major, minor } = tickStep(pps), ticks = [], start = Math.max(0, Math.floor(from / minor - 1e-9)), end = Math.min(duration, to);
  for (let index = start; index * minor <= end + 1e-9; index++) {
    const time = +(index * minor).toFixed(6), isMajor = Math.abs(time / major - Math.round(time / major)) < 1e-6;
    ticks.push(isMajor ? { time, major: true, label: formatTick(time, major) } : { time, major: false });
  }
  return ticks;
}

/* The time range that is on screen, widened by `margin` pixels on both sides (for culling). */
function visibleRange(scrollLeft, viewportWidth, pps, duration, margin = 0) {
  return { from: Math.max(0, (scrollLeft - margin) / pps), to: Math.min(duration, (scrollLeft + viewportWidth + margin) / pps) };
}
const blockRect = (segment, pps) => ({ left: segment.start * pps, width: Math.max(MIN_BLOCK_PX, (segment.end - segment.start) * pps) });
const overlapsRange = (segment, range) => segment.end >= range.from && segment.start <= range.to;
/* Word ticks inside a block need room; their text needs more. */
const wordTicksVisible = pps => pps >= 40;
const wordLabelsVisible = pps => pps >= 80;

/* While playing, page the view when the playhead reaches the right edge (or leaves to the left). Returns the new scrollLeft. */
function followScroll(scrollLeft, viewportWidth, playheadX, duration, pps) {
  if (playheadX >= scrollLeft && playheadX <= scrollLeft + viewportWidth * .95) return scrollLeft;
  return clampScroll(playheadX - viewportWidth * .1, duration, pps, viewportWidth);
}

/* ---- Transport maths (T2): loop region, speed, stepping, caption neighbours, keyboard map ---- */
const SPEEDS = [1, .75, .5], FRAME = 1 / 30, LOOP_LEAD = .3, MIN_LOOP = .1;
const nextSpeed = speed => SPEEDS[(Math.max(0, SPEEDS.findIndex(item => Math.abs(item - speed) < 1e-9)) + 1) % SPEEDS.length];
/* A dragged range on the ruler; too short to be a loop = null. */
function markRegion(a, b, duration) {
  const start = clamp(Math.min(a, b), 0, duration), end = clamp(Math.max(a, b), 0, duration);
  return end - start >= MIN_LOOP ? { start: +start.toFixed(6), end: +end.toFixed(6) } : null;
}
/* What `L` loops: the marked region if there is one, else the selected caption with a lead-in/out. */
function loopRegion(marked, segment, duration, lead = LOOP_LEAD) {
  if (marked && marked.end - marked.start >= MIN_LOOP) return { start: marked.start, end: marked.end };
  if (!segment) return null;
  return { start: +clamp(segment.start - lead, 0, duration).toFixed(6), end: +clamp(segment.end + lead, 0, duration).toFixed(6) };
}
/* Called every frame while playing: where to jump to when the playhead has passed the loop end (else null). */
const loopSeek = (time, region) => region && time >= region.end ? region.start : null;
/* Move the playhead by `count` frames or `seconds`; stays inside [0, duration]. */
function stepTime(time, direction, { seconds, frame = FRAME } = {}, duration) {
  const index = time / frame, next = seconds ? time + direction * seconds : (direction > 0 ? Math.floor(index + 1e-6) + 1 : Math.ceil(index - 1e-6) - 1) * frame;
  return clamp(+next.toFixed(6), 0, Math.max(0, duration));
}
/* The caption that starts after (direction 1) or before (-1) `time`, over every track. */
function adjacentSegment(segments, time, direction) {
  const sorted = segments.slice().sort((a, b) => a.start - b.start || a.end - b.end), eps = .001;
  return direction > 0 ? sorted.find(segment => segment.start > time + eps) || null : sorted.reverse().find(segment => segment.start < time - eps) || null;
}
/* Keyboard map of the transport; the handler decides when keys are ignored (typing, dialogs). */
function keyAction(event) {
  if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) { if (event.code === 'ArrowUp') return 'track-up'; if (event.code === 'ArrowDown') return 'track-down'; }
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const shift = !!event.shiftKey;
  switch (event.code) {
    case 'Space': return 'play';
    case 'ArrowLeft': return shift ? 'back-1s' : 'back-frame';
    case 'ArrowRight': return shift ? 'forward-1s' : 'forward-frame';
    case 'ArrowUp': return 'prev-caption';
    case 'ArrowDown': return 'next-caption';
    case 'Home': return 'start';
    case 'End': return 'end';
    case 'KeyL': return 'loop';
    case 'Escape': return 'escape';
    default: break;
  }
  if (event.key === ',' || event.key === '<') return 'nudge-back';
  if (event.key === '.' || event.key === '>') return 'nudge-forward';
  if (event.key === '+' || event.key === '=') return 'zoom-in';
  if (event.key === '-' || event.key === '_') return 'zoom-out';
  if (event.key === '0') return 'zoom-fit';
  return null;
}

/* ---- Tracks (T4) ---- */
/* Id of the track above (-1) or below (+1) `trackId` in the row order, or null at the edge. */
function adjacentTrackId(tracks, trackId, direction) {
  const index = tracks.findIndex(item => item.id === trackId), next = tracks[index + direction];
  return index < 0 || !next ? null : next.id;
}
/* Where a dragged header lands: the index of the row whose vertical centre is nearest `y`, never before the primary track (index 0 is fixed). */
function reorderIndex(centers, y) {
  let best = 1, distance = Infinity;
  centers.forEach((center, index) => { const d = Math.abs(y - center); if (index >= 1 && d < distance) { distance = d; best = index; } });
  return Math.min(best, Math.max(1, centers.length - 1));
}

/* ---- Drag maths (T3): snapping and the resolution of a move / trim drag. Pure: the view passes plain data, the store has the last word. ----
   A "layout" is { duration, segments: [{ id, start, end, trackId, firstWord, lastWord, block, locked, trackLocked }] } (firstWord / lastWord = start of the first / end of the last word). */
const SNAP_PX = 6, MIN_SEGMENT = .1, NUDGE = .05, EPS = 1e-6, round6 = value => +value.toFixed(6);
/* Times a drag can snap to: { time, kind } with kind playhead | caption | word | cut | loop | edge. */
function snapTargets({ duration, playhead, loop, cuts, segments, excludeId, wordTimes }) {
  const targets = [{ time: 0, kind: 'edge' }, { time: duration, kind: 'edge' }];
  if (Number.isFinite(playhead)) targets.push({ time: playhead, kind: 'playhead' });
  if (loop) targets.push({ time: loop.start, kind: 'loop' }, { time: loop.end, kind: 'loop' });
  for (const time of cuts || []) targets.push({ time, kind: 'cut' });
  for (const segment of segments || []) if (segment.id !== excludeId) targets.push({ time: segment.start, kind: 'caption' }, { time: segment.end, kind: 'caption' });
  for (const time of wordTimes || []) targets.push({ time, kind: 'word' });
  return targets;
}
/* The closest (candidate, target) pair within `px` pixels: { delta, target } to add to the candidate, or null. */
function nearestSnap(candidates, targets, pps, px = SNAP_PX) {
  const limit = px / Math.max(1e-9, pps); let best = null;
  for (const candidate of candidates) for (const target of targets) {
    const delta = target.time - candidate, distance = Math.abs(delta);
    if (distance <= limit + EPS && (!best || distance < Math.abs(best.delta) - EPS)) best = { delta, target };
  }
  return best;
}
/* Neighbours of a segment on its own track (the nearest ones before and after it). */
function trackNeighbors(layout, segment) {
  let before = null, after = null;
  for (const other of layout.segments) {
    if (other.id === segment.id || other.trackId !== segment.trackId) continue;
    if (other.end <= segment.start + EPS) { if (!before || other.end > before.end) before = other; }
    else if (other.start >= segment.end - EPS && (!after || other.start < after.start)) after = other;
  }
  return { before, after };
}
const overlapsOn = (layout, segment, trackId, start, end) => layout.segments.find(other => other.id !== segment.id && other.trackId === trackId && start < other.end - EPS && end > other.start + EPS) || null;
/* One drag step. input: { layout, segmentId, mode: 'move' | 'trim-start' | 'trim-end', time (pointer), grab (pointer minus the grabbed edge / start at pointer-down),
   trackId (row under the pointer), pps, snap (bool), shift (bool), targets }.
   -> { segmentId, mode, start, end, trackId, valid, code, snappedTo, words, changed }. `code` is a store error code when invalid. */
function resolveDrag(input) {
  const { layout, mode } = input, segment = layout.segments.find(item => item.id === input.segmentId); if (!segment) return { valid: false, code: 'SEGMENT_NOT_FOUND', mode };
  const trackId = input.trackId || segment.trackId, retrack = trackId !== segment.trackId, targets = input.snap ? input.targets || [] : [];
  const out = { segmentId: segment.id, mode, start: segment.start, end: segment.end, trackId, valid: true, code: null, snappedTo: null, words: 'keep', changed: false };
  if (segment.locked) return Object.assign(out, { valid: false, code: 'SEGMENT_FIELD_LOCKED', trackId: segment.trackId });
  if (retrack && segment.trackLocked) return Object.assign(out, { valid: false, code: 'SEGMENT_FIELD_LOCKED' });
  const { before, after } = trackNeighbors(layout, segment), duration = layout.duration, raw = input.time - input.grab;
  if (mode === 'move') {
    const length = segment.end - segment.start;
    let start = raw; const snap = nearestSnap([start, start + length], targets, input.pps);
    if (snap) { start += snap.delta; out.snappedTo = snap.target; }
    let low = 0, high = duration - length;
    if (!retrack) { if (before) low = Math.max(low, before.end); if (after) high = Math.min(high, after.start - length); }
    if (high >= low - EPS) {
      if (start < low) { start = low; out.snappedTo = !retrack && before && Math.abs(low - before.end) < EPS ? { time: before.end, kind: 'caption' } : { time: 0, kind: 'edge' }; }
      else if (start > high) { start = high; out.snappedTo = !retrack && after && Math.abs(high - (after.start - length)) < EPS ? { time: after.start, kind: 'caption' } : { time: duration, kind: 'edge' }; }
    }
    out.start = round6(start); out.end = round6(start + length);
    out.changed = retrack || Math.abs(out.start - segment.start) > EPS;
  } else {
    const trimStart = mode === 'trim-start', fit = !!input.shift || segment.block;
    let edge = raw; const snap = nearestSnap([edge], targets, input.pps);
    if (snap) { edge += snap.delta; out.snappedTo = snap.target; }
    let low, high, wordLow = false, wordHigh = false;   // which wall is a word (shown as a snap) rather than a neighbour or the minimum length
    if (trimStart) { low = before ? before.end : 0; high = segment.end - MIN_SEGMENT; if (!fit && Number.isFinite(segment.firstWord) && segment.firstWord < high) { high = segment.firstWord; wordHigh = true; } }
    else { high = after ? after.start : duration; low = segment.start + MIN_SEGMENT; if (!fit && Number.isFinite(segment.lastWord) && segment.lastWord > low) { low = segment.lastWord; wordLow = true; } }
    if (high < low - EPS) { out.valid = false; out.code = 'SEGMENT_WORDS_OUTSIDE'; return out; }
    if (edge < low) { edge = low; out.snappedTo = wordLow ? { time: low, kind: 'word' } : trimStart ? (before ? { time: before.end, kind: 'caption' } : { time: 0, kind: 'edge' }) : null; }
    else if (edge > high) { edge = high; out.snappedTo = wordHigh ? { time: high, kind: 'word' } : trimStart ? null : (after ? { time: after.start, kind: 'caption' } : { time: duration, kind: 'edge' }); }
    if (trimStart) out.start = round6(edge); else out.end = round6(edge);
    out.words = input.shift && !segment.block ? 'fit' : 'keep';
    out.changed = Math.abs(out.start - segment.start) > EPS || Math.abs(out.end - segment.end) > EPS;
  }
  if (out.start < -EPS || out.end > duration + EPS || out.end - out.start < MIN_SEGMENT - EPS) { out.valid = false; out.code = 'SEGMENT_TIMING_INVALID'; return out; }
  const hit = overlapsOn(layout, segment, trackId, out.start, out.end);
  if (hit) { out.valid = false; out.code = 'TRACK_SEGMENT_OVERLAP'; out.otherSegmentId = hit.id; }
  return out;
}
/* `,` / `.`: move a caption by a fixed step, stopping at its neighbours like a drag does. */
function nudge(layout, segmentId, direction, step = NUDGE) {
  const segment = layout.segments.find(item => item.id === segmentId); if (!segment) return null;
  return resolveDrag({ layout, segmentId, mode: 'move', time: segment.start + direction * step, grab: 0, trackId: segment.trackId, pps: 1, snap: false });
}

J.captionTimeline = { adjacentTrackId, reorderIndex, NUDGE, SNAP_PX, MIN_SEGMENT, nearestSnap, nudge, resolveDrag, snapTargets, trackNeighbors, FRAME, LOOP_LEAD, SPEEDS, adjacentSegment, keyAction, loopRegion, loopSeek, markRegion, nextSpeed, stepTime, MAX_PPS, TICK_MIN_PX, blockRect, clampPps, clampScroll, contentWidth, fitPps, followScroll, formatTick, overlapsRange, rulerTicks, tickStep, timeToX, visibleRange, wordLabelsVisible, wordTicksVisible, xToTime, zoomAround };
})();
