/* ============================================================
   JIZURA — versioned project envelope and mode dispatch
   ============================================================ */
(() => {
'use strict';

J.PROJECT_SCHEMA_VERSION = 2;
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
});

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
  const loaded = clone(parsed);
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
