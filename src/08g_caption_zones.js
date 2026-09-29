/* ============================================================
   JIZURA — caption zones and readability scoring (Gate 2.3)
   ============================================================ */
(() => {
'use strict';

const KINDS = Object.freeze(['top', 'center', 'bottom', 'custom']);
const CONTRAST_STRATEGIES = Object.freeze(['none', 'outline', 'shadow', 'backplate', 'auto']);
const DEFAULTS = Object.freeze({ minFontSize: 42, maxLines: 2, minDuration: 0.65, maxCharactersPerSecond: 22, minContrast: 4.5 });
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const round = value => +value.toFixed(3);
const fail = (code, message, details) => {
  if (J.ProjectError) throw new J.ProjectError(code, message, details);
  const error = new Error(message); error.code = code; Object.assign(error, details || {}); throw error;
};
const validFrame = frame => frame && Number.isFinite(frame.width) && frame.width > 0 && Number.isFinite(frame.height) && frame.height > 0;

J.CAPTION_ZONE_KINDS = KINDS;
J.CAPTION_CONTRAST_STRATEGIES = CONTRAST_STRATEGIES;
J.captionReadabilityDefaults = DEFAULTS;

J.validateCaptionZone = (zone, frame) => {
  if (!zone || typeof zone !== 'object') fail('CAPTION_ZONE_REQUIRED', 'Caption zone must be an object.');
  if (typeof zone.id !== 'string' || !zone.id) fail('CAPTION_ZONE_ID_REQUIRED', 'Caption zone requires an id.');
  if (!KINDS.includes(zone.kind)) fail('CAPTION_ZONE_KIND_INVALID', `Caption zone "${zone.id}" has invalid kind "${String(zone.kind)}".`, { zoneId: zone.id });
  for (const field of ['x', 'y', 'width', 'height']) if (!Number.isFinite(zone[field])) {
    fail('CAPTION_ZONE_RECT_INVALID', `Caption zone "${zone.id}" requires finite ${field}.`, { zoneId: zone.id, field });
  }
  if (zone.x < 0 || zone.y < 0 || zone.width <= 0 || zone.height <= 0) fail('CAPTION_ZONE_RECT_INVALID', `Caption zone "${zone.id}" has an invalid rectangle.`, { zoneId: zone.id });
  if (validFrame(frame) && (zone.x + zone.width > frame.width + 1e-6 || zone.y + zone.height > frame.height + 1e-6)) {
    fail('CAPTION_ZONE_OUTSIDE_FRAME', `Caption zone "${zone.id}" extends outside the frame.`, { zoneId: zone.id });
  }
  return zone;
};

const socialInsets = frame => {
  const portrait = frame.height > frame.width;
  return portrait
    ? { left: frame.width * 0.075, right: frame.width * 0.14, top: frame.height * 0.1, bottom: frame.height * 0.2 }
    : { left: frame.width * 0.06, right: frame.width * 0.06, top: frame.height * 0.08, bottom: frame.height * 0.1 };
};

J.captionSocialSafeRect = frame => {
  if (!validFrame(frame)) fail('CAPTION_FRAME_INVALID', 'Caption zones require positive frame width and height.');
  const inset = socialInsets(frame);
  return { x: round(inset.left), y: round(inset.top), width: round(frame.width - inset.left - inset.right), height: round(frame.height - inset.top - inset.bottom) };
};

J.createCaptionZone = (kind, frame, options = {}) => {
  if (!KINDS.includes(kind)) fail('CAPTION_ZONE_KIND_INVALID', `Unknown caption zone kind "${String(kind)}".`);
  if (!validFrame(frame)) fail('CAPTION_FRAME_INVALID', 'Caption zones require positive frame width and height.');
  const safe = options.socialSafe === false ? { x: 0, y: 0, width: frame.width, height: frame.height } : J.captionSocialSafeRect(frame);
  let rect;
  if (kind === 'custom') rect = options.rect || options;
  else {
    const height = safe.height / 3;
    const row = kind === 'top' ? 0 : kind === 'center' ? 1 : 2;
    rect = { x: safe.x, y: safe.y + height * row, width: safe.width, height };
  }
  const zone = {
    id: String(options.id || `caption-${kind}`), kind,
    x: round(Number(rect.x)), y: round(Number(rect.y)), width: round(Number(rect.width)), height: round(Number(rect.height)),
    preset: options.socialSafe === false ? null : kind === 'custom' ? null : 'vertical-social-safe',
    manual: kind === 'custom' || options.manual === true,
  };
  return J.validateCaptionZone(zone, frame);
};

/* Rectangle editing is immutable and constrained to the visible frame. */
J.editCaptionZoneRect = (zone, rect, frame) => {
  J.validateCaptionZone(zone, frame);
  if (!rect || typeof rect !== 'object') fail('CAPTION_ZONE_RECT_INVALID', 'Manual caption-zone editing requires a rectangle.');
  const x = clamp(Number(rect.x), 0, frame.width - 1), y = clamp(Number(rect.y), 0, frame.height - 1);
  const width = clamp(Number(rect.width), 1, frame.width - x), height = clamp(Number(rect.height), 1, frame.height - y);
  if (![x, y, width, height].every(Number.isFinite)) fail('CAPTION_ZONE_RECT_INVALID', 'Manual caption-zone rectangle must contain finite numbers.');
  return J.validateCaptionZone(Object.assign({}, zone, { kind: 'custom', x: round(x), y: round(y), width: round(width), height: round(height), preset: null, manual: true }), frame);
};

const glyphFactor = glyph => /\s/u.test(glyph) ? 0.33
  : /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]$/u.test(glyph) ? 1
  : /^[MW@#%&]$/u.test(glyph) ? 0.9 : /^[ilI1.,'`]$/u.test(glyph) ? 0.3 : 0.57;
const defaultMeasure = (text, fontSize) => Array.from(String(text)).reduce((sum, glyph) => sum + glyphFactor(glyph), 0) * fontSize;
const piecesOf = text => {
  const source = String(text || '').trim();
  if (!source) return [];
  if (/\s/u.test(source)) return source.split(/\s+/u);
  return Array.from(source);
};

J.measureCaptionInZone = (text, zone, options = {}) => {
  const fontSize = Number(options.fontSize), maxLines = Number(options.maxLines || DEFAULTS.maxLines);
  const measure = typeof options.measureText === 'function' ? value => Number(options.measureText(value, fontSize)) : value => defaultMeasure(value, fontSize);
  const pieces = piecesOf(text), lines = []; let current = '';
  for (const piece of pieces) {
    const candidate = current ? `${current}${/\s/u.test(String(text)) ? ' ' : ''}${piece}` : piece;
    if (current && measure(candidate) > zone.width) { lines.push(current); current = piece; }
    else current = candidate;
  }
  if (current) lines.push(current);
  const widths = lines.map(line => measure(line));
  const lineHeight = fontSize * Number(options.lineHeight || 1.18);
  const overflowX = Math.max(0, ...widths.map(width => width - zone.width));
  const overflowY = Math.max(0, lines.length * lineHeight - zone.height);
  return { lines, lineCount: lines.length, widths: widths.map(round), lineHeight: round(lineHeight), overflowX: round(overflowX), overflowY: round(overflowY), maxLines, fits: lines.length <= maxLines && overflowX <= 0 && overflowY <= 0 };
};

const parseColor = value => {
  const text = String(value || '').trim();
  let match = text.match(/^#([\da-f]{3}|[\da-f]{6})$/i);
  if (match) { const hex = match[1].length === 3 ? Array.from(match[1], c => c + c).join('') : match[1]; return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16)); }
  match = text.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  return match ? match.slice(1, 4).map(value => clamp(Number(value), 0, 255)) : null;
};
const luminance = color => color.map(value => value / 255).map(value => value <= 0.03928 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4)).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
J.captionContrastRatio = (foreground, background) => {
  const a = parseColor(foreground), b = parseColor(background);
  if (!a || !b) return null;
  const first = luminance(a), second = luminance(b);
  return round((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05));
};

