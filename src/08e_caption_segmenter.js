/* ============================================================
   JIZURA — deterministic caption segmentation (Gate 2.1)
   ============================================================ */
(() => {
'use strict';

const DEFAULTS = Object.freeze({
  minWords: 2, maxWords: 6, targetWords: 4,
  minDwell: 0.7, targetDwell: 1.8, maxDwell: 3.6,
  silenceBoundary: 0.32, strongSilenceBoundary: 0.7,
  maxLines: 2, safeZoneWidth: 864, averageGlyphWidth: 48,
  lineBalanceWeight: 0.7,
});
const END_PUNCTUATION = /[.!?…。！？]["')〉》」』】）]*$/u;
const SOFT_PUNCTUATION = /[,;:、，；：]["')〉》」』】）]*$/u;
const WEAK_WORD = /^(?:a|an|and|as|at|but|by|for|from|in|nor|of|on|or|the|to|with)$/i;
const round = value => +value.toFixed(6);
const clone = value => JSON.parse(JSON.stringify(value));
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, details) => {
  if (J.ProjectError) throw new J.ProjectError(code, message, details);
  const error = new Error(message); error.code = code; Object.assign(error, details || {}); throw error;
};

const configFor = options => {
  const config = Object.assign({}, DEFAULTS, options || {});
  const zone = options && options.safeZone;
  if (zone && Number.isFinite(zone.width)) config.safeZoneWidth = zone.width;
  else if (zone && Number.isFinite(zone.right) && Number.isFinite(zone.left)) config.safeZoneWidth = zone.right - zone.left;
  if (!(config.safeZoneWidth > 0)) fail('SEGMENT_SAFE_ZONE_INVALID', 'Caption segmentation requires a positive safe-zone width.');
  return config;
};

const glyphUnits = text => Array.from(String(text || '')).reduce((sum, glyph) => {
  if (/\s/u.test(glyph)) return sum + 0.34;
  if (/^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(glyph)) return sum + 1;
  if (/^[MW@#%&]$/u.test(glyph)) return sum + 0.9;
  if (/^[ilI1.,'`]$/u.test(glyph)) return sum + 0.32;
  return sum + 0.58;
}, 0);

const widthOf = (tokens, config) => {
  const text = tokens.map(token => token.text).join(' ');
  if (typeof config.measureText === 'function') {
    const measured = Number(config.measureText(text, tokens));
    if (Number.isFinite(measured) && measured >= 0) return measured;
  }
  return glyphUnits(text) * config.averageGlyphWidth;
};

/* Return the best two-line fit. Width is measured from the active safe zone,
   never from a raw character limit. */
const fitLines = (tokens, config) => {
  const maxWidth = config.safeZoneWidth;
  const whole = widthOf(tokens, config);
  if (whole <= maxWidth) return { lines: 1, widths: [whole], overflow: 0, balance: 0 };
  if (config.maxLines < 2) return { lines: 1, widths: [whole], overflow: whole - maxWidth, balance: 0 };
  let best = null;
  for (let split = 1; split < tokens.length; split++) {
    const left = widthOf(tokens.slice(0, split), config), right = widthOf(tokens.slice(split), config);
    const overflow = Math.max(0, left - maxWidth) + Math.max(0, right - maxWidth);
    const balance = Math.abs(left - right) / Math.max(1, maxWidth);
    const candidate = { lines: 2, widths: [left, right], overflow, balance, split };
    if (!best || overflow < best.overflow || (overflow === best.overflow && balance < best.balance)) best = candidate;
  }
  return best || { lines: 1, widths: [whole], overflow: Math.max(0, whole - maxWidth), balance: 0 };
};

const boundaryReasons = (tokens, boundary, config, forced) => {
  const reasons = [], left = tokens[boundary - 1], right = tokens[boundary];
  if (forced && forced.has(boundary)) reasons.push('preserved-manual-or-locked');
  if (!left) return reasons;
  if (END_PUNCTUATION.test(left.text)) reasons.push('sentence-ending');
  else if (SOFT_PUNCTUATION.test(left.text)) reasons.push('punctuation');
  if (right) {
    const silence = right.start - left.end;
    if (silence >= config.strongSilenceBoundary) reasons.push('long-silence');
    else if (silence >= config.silenceBoundary) reasons.push('silence');
  }
  return reasons;
};

const scoreSegment = (tokens, from, to, config, forced) => {
  const slice = tokens.slice(from, to), count = slice.length;
  const dwell = slice[count - 1].end - slice[0].start;
  const fit = fitLines(slice, config);
  let cost = Math.abs(count - config.targetWords) * 0.55 + Math.abs(dwell - config.targetDwell) * 0.35;
  const penalties = [];
  if (count < config.minWords) { cost += (config.minWords - count) * 3.5; penalties.push('too-few-words'); }
  if (count > config.maxWords) { cost += (count - config.maxWords) * 9; penalties.push('too-many-words'); }
  if (dwell < config.minDwell) { cost += (config.minDwell - dwell) * 8; penalties.push('too-short-dwell'); }
  if (dwell > config.maxDwell) { cost += (dwell - config.maxDwell) * 4; penalties.push('too-long-dwell'); }
  if (fit.overflow > 0) { cost += 40 + fit.overflow / Math.max(1, config.safeZoneWidth) * 80; penalties.push('overflow'); }
  cost += fit.balance * config.lineBalanceWeight;
  if (fit.lines > 1 && fit.balance > 0.55) { cost += 2; penalties.push('uneven-lines'); }
  if (to < tokens.length && WEAK_WORD.test(slice[count - 1].normalizedText || slice[count - 1].text)) { cost += 4; penalties.push('orphaned-weak-word'); }
  const reasons = boundaryReasons(tokens, to, config, forced);
  if (to === tokens.length) reasons.push('transcript-end');
  if (count >= config.targetWords) reasons.push('word-target');
  if (dwell >= config.targetDwell) reasons.push('duration-target');
  if (fit.lines > 1 || fit.overflow > 0) reasons.push('width-pressure');
  if (!reasons.length) reasons.push('balanced-segment');
  if (reasons.includes('sentence-ending')) cost -= 3;
  else if (reasons.includes('long-silence')) cost -= 2.4;
  else if (reasons.includes('punctuation') || reasons.includes('silence')) cost -= 1.2;
  return { cost, dwell, fit, penalties, reasons };
};

const existingRanges = (tokens, segments) => {
  const positions = new Map(tokens.map((token, index) => [token.id, index]));
  const ranges = [];
  for (const segment of segments || []) {
    if (!segment || !Array.isArray(segment.tokenIds) || !segment.tokenIds.length) continue;
    const indexes = segment.tokenIds.map(id => positions.get(id));
    if (indexes.some(index => index == null)) continue;
    const from = indexes[0], to = indexes[indexes.length - 1] + 1;
    if (indexes.some((value, index) => value !== from + index)) continue;
    ranges.push({ from, to, segment });
  }
  return ranges;
};

const planSpan = (tokens, start, end, config, forced) => {
  const best = new Array(end + 1).fill(null); best[start] = { cost: 0, previous: -1, detail: null };
  for (let to = start + 1; to <= end; to++) {
    /* maxWords is a hard caption-safety ceiling. Restricting the dynamic
       program to viable spans keeps a three-minute transcript linear in
       practice instead of repeatedly measuring every O(n²) long span. */
    const first = Math.max(start, to - config.maxWords);
    for (let from = first; from < to; from++) {
      if (!best[from]) continue;
      const detail = scoreSegment(tokens, from, to, config, forced);
      const cost = best[from].cost + detail.cost;
      if (!best[to] || cost < best[to].cost - 1e-9 || (Math.abs(cost - best[to].cost) <= 1e-9 && from < best[to].previous)) {
        best[to] = { cost, previous: from, detail };
      }
    }
  }
  const result = [];
  for (let cursor = end; cursor > start;) {
    const node = best[cursor];
    if (!node) fail('SEGMENTATION_FAILED', `No caption segmentation could cover tokens ${start}–${end - 1}.`);
    result.push({ from: node.previous, to: cursor, detail: node.detail }); cursor = node.previous;
  }
  return result.reverse();
};

J.CAPTION_SEGMENTER_VERSION = 1;
J.captionSegmentationDefaults = DEFAULTS;

J.segmentCaptions = (transcript, options = {}) => {
  if (typeof J.validateTranscript === 'function') J.validateTranscript(transcript, { duration: options.duration });
  const config = configFor(options), excluded = new Set(options.excludedTokenIds || []);
  const tokens = (transcript.tokens || []).filter(token => !excluded.has(token.id)).map(token => Object.assign({}, token, {
    normalizedText: typeof J.normalizeTokenText === 'function' ? J.normalizeTokenText(token.text) : String(token.text).trim().toLowerCase(),
  }));
  if (!tokens.length) return { version: J.CAPTION_SEGMENTER_VERSION, segments: [], diagnostics: { candidateCount: 0, forcedBoundaries: [] } };
  const duration = Number.isFinite(options.duration) ? options.duration : Infinity;
  const ranges = existingRanges(tokens, options.existingSegments);
  const forced = new Set([0, tokens.length]);
  for (const range of ranges) {
    const locks = plainObject(range.segment.locks) ? range.segment.locks : {};
    if (range.segment.boundarySource === 'manual' || locks.segmentation === true) { forced.add(range.from); forced.add(range.to); }
  }
  // A segmentation-locked caption (every text block, by default) is kept whole: its edges are forced and nothing is planned inside it.
  const whole = new Map(ranges.filter(range => plainObject(range.segment.locks) && range.segment.locks.segmentation === true).map(range => [range.from, range.to]));
  const boundaries = Array.from(forced).sort((a, b) => a - b), planned = [];
  for (let index = 1; index < boundaries.length; index++) {
    const from = boundaries[index - 1], to = boundaries[index];
    if (whole.get(from) === to) planned.push({ from, to, detail: scoreSegment(tokens, from, to, config, forced) });
    else planned.push(...planSpan(tokens, from, to, config, forced));
  }
  const exactExisting = new Map(ranges.map(range => [`${range.from}:${range.to}`, range.segment]));
  const segments = planned.map((item, index) => {
    const slice = tokens.slice(item.from, item.to), existing = exactExisting.get(`${item.from}:${item.to}`);
    const preserved = existing && (existing.boundarySource === 'manual' || (existing.locks && existing.locks.segmentation));
    const start = preserved && Number.isFinite(existing.start) ? existing.start : slice[0].start;
    const end = preserved && Number.isFinite(existing.end) ? existing.end : slice[slice.length - 1].end;
    if (start < 0 || end < start || end > duration + 1e-9) fail('SEGMENT_TIMING_INVALID', 'Generated caption segment is outside the project duration.', { start, end, duration });
    return {
      id: existing && existing.id ? existing.id : `segment_${String(index + 1).padStart(6, '0')}`,
      tokenIds: slice.map(token => token.id), start: round(start), end: round(end),
      trackId: existing && existing.trackId || J.CAPTION_PRIMARY_TRACK_ID,
      boundarySource: preserved ? existing.boundarySource : 'planner',
      boundaryReasons: item.detail.reasons,
      locks: existing && existing.locks ? clone(existing.locks) : { segmentation: false, visualPlan: false, fields: [] },
      diagnostics: { score: round(item.detail.cost), dwell: round(item.detail.dwell), lines: item.detail.fit.lines,
        lineWidths: item.detail.fit.widths.map(round), overflow: round(item.detail.fit.overflow), penalties: item.detail.penalties },
    };
  });
  return { version: J.CAPTION_SEGMENTER_VERSION, segments, diagnostics: {
    candidateCount: tokens.length * Math.min(tokens.length, config.maxWords) - Math.min(tokens.length, config.maxWords) * (Math.min(tokens.length, config.maxWords) - 1) / 2,
    forcedBoundaries: boundaries.filter(value => value > 0 && value < tokens.length),
    excludedTokenIds: Array.from(excluded), safeZoneWidth: config.safeZoneWidth,
  } };
};

const replanTrackOptions = (track, options) => {
  const style = track && track.style || {}, profile = style.preset && J.CAPTION_STYLE_PROFILES && J.CAPTION_STYLE_PROFILES[style.preset];
  return Object.assign({}, options, profile && profile.segmentation || {}, style.segmentation || {});
};

/* One track: exactly the old behaviour. Several tracks: each is segmented over its own tokens only (locked and
   manual boundaries survive), then the results are merged in time order. New segment IDs never collide across tracks. */
J.replanCaptionSegments = (project, options = {}) => {
  const base = Object.assign({}, options, { duration: project.media && project.media.duration });
  if (!Array.isArray(project.tracks) || project.tracks.length < 2) return J.segmentCaptions(project.transcript, Object.assign(base, { existingSegments: project.segments || [] }));
  const groups = J.captionTrackTokens(project), reserved = new Set((project.segments || []).map(segment => segment.id)), used = new Set();
  const result = { version: J.CAPTION_SEGMENTER_VERSION, segments: [], diagnostics: { candidateCount: 0, forcedBoundaries: [], tracks: {} } };
  let counter = 0;
  for (const track of project.tracks) {
    const tokens = groups.get(track.id) || [], own = J.captionTrackSegments(project, track.id);
    if (!tokens.length) continue;
    const ownIds = new Set(own.map(segment => segment.id));
    const part = J.segmentCaptions(Object.assign({}, project.transcript, { tokens }), Object.assign({}, replanTrackOptions(track, base), { existingSegments: own }));
    for (const segment of part.segments) {
      if (used.has(segment.id) || (!ownIds.has(segment.id) && reserved.has(segment.id))) {
        let id; do { id = `segment_${String(++counter).padStart(6, '0')}`; } while (used.has(id) || reserved.has(id));
        segment.id = id;
      }
      used.add(segment.id); segment.trackId = track.id; result.segments.push(segment);
    }
    result.diagnostics.candidateCount += part.diagnostics.candidateCount;
    result.diagnostics.tracks[track.id] = part.diagnostics;
  }
  result.segments = J.captionSortSegments({ tracks: project.tracks, segments: result.segments });
  return result;
};
})();
