/* ============================================================
   JIZURA — versioned project envelope and mode dispatch
   ============================================================ */
(() => {
'use strict';

J.PROJECT_SCHEMA_VERSION = 3;
J.CAPTION_PRIMARY_TRACK_ID = 'track_main';
J.CAPTION_MAX_TRACKS = 3;
J.PROJECT_GENERATOR_VERSION = '@VERSION@';
J.PROJECT_MODES = Object.freeze(['lyrics', 'video-captions']);

class ProjectError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'ProjectError';
    this.code = code;
    if (details) Object.assign(this, details);
  }
}
J.ProjectError = ProjectError;

const fail = (code, message, details) => { throw new ProjectError(code, message, details); };
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));

/* Only the pre-envelope lyric format needs migration today. Keep migrations
   explicit so later schema changes cannot silently reinterpret user data. */
J.projectMigrations = Object.freeze({
  legacyLyrics(project) {
    const migrated = clone(project);
    migrated.schemaVersion = J.PROJECT_SCHEMA_VERSION;
    migrated.generatorVersion = typeof migrated.appVersion === 'string'
      ? migrated.appVersion : J.PROJECT_GENERATOR_VERSION;
    migrated.mode = 'lyrics';
    return migrated;
  },
  /* v2 -> v3. Lyric projects only change version. Caption projects gain one
     primary track whose box is the zone the planner already used, advisory
     guides mirroring the pixel safe zones, and a trackId on every segment/plan.
     Nothing is re-planned, so existing projects render identically. */
  v2ToV3(project) {
    const migrated = clone(project);
    migrated.schemaVersion = 3;
    if (migrated.mode !== 'video-captions') return migrated;
    const primary = J.CAPTION_PRIMARY_TRACK_ID;
    migrated.tracks = [J.defaultCaptionTrack(migrated)];
    migrated.guides = J.captionGuidesFromZones(migrated);
    for (const segment of Array.isArray(migrated.segments) ? migrated.segments : []) if (plainObject(segment) && segment.trackId == null) segment.trackId = primary;
    for (const plan of Object.values(plainObject(migrated.plans) ? migrated.plans : {})) if (plainObject(plan) && plan.trackId == null) plan.trackId = primary;
    return migrated;
  },
});

const round9 = value => Math.round(value * 1e9) / 1e9;
const FALLBACK_FRAME = Object.freeze({ width: 1080, height: 1920 });
/* Boxes, guides and safe areas live in the OUTPUT frame (the post format the preview and export use), not in the source video's frame:
   a landscape video posted as a 9:16 Short has to be placed inside the Shorts safe area. */
const frameOf = project => {
  const out = project && J.videoOutputSize ? J.videoOutputSize(project) : null;
  if (out && out.width > 0 && out.height > 0) return { width: out.width, height: out.height };
  const media = project && project.media;
  return media && media.width > 0 && media.height > 0 ? { width: media.width, height: media.height } : FALLBACK_FRAME;
};
const normalizedRect = (rect, frame) => ({
  x: round9(rect.x / frame.width), y: round9(rect.y / frame.height),
  width: round9(rect.width / frame.width), height: round9(rect.height / frame.height),
});

/* Pixel safe zones become advisory, normalized guides (they no longer decide placement). */
J.captionGuidesFromZones = project => {
  const frame = frameOf(project), guides = [];
  for (const zone of Array.isArray(project.safeZones) ? project.safeZones : []) {
    if (!plainObject(zone) || typeof zone.id !== 'string' || !zone.id) continue;
    if (!['x', 'y', 'width', 'height'].every(field => Number.isFinite(zone[field])) || zone.width <= 0 || zone.height <= 0) continue;
    guides.push(Object.assign({ id: zone.id, kind: zone.kind || 'custom', advisory: true }, normalizedRect(zone, frame)));
  }
  return guides;
};

/* The primary track's box is the first zone the planner would consider today. */
J.defaultCaptionTrack = project => {
  const frame = frameOf(project);
  let zone = null;
  try { zone = typeof J.captionProjectZones === 'function' ? J.captionProjectZones(project, frame)[0] : null; } catch (_) { zone = null; }
  if (!zone) zone = J.createCaptionZone('bottom', frame);
  return {
    id: J.CAPTION_PRIMARY_TRACK_ID, name: 'Main', primary: true,
    box: Object.assign(normalizedRect(zone, frame), { zoneKind: zone.kind }),
    style: {},                                     // empty = inherit project.style (today's look)
    roles: { base: {}, active: {}, emphasis: {} }, // empty = inherit the plan's resolved fields
  };
};

