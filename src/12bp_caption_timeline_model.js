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
    case 'Enter': case 'NumpadEnter': return 'edit';
    case 'ArrowLeft': return shift ? 'back-1s' : 'back-frame';
    case 'ArrowRight': return shift ? 'forward-1s' : 'forward-frame';
    case 'ArrowUp': return 'prev-caption';
    case 'ArrowDown': return 'next-caption';
    case 'Home': return 'start';
    case 'End': return 'end';
    case 'KeyL': return 'loop';
    case 'KeyI': return shift ? null : 'set-start';
    case 'KeyO': return shift ? null : 'set-end';
    case 'KeyN': return shift ? null : 'new';
    case 'KeyS': return shift ? null : 'split';
    case 'Delete': case 'Backspace': return 'delete';
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
  const skip = [].concat(excludeId === undefined ? [] : excludeId);   // one id, or the ids of a whole group
  for (const segment of segments || []) if (!skip.includes(segment.id)) targets.push({ time: segment.start, kind: 'caption' }, { time: segment.end, kind: 'caption' });
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
/* ---- Create and multi-select (T5) ---- */
const NEW_LENGTH = 2;
/* The empty stretch of a track around `time`: { start, end } between its neighbours (or 0 / the end), or null when `time` is inside a caption. */
function freeGap(layout, trackId, time, ignoreIds) {
  const skip = ignoreIds || [], lane = layout.segments.filter(item => item.trackId === trackId && !skip.includes(item.id));
  let start = 0, end = layout.duration;
  for (const other of lane) {
    if (time > other.start + EPS && time < other.end - EPS) return null;
    if (other.end <= time + EPS) start = Math.max(start, other.end); else if (other.start >= time - EPS) end = Math.min(end, other.start);
  }
  return { start: round6(start), end: round6(end) };
}
/* A new caption of up to `length` seconds starting at `time`, shortened to the free space; null when there is no room (min 0.1 s). */
function newBlockRange(layout, trackId, time, length = NEW_LENGTH) {
  const gap = freeGap(layout, trackId, time); if (!gap) return null;
  const start = Math.max(gap.start, Math.min(time, layout.duration)), end = Math.min(start + length, gap.end);
  return end - start >= MIN_SEGMENT - EPS ? { start: round6(start), end: round6(end), trackId } : null;
}
/* Dragging on an empty part of a row from time `a` to time `b`: the range stays inside the free gap around `a`. input: { layout, trackId, a, b, pps, snap, targets }.
   -> { start, end, valid, code, snappedTo }. Too short (< 0.1 s) is invalid with SEGMENT_TIMING_INVALID; starting inside a caption is TRACK_SEGMENT_OVERLAP. */
function createRange(input) {
  const { layout, trackId } = input, gap = freeGap(layout, trackId, input.a);
  if (!gap) return { start: input.a, end: input.b, valid: false, code: 'TRACK_SEGMENT_OVERLAP', snappedTo: null };
  const targets = input.snap ? input.targets || [] : [];
  let b = input.b, snappedTo = null; const snap = nearestSnap([b], targets, input.pps);
  if (snap) { b += snap.delta; snappedTo = snap.target; }
  let start = Math.min(input.a, b), end = Math.max(input.a, b);
  if (start < gap.start) { start = gap.start; snappedTo = null; }
  if (end > gap.end) { end = gap.end; snappedTo = null; }
  start = round6(start); end = round6(end);
  return end - start >= MIN_SEGMENT - EPS ? { start, end, valid: true, code: null, snappedTo } : { start, end, valid: false, code: 'SEGMENT_TIMING_INVALID', snappedTo };
}
/* Ids whose rectangle meets the marquee box. rects: [{ id, left, top, right, bottom }]. */
function marqueeHits(rects, box) {
  const left = Math.min(box.left, box.right), right = Math.max(box.left, box.right), top = Math.min(box.top, box.bottom), bottom = Math.max(box.top, box.bottom);
  return rects.filter(item => item.left <= right && item.right >= left && item.top <= bottom && item.bottom >= top).map(item => item.id);
}
/* Moving several captions together in time (each stays on its own track). input: { layout, ids, delta (pointer movement in s), pps, snap, targets }.
   The shift is clamped so that no member leaves [0, duration] or runs into a caption that is not part of the group; snapping uses every member's edges.
   -> { delta, valid, code, snappedTo, moves: [{ id, start, end }], changed }. A locked member makes the whole move invalid. */
