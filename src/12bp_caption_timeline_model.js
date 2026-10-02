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

J.captionTimeline = { MAX_PPS, TICK_MIN_PX, blockRect, clampPps, clampScroll, contentWidth, fitPps, followScroll, formatTick, overlapsRange, rulerTicks, tickStep, timeToX, visibleRange, wordLabelsVisible, wordTicksVisible, xToTime, zoomAround };
})();