const anchorsStable = candidate => {
  if (candidate.stableAnchor === false) return false;
  const states = candidate.activeStates;
  if (!Array.isArray(states) || states.length < 2) return true;
  const first = states[0], key = value => JSON.stringify([value.anchor && value.anchor.x, value.anchor && value.anchor.y, value.lineBreaks || value.lines]);
  return states.every(state => key(state) === key(first));
};

J.evaluateCaptionReadability = (candidate, context = {}) => {
  const constraints = Object.assign({}, DEFAULTS, context.constraints || {});
  const zone = candidate.zone || context.zone;
  J.validateCaptionZone(zone, context.frame);
  const reasons = [], warnings = [];
  const fontSize = Number(candidate.fontSize);
  if (!Number.isFinite(fontSize) || fontSize < constraints.minFontSize) reasons.push('font-too-small');
  const text = candidate.text != null ? String(candidate.text) : (candidate.tokens || []).map(token => token.text).join(' ');
  const measurement = J.measureCaptionInZone(text, zone, { fontSize, maxLines: candidate.maxLines || constraints.maxLines, lineHeight: candidate.lineHeight, measureText: context.measureText });
  if (measurement.lineCount > measurement.maxLines) reasons.push('too-many-lines');
  if (measurement.overflowX > 0) reasons.push('horizontal-overflow');
  if (measurement.overflowY > 0) reasons.push('vertical-overflow');

  const duration = Number(candidate.duration);
  const readableDuration = Math.max(constraints.minDuration, Array.from(text.replace(/\s/gu, '')).length / constraints.maxCharactersPerSecond);
  if (!Number.isFinite(duration) || duration < readableDuration) reasons.push('duration-incompatible');

  const strategy = candidate.contrastStrategy || 'none';
  if (!CONTRAST_STRATEGIES.includes(strategy)) reasons.push('contrast-strategy-invalid');
  const ratio = J.captionContrastRatio(candidate.textColor, candidate.backgroundColor);
  if ((ratio == null || ratio < constraints.minContrast) && strategy === 'none') reasons.push('contrast-insufficient');
  else if (ratio != null && ratio < constraints.minContrast) warnings.push('contrast-assisted');
  if (!anchorsStable(candidate)) reasons.push('unstable-anchor');

  const uniqueReasons = Array.from(new Set(reasons));
  const penalty = uniqueReasons.length * 20 + measurement.lineCount + (ratio == null ? 0 : Math.max(0, constraints.minContrast - ratio));
  return { allowed: uniqueReasons.length === 0, score: round(Math.max(0, 100 - penalty)), reasons: uniqueReasons, warnings, measurement,
    contrastRatio: ratio, requiredDuration: round(readableDuration), zoneId: zone.id };
};

/* Planners can reject unreadable candidates and retry without knowing the
   details of text measurement or contrast evaluation. */
J.filterReadableCaptionCandidates = (candidates, context = {}) => {
  const accepted = [], rejected = [];
  for (const candidate of candidates || []) {
    const readability = J.evaluateCaptionReadability(candidate, context);
    (readability.allowed ? accepted : rejected).push({ candidate, readability });
  }
  accepted.sort((a, b) => b.readability.score - a.readability.score);
  return { accepted, rejected };
};
})();
