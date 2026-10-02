/* ============================================================
   JIZURA — caption tracks (delta plan step 6)

   Up to three tracks show captions at the same time, each with its own box,
   roles and style. Words are assigned to tracks by hand (no automatic keyword
   track). Rules kept here so the store, planner, compositor and UI agree:
     - a token belongs to at most one segment, and a segment to exactly one track;
     - project.segments stays sorted by start (ties: track order), across all tracks;
     - tracks[0] is the primary track: undeletable, bottom of the z-order;
       later tracks are drawn on top in array order (reorder changes the z-order);
     - nothing here moves a caption: overlapping boxes only produce warnings.
   ============================================================ */
(() => {
'use strict';

const HEX = /^#[0-9a-fA-F]{6}$/;
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const styleError = (message, details) => new J.ProjectError('TRACK_STYLE_INVALID', message, details);
const range = (low, high) => value => Number.isFinite(value) && value >= low && value <= high;
const oneOf = list => value => list.includes(value);
const words = value => Number.isInteger(value) && value >= 1 && value <= 12;

J.CAPTION_TRACK_NAME_MAX = 40;

/* Per-track overrides of project.style. Empty = inherit. The motion/attention budget stays project-wide. */
J.CAPTION_TRACK_STYLE_FIELDS = Object.freeze({
  preset: value => typeof value === 'string' && !!J.CAPTION_STYLE_PROFILES && Object.prototype.hasOwnProperty.call(J.CAPTION_STYLE_PROFILES, value),
  captionTreatment: oneOf(['outline', 'neon', 'echo', 'backplate']),
  accentColor: value => typeof value === 'string' && HEX.test(value),
  alignment: oneOf(['left', 'center', 'right']),
  writingMode: oneOf(['horizontal', 'vertical']),
  motion: range(0, 1), intensity: range(0, 1), emphasisStrength: range(0, 1),
});
J.CAPTION_TRACK_SEGMENTATION_FIELDS = Object.freeze({ minWords: words, maxWords: words, targetWords: words });

/* Validate a track style and return a clean copy. With allowNull a null field means "clear it" (edits). */
J.normalizeCaptionTrackStyle = (input, allowNull = false) => {
  const out = {};
  if (input == null) return out;
  if (!plain(input)) throw styleError('Track style must be an object.');
  for (const [field, value] of Object.entries(input)) {
    if (field === 'look') {
      if (value == null && allowNull) { out.look = null; continue; }
      try { out.look = J.normalizeCaptionLook(value, allowNull); } catch (error) { throw styleError(error.message, error.details); }
      continue;
    }
    if (field === 'lookSettings') {
      if (value == null && allowNull) { out.lookSettings = null; continue; }
      try { out.lookSettings = J.normalizeCaptionLookSettings(value, allowNull); } catch (error) { throw styleError(error.message, error.details); }
      continue;
    }
    if (field === 'segmentation') {
      if (value == null && allowNull) { out.segmentation = null; continue; }
      if (!plain(value)) throw styleError('Track style "segmentation" must be an object.', { field });
      const seg = {};
      for (const [name, item] of Object.entries(value)) {
        const check = J.CAPTION_TRACK_SEGMENTATION_FIELDS[name];
        if (!check) throw styleError(`Track segmentation has no field "${name}".`, { field: name });
        if (item == null && allowNull) { seg[name] = null; continue; }
        if (!check(item)) throw styleError(`Track segmentation "${name}" must be a whole number from 1 to 12.`, { field: name, value: item });
        seg[name] = item;
      }
      if (Number.isFinite(seg.minWords) && Number.isFinite(seg.maxWords) && seg.minWords > seg.maxWords) throw styleError('Track segmentation minWords must not exceed maxWords.');
      out.segmentation = seg; continue;
    }
    const check = J.CAPTION_TRACK_STYLE_FIELDS[field];
    if (!check) throw styleError(`Track style has no field "${field}".`, { field });
    if (value == null && allowNull) { out[field] = null; continue; }
    if (!check(value)) throw styleError(`Track style field "${field}" has an invalid value.`, { field, value });
    out[field] = typeof value === 'string' && HEX.test(value) ? value.toLowerCase() : value;
  }
  return out;
};

/* Apply an edit (nulls clear a field, or the whole segmentation) on top of the stored style. */
J.mergeCaptionTrackStyle = (current, edit) => {
  const base = J.normalizeCaptionTrackStyle(current), patch = J.normalizeCaptionTrackStyle(edit, true);
  for (const [field, value] of Object.entries(patch)) {
    if (field === 'look') {
      if (value === null) { delete base.look; continue; }
      const look = J.mergeCaptionLook(base.look, value);
      if (Object.keys(look).length) base.look = look; else delete base.look;
      continue;
    }
    if (field === 'lookSettings') {
      if (value === null) { delete base.lookSettings; continue; }
      const settings = J.mergeCaptionLookSettings(base.lookSettings, value);
      if (Object.keys(settings).length) base.lookSettings = settings; else delete base.lookSettings;
      continue;
    }
    if (field === 'segmentation') {
      if (value === null) { delete base.segmentation; continue; }
      const seg = Object.assign({}, base.segmentation);
      for (const [name, item] of Object.entries(value)) { if (item === null) delete seg[name]; else seg[name] = item; }
      if (Number.isFinite(seg.minWords) && Number.isFinite(seg.maxWords) && seg.minWords > seg.maxWords) throw styleError('Track segmentation minWords must not exceed maxWords.');
      if (Object.keys(seg).length) base.segmentation = seg; else delete base.segmentation;
    } else if (value === null) delete base[field]; else base[field] = value;
  }
  return base;
};

/* Project style with the track's overrides on top (the planner then resolves the profile from the result). */
J.captionTrackProjectStyle = (project, track) => {
  const base = project && project.style, own = track && track.style;
  if (!plain(own) || !Object.keys(own).length) return base;
  const source = typeof base === 'string' ? { preset: base } : plain(base) ? base : {};
  const merged = Object.assign({}, source, own);
  if (own.segmentation) merged.segmentation = Object.assign({}, source.segmentation, own.segmentation);
  if (own.look) merged.look = Object.assign({}, source.look, own.look);
  if (own.lookSettings) merged.lookSettings = J.mergeCaptionLookSettings(source.lookSettings, own.lookSettings);
  if (own.preset) delete merged.profile;
  return merged;
};

/* ---------- segments across tracks ---------- */
const primaryId = () => J.CAPTION_PRIMARY_TRACK_ID;
const trackOf = segment => segment && segment.trackId || primaryId();

J.captionTrackSegments = (project, trackId) => (project && project.segments || []).filter(segment => trackOf(segment) === trackId);

/* Keep project.segments sorted by start, ties by track order (stable otherwise). */
J.captionSortSegments = project => {
  const order = new Map((project.tracks || []).map((track, index) => [track.id, index]));
  const rank = segment => order.has(trackOf(segment)) ? order.get(trackOf(segment)) : 0;
  project.segments = (project.segments || []).map((segment, index) => ({ segment, index }))
    .sort((a, b) => a.segment.start - b.segment.start || rank(a.segment) - rank(b.segment) || a.index - b.index).map(item => item.segment);
  return project.segments;
};

/* The next/previous segment of the same track (neighbours in one row of the timeline). */
J.captionTrackNeighbor = (project, segment, direction) => {
  const list = J.captionTrackSegments(project, trackOf(segment)), index = list.indexOf(segment);
  return index < 0 ? null : list[index + direction] || null;
};

/* Segments visible at `time`, in draw order (primary first, later tracks on top). One per track.
   Projects without tracks (bare test fixtures) behave as before: the first matching segment. */
J.captionSegmentsAt = (project, time) => {
  const segments = project && project.segments || [], visible = segment => time >= segment.start && time < segment.end;
  if (!Array.isArray(project && project.tracks) || !project.tracks.length) {
    const first = segments.find(visible); return first ? [first] : [];
  }
  const out = [];
  for (const track of project.tracks) { const found = segments.find(segment => trackOf(segment) === track.id && visible(segment)); if (found) out.push(found); }
  return out;
};

/* Tokens by track, in transcript order. A token no segment owns yet belongs to the primary track. */
J.captionTrackTokens = project => {
  const tracks = Array.isArray(project.tracks) && project.tracks.length ? project.tracks : [{ id: primaryId() }];
  const owner = new Map();
  for (const segment of project.segments || []) for (const id of segment.tokenIds || []) if (!owner.has(id)) owner.set(id, trackOf(segment));
  const groups = new Map(tracks.map(track => [track.id, []]));
  for (const token of project.transcript && project.transcript.tokens || []) (groups.get(owner.get(token.id)) || groups.get(tracks[0].id)).push(token);
  return groups;
};

/* ---------- new tracks ---------- */
J.nextCaptionTrackId = project => {
  const used = new Set((project.tracks || []).map(track => track.id));
  let value = 2, id;
  do { id = `track_${value++}`; } while (used.has(id));
  return id;
};

const frameOf = project => {
  const media = project && project.media;
  return media && media.width > 0 && media.height > 0 ? { width: media.width, height: media.height } : { width: 1080, height: 1920 };
};
const ZONE_KINDS = ['top', 'center', 'bottom'];

/* Where a track's box goes when it has never been edited (and where "reset" returns it). */
J.captionTrackDefaultBox = (project, track) => {
  if (!track || track.primary) return J.defaultCaptionTrack(project).box;
  const kind = ZONE_KINDS.includes(track.defaultKind) ? track.defaultKind : 'top';
  return J.captionZoneToBox(J.createCaptionZone(kind, frameOf(project)), frameOf(project));
};

J.newCaptionTrack = (project, options = {}) => {
  const used = new Set((project.tracks || []).map(track => track.box && track.box.zoneKind));
  const kind = ZONE_KINDS.includes(options.kind) ? options.kind : ZONE_KINDS.find(item => !used.has(item)) || 'top';
  const id = options.id || J.nextCaptionTrackId(project);
  const track = { id, name: '', primary: false, defaultKind: kind, box: null, style: {}, roles: { base: {}, active: {}, emphasis: {} } };
  track.box = J.captionTrackDefaultBox(project, track);
  return track;
};

/* Validate and normalise a display name: a trimmed, non-empty string of at most 40 characters. */
J.captionTrackName = value => {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name || Array.from(name).length > J.CAPTION_TRACK_NAME_MAX) throw new J.ProjectError('TRACK_NAME_INVALID', `Track name must be 1-${J.CAPTION_TRACK_NAME_MAX} characters.`, { name: value });
  return name;
};

/* ---------- warnings ---------- */
const MIN_OVERLAP = 0.002;
const boxesOverlap = (a, b) => Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > MIN_OVERLAP
  && Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > MIN_OVERLAP;

/* Two captions from different tracks that share screen time and screen area. Advisory: nothing is moved. */
J.captionBoxCollisions = project => {
  const segments = project && project.segments || [], found = [];
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      const a = segments[i], b = segments[j];
      if (b.start >= a.end) break; // segments are sorted by start, so nothing later can overlap `a`
      if (trackOf(a) === trackOf(b)) continue;
      const start = Math.max(a.start, b.start), end = Math.min(a.end, b.end);
      if (!(end - start > 1e-6)) continue;
      const boxA = J.captionEffectiveBox(project, a, project.plans && project.plans[a.id]), boxB = J.captionEffectiveBox(project, b, project.plans && project.plans[b.id]);
      if (boxA && boxB && boxesOverlap(boxA, boxB)) found.push({ code: 'track-box-collision', segmentId: a.id, otherSegmentId: b.id, trackId: trackOf(a), otherTrackId: trackOf(b), start, end });
    }
  }
  return found;
};

