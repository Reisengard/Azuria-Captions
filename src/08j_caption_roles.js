/* ============================================================
   JIZURA — caption roles (delta plan step 5)

   A track styles its words through three roles:
     base      the caption text itself (font, colour, size). Changes what fits, so it is planned.
     active    the word being spoken (treatment, colour). Draw-time only.
     emphasis  words the emphasis pass (or the editor) marked (colour, scale, second font). Draw-time only.
   Active and emphasis never change an advance width, line break or anchor: geometry is laid out from
   the base role, then the other roles restyle glyphs in place ("without reflow"). A second font is
   squeezed horizontally, never widened, to stay inside the base glyph's slot.
   Empty role = inherit the plan. Values are validated, never clamped, so a bad command fails loudly.
   ============================================================ */
(() => {
'use strict';

const HEX = /^#[0-9a-fA-F]{6}$/;
const range = (low, high) => value => Number.isFinite(value) && value >= low && value <= high;
const fontKey = value => typeof value === 'string' && (J.CAPTION_FONTS.includes(value) || J.SAFE_FONT_KEY && J.SAFE_FONT_KEY.test(value));
const activeKey = value => typeof value === 'string' && !!J.CAPTION_ACTIVE && Object.prototype.hasOwnProperty.call(J.CAPTION_ACTIVE, value);
const color = value => typeof value === 'string' && HEX.test(value);

/* Curated, redistributable (SIL OFL 1.1) faces offered for roles. Keys are J.FONTS keys. */
J.CAPTION_FONTS = Object.freeze(['gothic_bold', 'gothic_black', 'gothic_med', 'zenkaku', 'round', 'sansui', 'mincho_bold', 'mincho_black', 'dela', 'klee', 'mono']);
J.CAPTION_ROLE_NAMES = Object.freeze(['base', 'active', 'emphasis']);
J.CAPTION_ROLE_FIELDS = Object.freeze({
  base: { font: fontKey, color, fontSize: range(24, 200) },
  active: { treatment: activeKey, color },
  emphasis: { font: fontKey, color, scale: range(0.9, 1.15), threshold: range(0, 1) },
});
J.CAPTION_EMPHASIS_THRESHOLD = 0.6;

const roleError = (message, details) => new J.ProjectError('TRACK_ROLE_INVALID', message, details);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);

/* Validate a roles object and return a clean copy ({base, active, emphasis}, unknown keys rejected).
   With allowNull, a null field means "clear it" (used to merge edits). */
J.normalizeCaptionRoles = (input, allowNull = false) => {
  const out = { base: {}, active: {}, emphasis: {} };
  if (input == null) return out;
  if (!plain(input)) throw roleError('Track roles must be an object.');
  for (const [role, fields] of Object.entries(input)) {
    const spec = J.CAPTION_ROLE_FIELDS[role];
    if (!spec) throw roleError(`Unknown caption role "${role}".`, { role });
    if (fields == null && allowNull) { out[role] = null; continue; }
    if (!plain(fields)) throw roleError(`Role "${role}" must be an object.`, { role });
    out[role] = {};
    for (const [field, value] of Object.entries(fields)) {
      if (!spec[field]) throw roleError(`Role "${role}" has no field "${field}".`, { role, field });
      if (value == null && allowNull) { out[role][field] = null; continue; }
      if (!spec[field](value)) throw roleError(`Role "${role}" field "${field}" has an invalid value.`, { role, field, value });
      out[role][field] = typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : value;
    }
  }
  return out;
};

/* Apply an edit (nulls clear) on top of the stored roles. */
J.mergeCaptionRoles = (current, edit) => {
  const base = J.normalizeCaptionRoles(current), patch = J.normalizeCaptionRoles(edit, true);
  for (const role of J.CAPTION_ROLE_NAMES) {
    if (patch[role] === null) { base[role] = {}; continue; }
    for (const [field, value] of Object.entries(patch[role])) {
      if (value === null) delete base[role][field]; else base[role][field] = value;
    }
  }
  return base;
};

/* The base role overrides the style the planner uses for this track (so fit and warnings follow). */
J.captionTrackStyle = (style, track) => {
  const base = track && track.roles && track.roles.base;
  if (!base || !(base.font || base.color || base.fontSize)) return style;
  const next = Object.assign({}, style);
  if (base.font) next.font = base.font;
  if (base.color) next.textColor = base.color;
  if (base.fontSize) next.fontSize = base.fontSize;
  return next;
};

/* Which of a segment's tokens count as emphasised: a manual on/off wins, else the planned score against the
   track's threshold (`threshold` overrides it, for previews). Independent of whether the role styles anything. */
J.captionEmphasizedTokenIds = (project, segment, plan, tokens, threshold) => {
  const track = J.captionTrack(project, segment && segment.trackId), emphasis = track && track.roles && track.roles.emphasis || {};
  const limit = Number.isFinite(threshold) ? threshold : Number.isFinite(emphasis.threshold) ? emphasis.threshold : J.CAPTION_EMPHASIS_THRESHOLD;
  const scores = new Map(((plan && plan.emphasis) || []).map(item => [item.id, item.score]));
  return (tokens || []).filter(token => {
    const manual = token.manualEmphasis;
    if (manual && typeof manual.enabled === 'boolean') return manual.enabled;
    return (scores.get(token.id) || 0) >= limit;
  }).map(token => token.id);
};

/* Draw-time description of a segment's roles: which tokens are emphasised and how. */
J.captionRoleRender = (project, segment, plan, tokens) => {
  const track = J.captionTrack(project, segment && segment.trackId), roles = track && track.roles || {};
  const active = roles.active || {}, emphasis = roles.emphasis || {};
  const out = { active: { treatment: active.treatment || null, color: active.color || null }, emphasis: null };
  if (!J.captionRoleStylesEmphasis(track)) return out;
  const tokenIds = J.captionEmphasizedTokenIds(project, segment, plan, tokens);
  if (tokenIds.length) out.emphasis = { tokenIds, font: emphasis.font || null, color: emphasis.color || null, scale: emphasis.scale || null };
  return out;
};

/* Emphasis is only drawn once the role changes something (colour, second font or size). */
J.captionRoleStylesEmphasis = track => { const emphasis = track && track.roles && track.roles.emphasis || {}; return !!(emphasis.font || emphasis.color || emphasis.scale); };

/* How many of a track's words count as emphasised (for the editor's "how many" readout). */
J.captionEmphasisCount = (project, trackId, threshold) => {
  const tokens = new Map((project && project.transcript && project.transcript.tokens || []).map(token => [token.id, token]));
  let count = 0, total = 0;
  for (const segment of J.captionTrackSegments(project, trackId)) {
    const list = segment.tokenIds.map(id => tokens.get(id)).filter(Boolean), plan = J.captionResolvedPlan(project.plans && project.plans[segment.id]);
    count += J.captionEmphasizedTokenIds(project, segment, plan, list, threshold).length; total += list.length;
  }
  return { count, total };
};

/* Fonts a project's roles draw with (for loading and availability warnings). */
J.captionRoleFonts = project => {
  const set = new Set();
  for (const track of project && project.tracks || []) for (const role of J.CAPTION_ROLE_NAMES) {
    const font = track.roles && track.roles[role] && track.roles[role].font; if (font) set.add(font);
  }
  return [...set];
};

/* ---------- fonts (determinism, ADR 0003 §5) ----------
   Layout is measured with the loaded face, so it is only identical across machines when the face ships
   inside the page. build.py embeds every file listed in assets/fonts/manifest.json and publishes the
   keys as window.JIZURA_BUNDLED_FONTS; captions using any other face still work but report it. */
J.BUNDLED_FONT_KEYS = (typeof window !== 'undefined' && Array.isArray(window.JIZURA_BUNDLED_FONTS)) ? window.JIZURA_BUNDLED_FONTS.slice() : [];
J.isBundledFont = key => J.BUNDLED_FONT_KEYS.includes(key);

/* Font keys the captions of a project are drawn with (the base face is the style default unless a role sets one). */
J.captionFontKeys = project => {
  const keys = new Set([J.CAPTION_FONTS[0]]);
  for (const key of J.captionRoleFonts(project)) keys.add(key);
  return [...keys];
};

/* Load the faces (and only then clear cached advance widths) before anything is measured or exported. */
J.ensureCaptionFonts = async project => {
  if (typeof J.ensureFonts !== 'function') return;
  const tokens = project && project.transcript && project.transcript.tokens || [];
  await J.ensureFonts(tokens.map(token => token.text).join(''), J.captionFontKeys(project));
};

/* One row per face: bundled = identical layout everywhere; ready = usable right now on this machine. */
J.captionFontStatus = project => J.captionFontKeys(project).map(key => {
  const face = J.FONTS[key] || {}, css = J.fontCSS ? J.fontCSS(key, 32) : '';
  let ready = false;
  try { ready = !!(css && document.fonts && document.fonts.check && document.fonts.check(css, 'Aあ')); } catch (_) { ready = false; }
  // bundled only counts while the face drawn is the catalogue face (zh/ko lyric languages map keys to other families)
  const drawn = J.faceOf ? J.faceOf(key) : face, bundled = J.isBundledFont(key) && (!face.family || drawn.family === face.family);
  return { key, label: face.label || key, bundled, ready };
});
})();
