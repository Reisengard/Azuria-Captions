/* ============================================================
   JIZURA — manual text blocks (delta plan step 7)

   A text block is text the user types with a start and end (a title, a note,
   a translation line). It is kept deliberately plain:
     - one segment on one track, made of tokens with source "manual" whose
       times are spread evenly across the block (active-word behaviour stays on);
     - segmentation is locked by default, so re-segmenting never splits it;
     - its own box (plan.manual.box) and preset animations (plan.manual
       entrance / hold / exit, ids from the caption-safe registry); no keyframes,
       no images;
     - it may overlap speech or blocks on other tracks, never another caption on
       its own track (one caption per track is on screen).
   Video notes (settings.videoEdit.notes) stay separate: they belong to the video
   edit, are drawn under the captions and have no track, plan or active word.
   ============================================================ */
(() => {
'use strict';

const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, details) => { throw new J.ProjectError(code, message, details); };

J.CAPTION_TEXT_BLOCK_SOURCE = 'manual';
/* Command key -> registry group and plan field. */
J.CAPTION_TEXT_BLOCK_ANIMATION = Object.freeze({
  enter: Object.freeze({ group: 'enter', field: 'entrance' }),
  hold: Object.freeze({ group: 'hold', field: 'hold' }),
  exit: Object.freeze({ group: 'exit', field: 'exit' }),
});

J.isCaptionTextBlockToken = token => !!token && token.source === J.CAPTION_TEXT_BLOCK_SOURCE;

/* Derived, not stored: a segment is a text block when every word on it was typed in
   (this also covers captions made by the older add-caption command). */
J.isCaptionTextBlock = (project, segment) => {
  if (!segment || !Array.isArray(segment.tokenIds) || !segment.tokenIds.length) return false;
  const tokens = new Map((project && project.transcript && project.transcript.tokens || []).map(token => [token.id, token]));
  return segment.tokenIds.every(id => J.isCaptionTextBlockToken(tokens.get(id)));
};

/* Words of a block, spread evenly over [start, end]. Existing IDs are reused by position so
   an edit keeps the ids (and a word's manual emphasis while its text is unchanged). */
J.captionTextBlockTokens = (options) => {
  const { text, start, end, language, segmentId, previous = [], usedIds } = options;
  const words = J.tokenizeCaptionText(text, language);
  if (!words.length) fail('TOKEN_TEXT_REQUIRED', 'Enter caption text first.');
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) fail('SEGMENT_TIMING_INVALID', 'End time must be later than start time.', { start, end });
  const used = usedIds || new Set();
  return words.map((word, index) => {
    const old = previous[index];
    let id = old && old.id;
    if (!id) { id = `manual_${segmentId}_${index}`; while (used.has(id)) id += '_'; }
    used.add(id);
    const token = J.canonicalToken({ id, text: word, start: start + (end - start) * index / words.length,
      end: start + (end - start) * (index + 1) / words.length, source: J.CAPTION_TEXT_BLOCK_SOURCE, timingQuality: 'estimated' }, index);
    if (old && old.manualEmphasis != null && J.normalizeTokenText(old.text) === token.normalizedText) token.manualEmphasis = JSON.parse(JSON.stringify(old.manualEmphasis));
    return token;
  });
};

const animationIdOk = (group, id) => {
  if (typeof id !== 'string' || !id || !J.registry || !Object.prototype.hasOwnProperty.call(J.registry(group), id)) return false;
  return !J.captionComponentEligibility || J.captionComponentEligibility(group, id, {}).allowed === true;
};

/* { enter, hold, exit }: a caption-safe registry id, or null = let the planner choose. Unknown keys are rejected. */
J.normalizeCaptionTextBlockAnimation = input => {
  if (!plain(input)) fail('TEXT_BLOCK_ANIMATION_INVALID', 'Text block animation must be an object.');
  const out = {};
  for (const [key, value] of Object.entries(input)) {
    const spec = J.CAPTION_TEXT_BLOCK_ANIMATION[key];
    if (!spec) fail('TEXT_BLOCK_ANIMATION_INVALID', `Text block animation has no "${key}" preset.`, { key });
    if (value == null) { out[key] = null; continue; }
    if (!animationIdOk(spec.group, value)) fail('TEXT_BLOCK_ANIMATION_INVALID', `"${String(value)}" is not a caption-safe ${key} preset.`, { key, value });
    out[key] = value;
  }
  return out;
};

/* Write animation choices into plan.manual (null removes the override). */
J.applyCaptionTextBlockAnimation = (manual, animation) => {
  for (const [key, value] of Object.entries(J.normalizeCaptionTextBlockAnimation(animation))) {
    const field = J.CAPTION_TEXT_BLOCK_ANIMATION[key].field;
    if (value == null) delete manual[field]; else manual[field] = value;
  }
  return manual;
};

/* Presets offered for a block: the ones its track's style would use, caption-safe only. */
J.captionTextBlockAnimationOptions = (project, trackId) => {
  const track = J.captionTrack(project, trackId), style = J.captionTrackProjectStyle ? J.captionTrackProjectStyle(project, track) : project && project.style;
  const key = typeof style === 'string' ? style : plain(style) ? style.preset || style.profile || 'creator' : 'creator';
  const profiles = J.CAPTION_STYLE_PROFILES || {}, profile = profiles[key] || profiles.creator || {};
  const lists = { enter: profile.entrances, hold: profile.holds, exit: profile.exits }, out = {};
  for (const [name, spec] of Object.entries(J.CAPTION_TEXT_BLOCK_ANIMATION)) out[name] = (lists[name] || []).filter(id => animationIdOk(spec.group, id));
  return out;
};

/* The block's current animation choices (null = automatic). */
J.captionTextBlockAnimation = plan => {
  const manual = plan && plain(plan.manual) ? plan.manual : {}, out = {};
  for (const [name, spec] of Object.entries(J.CAPTION_TEXT_BLOCK_ANIMATION)) out[name] = typeof manual[spec.field] === 'string' ? manual[spec.field] : null;
  return out;
};

/* Only one caption per track is on screen: a block must not overlap another caption on its track. */
J.captionTextBlockOverlap = (project, trackId, start, end, ignoreId) => J.captionTrackSegments(project, trackId)
  .find(segment => segment.id !== ignoreId && start < segment.end && end > segment.start) || null;
})();