/* ---------- timing rules (rework plan E1, ADR 0010) ----------
   One place decides whether a caption may sit at [start, end] on a track; store commands use it and refuse,
   loading an old file only reports overlaps as warnings (existing projects must still open). */
J.CAPTION_MIN_SEGMENT_SECONDS = 0.1;
const TIMING_EPS = 1e-6;

/* { ok: true } or { ok: false, code, ... }. options.fit: the caption's words are re-timed with it, so they need not stay inside the window. */
J.captionSegmentFits = (project, segment, start, end, trackId, options = {}) => {
  const track = trackId == null ? trackOf(segment) : trackId;
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < -TIMING_EPS || end - start < J.CAPTION_MIN_SEGMENT_SECONDS - TIMING_EPS) {
    return { ok: false, code: 'SEGMENT_TIMING_INVALID', start, end };
  }
  const duration = project && project.media && project.media.duration;
  if (Number.isFinite(duration) && end > duration + TIMING_EPS) return { ok: false, code: 'SEGMENT_TIMING_INVALID', start, end, duration };
  for (const other of J.captionTrackSegments(project, track)) {
    if (other.id !== segment.id && start < other.end - TIMING_EPS && end > other.start + TIMING_EPS) return { ok: false, code: 'TRACK_SEGMENT_OVERLAP', otherSegmentId: other.id, trackId: track, start, end };
  }
  if (!options.fit) {
    const byId = new Map((project && project.transcript && project.transcript.tokens || []).map(token => [token.id, token]));
    for (const id of segment.tokenIds || []) {
      const token = byId.get(id);
      if (token && (token.start < start - TIMING_EPS || token.end > end + TIMING_EPS)) return { ok: false, code: 'SEGMENT_WORDS_OUTSIDE', tokenId: id, start, end };
    }
  }
  return { ok: true };
};

/* Captions of one track that share screen time. Advisory (shown on those captions); nothing is moved or refused. */
J.captionTrackOverlaps = project => {
  const found = [], byTrack = new Map();
  for (const segment of project && project.segments || []) {
    const lane = byTrack.get(trackOf(segment)) || (byTrack.set(trackOf(segment), []), byTrack.get(trackOf(segment)));
    for (const other of lane) {
      if (segment.start < other.end - TIMING_EPS && segment.end > other.start + TIMING_EPS) {
        found.push({ code: 'track-segment-overlap', segmentId: other.id, otherSegmentId: segment.id, trackId: trackOf(segment), start: Math.max(segment.start, other.start), end: Math.min(segment.end, other.end) });
      }
    }
    lane.push(segment);
  }
  return found;
};

/* An untouched track box follows the frame; an edited one stays exactly as set. */
J.captionSyncTrackBoxes = project => {
  if (!project || !Array.isArray(project.tracks)) return project;
  for (const track of project.tracks) if (!track.primary && !(track.box && track.box.manual === true)) track.box = J.captionTrackDefaultBox(project, track);
  return project;
};
})();