J.validateProject = project => {
  if (!plainObject(project)) fail('PROJECT_NOT_OBJECT', 'Project data must be a JSON object.');
  if (!Number.isInteger(project.schemaVersion)) {
    fail('SCHEMA_VERSION_REQUIRED', 'Project schemaVersion must be an integer.');
  }
  if (project.schemaVersion !== J.PROJECT_SCHEMA_VERSION) {
    fail('UNSUPPORTED_SCHEMA_VERSION',
      `Project schema version ${project.schemaVersion} is not supported (expected ${J.PROJECT_SCHEMA_VERSION}).`,
      { schemaVersion: project.schemaVersion, supportedSchemaVersion: J.PROJECT_SCHEMA_VERSION });
  }
  if (!J.PROJECT_MODES.includes(project.mode)) {
    fail('UNSUPPORTED_PROJECT_MODE', `Project mode "${String(project.mode)}" is not supported.`, { mode: project.mode });
  }
  if (typeof project.generatorVersion !== 'string' || !project.generatorVersion.trim()) {
    fail('GENERATOR_VERSION_REQUIRED', 'Project generatorVersion must be a non-empty string.');
  }
  if (project.mode === 'video-captions' && (typeof project.id !== 'string' || !project.id.trim())) {
    fail('PROJECT_ID_REQUIRED', 'Video caption projects require a non-empty id.');
  }
  if (project.mode === 'video-captions' && project.transcript != null && typeof J.validateTranscript === 'function') {
    const duration = project.media && Number.isFinite(project.media.duration) ? project.media.duration : undefined;
    J.validateTranscript(project.transcript, { duration });
  }
  if (project.mode === 'video-captions' && typeof J.validateCaptionProject === 'function') J.validateCaptionProject(project);
  return project;
};

J.loadProject = input => {
  let parsed;
  if (typeof input === 'string') {
    try { parsed = JSON.parse(input); }
    catch (error) { fail('PROJECT_JSON_INVALID', `Project JSON is invalid: ${error.message}`); }
  } else parsed = input;
  if (!plainObject(parsed)) fail('PROJECT_NOT_OBJECT', 'Project data must be a JSON object.');

  /* Reject versioned future input before cloning or migration. This makes the
     no-mutation guarantee independent of any later migration implementation. */
  if (Number.isInteger(parsed.schemaVersion) && parsed.schemaVersion > J.PROJECT_SCHEMA_VERSION) {
    fail('UNSUPPORTED_SCHEMA_VERSION',
      `Project schema version ${parsed.schemaVersion} is newer than this JIZURA build.`,
      { schemaVersion: parsed.schemaVersion, supportedSchemaVersion: J.PROJECT_SCHEMA_VERSION });
  }

  const legacy = parsed.schemaVersion == null && parsed.mode == null;
  if (legacy) {
    if (parsed.version != null && parsed.version !== 1) {
      fail('UNSUPPORTED_LEGACY_VERSION', `Legacy lyric project version ${parsed.version} is not supported.`, { version: parsed.version });
    }
    return J.validateProject(J.projectMigrations.legacyLyrics(parsed));
  }
  const loaded = parsed.schemaVersion === 2 ? J.projectMigrations.v2ToV3(parsed) : clone(parsed);
  J.validateProject(loaded);
  return loaded;
};

J.saveProject = project => {
  const saved = clone(project);
  /* Runtime media state (File, video element, object URL) must never enter a
     project document. Gate 4's media module owns the persisted reference. */
  if (saved && saved.mode === 'video-captions' && typeof J.mediaProjectReference === 'function') {
    const importedSource = saved.media && typeof saved.media.fingerprint === 'string' && saved.media.fingerprint;
    saved.media = J.mediaProjectReference(saved.media, importedSource ? true : undefined);
  }
  return JSON.stringify(J.validateProject(saved), null, 1);
};

/* Preserve the established lyric planner byte-for-byte and make caption
   planning an explicit extension point for the later caption gates. */
J.planLyrics = J.plan;
J.plan = (project, media) => {
  const mode = project && project.mode ? project.mode : 'lyrics';
  if (mode === 'lyrics') return J.planLyrics(project, media);
  if (mode === 'video-captions') {
    if (typeof J.planCaptions === 'function') return J.planCaptions(project, media);
    fail('CAPTION_PLANNER_UNAVAILABLE', 'Video caption planning is not available in this build.');
  }
  fail('UNSUPPORTED_PROJECT_MODE', `Project mode "${String(mode)}" is not supported.`, { mode });
};
})();