function resolveGroupMove(input) {
  const { layout } = input, members = layout.segments.filter(item => input.ids.includes(item.id)), out = { delta: 0, valid: true, code: null, snappedTo: null, moves: [], changed: false };
  if (!members.length) return Object.assign(out, { valid: false, code: 'SEGMENT_NOT_FOUND' });
  if (members.some(item => item.locked)) return Object.assign(out, { valid: false, code: 'SEGMENT_FIELD_LOCKED' });
  let low = -Infinity, high = Infinity;
  for (const item of members) {
    low = Math.max(low, -item.start); high = Math.min(high, layout.duration - item.end);
    for (const other of layout.segments) {
      if (other.trackId !== item.trackId || input.ids.includes(other.id)) continue;
      if (other.end <= item.start + EPS) low = Math.max(low, other.end - item.start); else if (other.start >= item.end - EPS) high = Math.min(high, other.start - item.end);
    }
  }
  let delta = input.delta; const targets = input.snap ? input.targets || [] : [];
  const snap = nearestSnap(members.flatMap(item => [item.start + delta, item.end + delta]), targets, input.pps);
  if (snap) { delta += snap.delta; out.snappedTo = snap.target; }
  if (high < low - EPS) return Object.assign(out, { valid: false, code: 'TRACK_SEGMENT_OVERLAP' });
  if (delta < low) { delta = low; out.snappedTo = null; } else if (delta > high) { delta = high; out.snappedTo = null; }
  out.delta = round6(delta); out.changed = Math.abs(out.delta) > EPS;
  out.moves = members.map(item => ({ id: item.id, start: round6(item.start + out.delta), end: round6(item.end + out.delta) }));
  return out;
}
/* Order in which a batch of moves is applied so that no member runs over a neighbour that has not moved yet: moving right goes last-first. */
function groupMoveOrder(moves, delta) {
  return moves.slice().sort((a, b) => delta > 0 ? b.start - a.start : a.start - b.start);
}

/* `,` / `.`: move a caption by a fixed step, stopping at its neighbours like a drag does. */
function nudge(layout, segmentId, direction, step = NUDGE) {
  const segment = layout.segments.find(item => item.id === segmentId); if (!segment) return null;
  return resolveDrag({ layout, segmentId, mode: 'move', time: segment.start + direction * step, grab: 0, trackId: segment.trackId, pps: 1, snap: false });
}

/* Waveform (T6): peaks are the largest |sample| per 1/WAVE_RATE s over all channels, computed once; drawing reads a column per pixel. */
const WAVE_RATE = 100, WAVE_MAX_SECONDS = 600, WAVE_MAX_BYTES = 600 * 1024 * 1024;
const waveformAllowed = (duration, bytes) => duration > 0 && duration <= WAVE_MAX_SECONDS && !(bytes > WAVE_MAX_BYTES);
function waveformPeaks(channels, sampleRate, rate = WAVE_RATE) {
  const length = channels.length ? channels[0].length : 0, size = Math.max(1, Math.round(sampleRate / rate)), count = Math.ceil(length / size), peaks = new Float32Array(count);
  for (const data of channels) for (let b = 0; b < count; b++) { let peak = peaks[b]; for (let i = b * size, end = Math.min(length, i + size); i < end; i++) { const v = data[i] < 0 ? -data[i] : data[i]; if (v > peak) peak = v; } peaks[b] = peak; }
  return peaks;
}
/* One amplitude (0..1, scaled so the loudest peak is 1) per pixel column of the window starting at `scrollLeft`. */
function waveformColumns(peaks, rate, pps, scrollLeft, width) {
  const out = new Float32Array(Math.max(0, Math.floor(width))); let top = 0; for (let i = 0; i < peaks.length; i++) if (peaks[i] > top) top = peaks[i];
  if (!top) return out;
  for (let x = 0; x < out.length; x++) {
    const from = Math.max(0, Math.floor((scrollLeft + x) / pps * rate)), to = Math.min(peaks.length, Math.max(from + 1, Math.ceil((scrollLeft + x + 1) / pps * rate))); let peak = 0;
    for (let i = from; i < to; i++) if (peaks[i] > peak) peak = peaks[i];
    out[x] = peak / top;
  }
  return out;
}

/* Strip height (T6): dragged between a minimum and 70 % of the window. */
const STRIP_MIN = 96;
const clampStripHeight = (height, windowHeight) => clamp(Math.round(height), STRIP_MIN, Math.max(STRIP_MIN, Math.round(windowHeight * .7)));

J.captionTimeline = { WAVE_RATE, WAVE_MAX_SECONDS, waveformAllowed, waveformPeaks, waveformColumns, STRIP_MIN, clampStripHeight, NEW_LENGTH, createRange, freeGap, groupMoveOrder, marqueeHits, newBlockRange, resolveGroupMove, adjacentTrackId, reorderIndex, NUDGE, SNAP_PX, MIN_SEGMENT, nearestSnap, nudge, resolveDrag, snapTargets, trackNeighbors, FRAME, LOOP_LEAD, SPEEDS, adjacentSegment, keyAction, loopRegion, loopSeek, markRegion, nextSpeed, stepTime, MAX_PPS, TICK_MIN_PX, blockRect, clampPps, clampScroll, contentWidth, fitPps, followScroll, formatTick, overlapsRange, rulerTicks, tickStep, timeToX, visibleRange, wordLabelsVisible, wordTicksVisible, xToTime, zoomAround };
})();
