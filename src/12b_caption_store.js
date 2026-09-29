/* ============================================================
   JIZURA — caption project command store with exact undo / redo
   ============================================================ */
(() => {
'use strict';

const clone = value => JSON.parse(JSON.stringify(value));
const plainObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message, details) => {
  if (J.ProjectError) throw new J.ProjectError(code, message, details);
  const error = new Error(message); error.code = code; Object.assign(error, details || {}); throw error;
};
const segmentLocks = segment => {
  const source = plainObject(segment.locks) ? segment.locks : {};
  return {
    segmentation: source.segmentation === true,
    visualPlan: source.visualPlan === true,
    fields: Array.isArray(source.fields) ? source.fields.filter(field => typeof field === 'string') : [],
  };
};

const CAPTION_TECHNIQUE_SETS = ['extra', 'wa', 'typo', 'kinetic', 'horror'];
const CAPTION_PROFILE_LIST = { layout: 'layouts', enter: 'entrances', hold: 'holds', exit: 'exits' };

// Preset arrays are the profile lists. styleFor also copies style fields onto its result.
const captionProfileKey = project => {
  const source = project && project.style || {};
  const key = typeof source === 'string' ? source : (source.preset || source.profile || 'creator');
  const normalized = key === 'jizura' || key === 'mv' ? 'jizura-mv' : key;
  const profiles = J.CAPTION_STYLE_PROFILES || {};
  return Object.prototype.hasOwnProperty.call(profiles, normalized) ? normalized : 'creator';
};
const captionProfileList = (project, group) => {
  const field = CAPTION_PROFILE_LIST[group];
  if (!field) return null;
  const profile = (J.CAPTION_STYLE_PROFILES || {})[captionProfileKey(project)];
  const list = profile && profile[field];
  return Array.isArray(list) ? list : [];
};

J.captionTechniques = project => {
  const source = project && plainObject(project.techniques) ? project.techniques : {};
  const filled = {};
  for (const name of CAPTION_TECHNIQUE_SETS) filled[name] = source[name] === true;
  const enabledSource = plainObject(source.enabled) ? source.enabled : {};
  filled.enabled = {};
  for (const group of J.GROUP_KEYS) {
    const groupSource = enabledSource[group];
    const map = {};
    if (plainObject(groupSource)) {
      for (const id of Object.keys(groupSource)) if (typeof groupSource[id] === 'boolean') map[id] = groupSource[id];
    }
    filled.enabled[group] = map;
  }
  return filled;
};

/* The advanced editor offers every effect of the groups a caption can draw, except the background (the video is the background).
   The simple editor stays on the caption-safe set. */
J.CAPTION_ADVANCED_GROUPS = Object.freeze(['layout', 'enter', 'hold', 'exit', 'treat']);
J.isCaptionPackDef = def => !!def && typeof def.pack === 'string' && def.pack.startsWith('caption-');
J.captionAdvancedOpen = (project, group) => !!(project && project.style && project.style.editor === 'advanced') && group !== 'bg';
J.captionTechniqueOn = (project, group, id) => {
  const explicit = J.captionTechniques(project).enabled[group];
  if (explicit && typeof explicit[id] === 'boolean') return explicit[id];
  if (!J.GROUP_KEYS.includes(group)) return false;
  const registry = J.registry(group);
  const def = registry[id];
  if (!def || !Object.prototype.hasOwnProperty.call(registry, id)) return false;
  // Advanced opens every effect; for layouts only the caption packs' own (the compositor cannot draw Lyric Motion layouts).
  if (J.captionAdvancedOpen(project, group) && !def.special && (group !== 'layout' || J.isCaptionPackDef(def))) return true;
  if (!def.capabilities || def.capabilities.captionSafe !== true) return false;
  const listed = captionProfileList(project, group);
  if (listed == null) return true;
  return listed.includes(id);
};

const validateCaptionTracks = project => {
  const tracks = project.tracks;
  if (!Array.isArray(tracks) || !tracks.length) fail('TRACKS_REQUIRED', 'Caption projects require at least one track.');
  if (tracks.length > J.CAPTION_MAX_TRACKS) fail('TRACKS_LIMIT', `Caption projects allow at most ${J.CAPTION_MAX_TRACKS} tracks.`, { count: tracks.length });
  const ids = new Set();
  for (const track of tracks) {
    if (!plainObject(track) || typeof track.id !== 'string' || !track.id) fail('TRACK_ID_REQUIRED', 'Every track requires an id.');
    if (ids.has(track.id)) fail('TRACK_ID_DUPLICATE', `Track id "${track.id}" is duplicated.`, { trackId: track.id });
    ids.add(track.id);
    const box = track.box;
    if (!plainObject(box) || !['x', 'y', 'width', 'height'].every(field => Number.isFinite(box[field]))
      || box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 || box.x + box.width > 1 + 1e-6 || box.y + box.height > 1 + 1e-6) {
      fail('TRACK_BOX_INVALID', `Track "${track.id}" requires a normalized (0-1) box inside the frame.`, { trackId: track.id });
    }
    if (track.roles !== undefined && J.normalizeCaptionRoles) J.normalizeCaptionRoles(track.roles);
    if (track.style !== undefined && J.normalizeCaptionTrackStyle) J.normalizeCaptionTrackStyle(track.style);
  }
  const primaries = tracks.filter(track => track.primary === true);
  if (primaries.length !== 1 || tracks[0] !== primaries[0]) fail('TRACK_PRIMARY_INVALID', 'Exactly one primary track is required and it must be first.');
  return ids;
};

J.validateCaptionProject = project => {
  if (!project || project.mode !== 'video-captions') return project;
  if (project.settings && project.settings.videoEdit && J.validateVideoEdits) J.validateVideoEdits(project.settings.videoEdit, project.media.duration);
  const trackIds = validateCaptionTracks(project);
  const tokens = project.transcript && Array.isArray(project.transcript.tokens) ? project.transcript.tokens : [];
  const tokenIds = new Set(tokens.map(token => token.id));
  const segmentIds = new Set(), tokenOwners = new Map();
  let previous = null;
  for (let index = 0; index < (project.segments || []).length; index++) {
    const segment = project.segments[index];
    if (!plainObject(segment) || typeof segment.id !== 'string' || !segment.id) fail('SEGMENT_ID_REQUIRED', `Segment at index ${index} requires an id.`, { segmentIndex: index });
    if (segmentIds.has(segment.id)) fail('SEGMENT_ID_DUPLICATE', `Segment id "${segment.id}" is duplicated.`, { segmentId: segment.id, segmentIndex: index });
    segmentIds.add(segment.id);
    if (!trackIds.has(segment.trackId)) fail('SEGMENT_TRACK_NOT_FOUND', `Segment "${segment.id}" references missing track "${String(segment.trackId)}".`, { segmentId: segment.id, trackId: segment.trackId });
    if (!Array.isArray(segment.tokenIds) || !segment.tokenIds.length) fail('SEGMENT_TOKENS_REQUIRED', `Segment "${segment.id}" requires token IDs.`, { segmentId: segment.id });
    for (const tokenId of segment.tokenIds) {
      if (!tokenIds.has(tokenId)) fail('SEGMENT_TOKEN_NOT_FOUND', `Segment "${segment.id}" references missing token "${tokenId}".`, { segmentId: segment.id, tokenId });
      // A token is shown once: in exactly one segment of one track (echoing a word across tracks is out of scope).
      if (tokenOwners.has(tokenId)) fail('SEGMENT_TOKEN_DUPLICATE', `Token "${tokenId}" is in both "${tokenOwners.get(tokenId)}" and "${segment.id}".`, { tokenId, segmentId: segment.id, otherSegmentId: tokenOwners.get(tokenId) });
      tokenOwners.set(tokenId, segment.id);
    }
    if (!Number.isFinite(segment.start) || segment.start < 0 || !Number.isFinite(segment.end) || segment.end < segment.start) {
      fail('SEGMENT_TIMING_INVALID', `Segment "${segment.id}" has invalid timing.`, { segmentId: segment.id, start: segment.start, end: segment.end });
    }
    if (previous && segment.start < previous.start) fail('SEGMENT_ORDER_INVALID', `Segment "${segment.id}" is out of order.`, { segmentId: segment.id, previousSegmentId: previous.id });
    previous = segment;
  }
  const advancedOpen = J.captionAdvancedOpen(project, 'enter');
  for (const [segmentId, plan] of Object.entries(project.plans || {})) {
    if (!segmentIds.has(segmentId)) fail('PLAN_SEGMENT_NOT_FOUND', `Plan references missing segment "${segmentId}".`, { segmentId });
    const owner = project.segments.find(item => item.id === segmentId);
    if (plan && plan.manual && plan.manual.box !== undefined && !J.isCaptionBox(plan.manual.box)) fail('PLAN_BOX_INVALID', `Plan "${segmentId}" has an invalid box override.`, { segmentId });
    if (plan && plan.manual && J.CAPTION_TEXT_BLOCK_ANIMATION) for (const [key, spec] of Object.entries(J.CAPTION_TEXT_BLOCK_ANIMATION)) {
      const id = plan.manual[spec.field];
      if (id !== undefined && (typeof id !== 'string' || !J.registry || !J.registry(spec.group)[id] || !advancedOpen && !J.captionComponentEligibility(spec.group, id, {}).allowed)) fail('CAPTION_TECHNIQUE_UNSAFE', `Segment "${segmentId}" uses unsafe ${key} preset "${String(id)}".`, { segmentId, componentId: id });
    }
    if (plan && plan.trackId !== owner.trackId) fail('PLAN_TRACK_MISMATCH', `Plan "${segmentId}" belongs to track "${String(plan.trackId)}" but its segment is on "${owner.trackId}".`, { segmentId, trackId: plan.trackId });
    if (plan && plan.metadata && plan.metadata.captionSafe !== true && !advancedOpen) {
      const componentId = plan.entrance || plan.enter || plan.layout || 'unknown';
      fail('CAPTION_TECHNIQUE_UNSAFE', `Segment "${segmentId}" uses unsafe component "${componentId}".`, { segmentId, componentId });
    }
    const refs = [
      ['layout', plan && plan.layout], ['enter', plan && (plan.entrance || plan.enter)],
      ['hold', plan && plan.hold], ['exit', plan && plan.exit], ['treat', plan && (plan.treatment || plan.treat)],
    ];
    for (const [group, componentId] of refs) {
      if (!componentId || !J.registry || !J.registry(group)[componentId]) continue;
      const eligible = J.captionComponentEligibility(group, componentId, {});
      if (!eligible.allowed && !(advancedOpen && group !== 'layout')) fail('CAPTION_TECHNIQUE_UNSAFE', `Segment "${segmentId}" uses unsafe component "${componentId}".`, { segmentId, componentId, reason: eligible.code });
    }
  }
  return project;
};

class CaptionStore {
  constructor(project, options = {}) {
    const loaded = J.loadProject(project);
    if (loaded.mode !== 'video-captions') fail('CAPTION_PROJECT_REQUIRED', 'CaptionStore requires a video-captions project.');
    this.project = loaded;
    this.undoStack = [];
    this.redoStack = [];
    this.historyLimit = Number.isInteger(options.historyLimit) && options.historyLimit > 0 ? options.historyLimit : 100;
  }

  snapshot() { return clone(this.project); }
  serialize() { return J.saveProject(this.project); }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  execute(command) {
    if (!plainObject(command) || typeof command.type !== 'string') fail('COMMAND_INVALID', 'Caption command requires a type.');
    const before = this.snapshot();
    try {
      this.apply(command);
      J.validateProject(this.project);
    } catch (error) {
      this.project = before;
      throw error;
    }
    const after = this.snapshot();
    this.undoStack.push({ command: clone(command), before, after });
    if (this.undoStack.length > this.historyLimit) this.undoStack.shift();
    this.redoStack.length = 0;
    return this.project;
  }

  undo() {
    const entry = this.undoStack.pop();
    if (!entry) return false;
    this.project = clone(entry.before); this.redoStack.push(entry); return true;
  }

  redo() {
    const entry = this.redoStack.pop();
    if (!entry) return false;
    this.project = clone(entry.after); this.undoStack.push(entry); return true;
  }

  token(tokenId) {
    const token = this.project.transcript.tokens.find(item => item.id === tokenId);
    if (!token) fail('TOKEN_NOT_FOUND', `Token "${tokenId}" was not found.`, { tokenId });
    return token;
  }

  assertTokenFieldUnlocked(tokenId, field) {
    for (const segment of this.project.segments.filter(item => item.tokenIds.includes(tokenId))) {
      const locks = segmentLocks(segment);
      if (locks.fields.includes(field)) fail('SEGMENT_FIELD_LOCKED', `Segment "${segment.id}" field "${field}" is locked.`, { segmentId: segment.id, field, tokenId });
    }
  }

  segment(segmentId) {
    const index = this.project.segments.findIndex(item => item.id === segmentId);
    if (index < 0) fail('SEGMENT_NOT_FOUND', `Segment "${segmentId}" was not found.`, { segmentId });
    return { segment: this.project.segments[index], index };
  }

  assertUnlocked(segment, field, lock = 'fields') {
    const locks = segmentLocks(segment);
    const blocked = lock === 'segmentation' ? locks.segmentation : lock === 'visualPlan' ? locks.visualPlan : locks.fields.includes(field);
    if (blocked) fail('SEGMENT_FIELD_LOCKED', `Segment "${segment.id}" field "${field}" is locked.`, { segmentId: segment.id, field });
  }

  nextSegmentId() {
    const used = new Set(this.project.segments.map(segment => segment.id));
    let value = 1, id;
    do { id = `segment_${String(value++).padStart(6, '0')}`; } while (used.has(id));
    return id;
  }

  apply(command) {
    switch (command.type) {
      case 'set-video-edits': {
        J.validateVideoEdits(command.value, this.project.media.duration);
        this.project.settings = this.project.settings || {};
        const before = J.videoOutputSize(this.project);
        this.project.settings.videoEdit = clone(command.value);
        J.captionSyncDefaultBoxes(this.project);   // the untouched default box follows the output format's safe area
        // Fit and readability are measured in the output frame, so a new shape re-plans (manual and locked values stay).
        const after = J.videoOutputSize(this.project);
        if ((before.width !== after.width || before.height !== after.height) && this.project.transcript.tokens.length && J.planCaptions) this.project.plans = J.planCaptions(this.project, this.project.media).plans;
        break;
      }
      case 'set-caption-style': {
        if (!plainObject(command.style)) fail('CAPTION_STYLE_INVALID', 'Caption style requires an object.');
        this.project.style = clone(command.style);
        J.captionSyncDefaultBoxes(this.project);
        if (this.project.transcript.tokens.length) this.project.plans = J.planCaptions(this.project, this.project.media).plans;
        break;
      }
      // add-caption is the original manual entry; it now creates a text block (primary track unless trackId is given).
      case 'add-caption':
      case 'create-text-block': this.createTextBlock(command); break;
      case 'edit-text-block': this.editTextBlock(command); break;
      case 'delete-text-block': this.deleteTextBlock(command); break;
      case 'edit-token-text': {
        const token = this.token(command.tokenId);
        this.assertTokenFieldUnlocked(command.tokenId, 'tokenText');
        if (typeof command.text !== 'string' || !command.text) fail('TOKEN_TEXT_REQUIRED', `Token "${command.tokenId}" requires display text.`, { tokenId: command.tokenId });
        token.text = command.text;
        token.normalizedText = J.normalizeTokenText(command.text);
        break;
      }
      case 'set-manual-emphasis': {
        const token = this.token(command.tokenId);
        this.assertTokenFieldUnlocked(command.tokenId, 'manualEmphasis');
        token.manualEmphasis = command.value == null ? null : clone(command.value);
        break;
      }
      case 'split-segment': this.splitSegment(command); break;
      case 'merge-segments': this.mergeSegments(command); break;
      case 'set-segment-timing': {
        const { segment } = this.segment(command.segmentId);
        this.assertUnlocked(segment, 'timing');
        if (command.start !== undefined) { this.assertUnlocked(segment, 'start'); segment.start = Number(command.start); }
        if (command.end !== undefined) { this.assertUnlocked(segment, 'end'); segment.end = Number(command.end); }
        if (command.boundarySource !== undefined) { this.assertUnlocked(segment, 'boundarySource'); segment.boundarySource = String(command.boundarySource); }
        if (command.boundaryReasons !== undefined) { this.assertUnlocked(segment, 'boundaryReasons'); segment.boundaryReasons = clone(command.boundaryReasons); }
        break;
      }
      case 'set-segment-boundary': {
        const leftInfo = this.segment(command.segmentId), right = J.captionTrackNeighbor(this.project, leftInfo.segment, 1);
        if (!right) fail('SEGMENT_BOUNDARY_LAST', 'The final segment has no following boundary.', { segmentId: command.segmentId });
        this.assertUnlocked(leftInfo.segment, 'segmentation', 'segmentation'); this.assertUnlocked(right, 'segmentation', 'segmentation');
        const leftToken = this.token(leftInfo.segment.tokenIds[leftInfo.segment.tokenIds.length - 1]), rightToken = this.token(right.tokenIds[0]), boundary = Number(command.time);
        if (!Number.isFinite(boundary) || boundary < leftToken.end || boundary > rightToken.start) fail('SEGMENT_BOUNDARY_CONSTRAINT', 'Boundary must stay between neighboring token timings.', { segmentId: command.segmentId, min: leftToken.end, max: rightToken.start });
        leftInfo.segment.end = boundary; right.start = boundary; leftInfo.segment.boundarySource = 'manual'; right.boundarySource = 'manual'; break;
      }
      case 'set-safe-zone': this.setSafeZone(command); break;
      case 'set-track-box': this.setTrackBox(command); break;
      case 'set-segment-box': this.setSegmentBox(command); break;
      case 'set-track-roles': this.setTrackRoles(command); break;
      case 'set-track-style': this.setTrackStyle(command); break;
      case 'add-track': this.addTrack(command); break;
      case 'remove-track': this.removeTrack(command); break;
      case 'rename-track': this.renameTrack(command); break;
      case 'reorder-track': this.reorderTrack(command); break;
      case 'move-segment-to-track': this.moveSegmentToTrack(command); break;
      case 'move-tokens-to-track': this.moveTokensToTrack(command); break;
      case 'set-caption-look': this.setCaptionLook(command); break;
      case 'set-segment-look': this.setSegmentLook(command); break;
      case 'randomize-caption-look': this.randomizeCaptionLook(command); break;
      case 'reroll-track': this.rerollTrack(command); break;
      case 'set-visual-override': this.setVisualOverride(command); break;
      case 'set-segment-lock': this.setSegmentLock(command); break;
      case 'set-segment-locks': {
        const { segment } = this.segment(command.segmentId); segment.locks = segmentLocks(segment);
        segment.locks.segmentation = command.locked !== false; segment.locks.visualPlan = command.locked !== false; break;
      }
      case 'set-segment-animation-disabled': {
        const { segment } = this.segment(command.segmentId); this.assertUnlocked(segment, 'animationDisabled'); this.assertUnlocked(segment, 'animationDisabled', 'visualPlan');
        if (!plainObject(this.project.plans)) this.project.plans = {};
        const plan = this.project.plans[segment.id] || (this.project.plans[segment.id] = { id: `plan_${segment.id}`, segmentId: segment.id, trackId: segment.trackId || J.CAPTION_PRIMARY_TRACK_ID, generated: {}, manual: {}, lockedFields: [] });
        if (!plainObject(plan.manual)) plan.manual = {}; plan.manual.animationDisabled = command.disabled !== false; break;
      }
      case 'set-project-setting': {
        if (typeof command.field !== 'string' || !command.field) fail('PROJECT_SETTING_INVALID', 'Project setting requires a field name.');
        if (!plainObject(this.project.settings)) this.project.settings = {}; this.project.settings[command.field] = clone(command.value); break;
      }
      case 'set-field-lock': this.setFieldLock(command); break;
      case 'reroll-segment': this.randomizeCaptionLook({ segmentId: command.segmentId, variation: command.variation }); break;
      case 'set-technique': this.setTechnique(command); break;
      default: fail('COMMAND_UNKNOWN', `Unknown caption command "${command.type}".`, { commandType: command.type });
    }
    if (this.project.tracks.length > 1) J.captionSortSegments(this.project);
    this.project.updatedAt = command.updatedAt || new Date().toISOString();
  }

  setTechnique(command) {
    const hasSet = command.set !== undefined || command.value !== undefined;
    const hasGroup = command.group !== undefined || command.entries !== undefined;
    if (hasSet === hasGroup) fail('TECHNIQUE_COMMAND_INVALID', 'set-technique accepts a set and value, or a group and entries.');
    if (hasSet) {
      if (!CAPTION_TECHNIQUE_SETS.includes(command.set)) fail('TECHNIQUE_SET_UNKNOWN', `Unknown technique set "${String(command.set)}".`, { set: command.set });
      if (typeof command.value !== 'boolean') fail('TECHNIQUE_VALUE_INVALID', 'Technique set value must be a boolean.', { set: command.set });
      if (!plainObject(this.project.techniques)) this.project.techniques = {};
      this.project.techniques[command.set] = command.value;
      return;
    }
    if (!J.GROUP_KEYS.includes(command.group)) fail('TECHNIQUE_GROUP_UNKNOWN', `Unknown technique group "${String(command.group)}".`, { group: command.group });
    if (!plainObject(command.entries)) fail('TECHNIQUE_COMMAND_INVALID', 'Technique entries must be an object.', { group: command.group });
    const registry = J.registry(command.group);
    const ids = Object.keys(command.entries);
    for (const id of ids) {
      if (typeof command.entries[id] !== 'boolean') fail('TECHNIQUE_VALUE_INVALID', `Technique "${id}" requires a boolean.`, { group: command.group, componentId: id });
      if (!Object.prototype.hasOwnProperty.call(registry, id)) fail('TECHNIQUE_ID_UNKNOWN', `Unknown technique "${id}" in group "${command.group}".`, { group: command.group, componentId: id });
    }
    if (!plainObject(this.project.techniques)) this.project.techniques = {};
    if (!plainObject(this.project.techniques.enabled)) this.project.techniques.enabled = {};
    if (!plainObject(this.project.techniques.enabled[command.group])) this.project.techniques.enabled[command.group] = {};
    for (const id of ids) this.project.techniques.enabled[command.group][id] = command.entries[id];
  }

  splitSegment(command) {
    const { segment, index } = this.segment(command.segmentId);
    this.assertUnlocked(segment, 'segmentation', 'segmentation');
    const splitIndex = command.beforeTokenId != null ? segment.tokenIds.indexOf(command.beforeTokenId) : Number(command.splitIndex);
    if (!Number.isInteger(splitIndex) || splitIndex <= 0 || splitIndex >= segment.tokenIds.length) {
      fail('SEGMENT_SPLIT_INVALID', `Segment "${segment.id}" split must leave tokens on both sides.`, { segmentId: segment.id });
    }
    const leftIds = segment.tokenIds.slice(0, splitIndex), rightIds = segment.tokenIds.slice(splitIndex);
    const leftLast = this.token(leftIds[leftIds.length - 1]), rightFirst = this.token(rightIds[0]);
    const boundary = command.boundaryTime == null ? (leftLast.end + rightFirst.start) / 2 : Number(command.boundaryTime);
    const rightId = command.newSegmentId || this.nextSegmentId();
    if (this.project.segments.some(item => item.id === rightId)) fail('SEGMENT_ID_DUPLICATE', `Segment id "${rightId}" is duplicated.`, { segmentId: rightId });
    const oldEnd = segment.end;
    segment.tokenIds = leftIds; segment.end = boundary;
    segment.boundarySource = command.boundarySource || 'manual';
    const right = Object.assign({}, clone(segment), {
      id: rightId, tokenIds: rightIds, start: boundary, end: oldEnd,
      boundarySource: command.boundarySource || 'manual',
    });
    this.project.segments.splice(index + 1, 0, right);
    J.captionSortSegments(this.project);
    if (this.project.plans && this.project.plans[segment.id]) {
      this.project.plans[rightId] = clone(this.project.plans[segment.id]);
      this.project.plans[rightId].id = `plan_${rightId}`; this.project.plans[rightId].segmentId = rightId;
    }
  }

  mergeSegments(command) {
    const firstInfo = this.segment(command.segmentId);
    const neighbor = J.captionTrackNeighbor(this.project, firstInfo.segment, 1);
    const secondInfo = command.nextSegmentId ? this.segment(command.nextSegmentId) : { segment: neighbor, index: neighbor ? this.project.segments.indexOf(neighbor) : -1 };
    if (!secondInfo.segment || secondInfo.segment !== neighbor) fail('SEGMENTS_NOT_ADJACENT', 'Only adjacent segments can be merged.', { segmentId: command.segmentId, nextSegmentId: command.nextSegmentId });
    this.assertUnlocked(firstInfo.segment, 'segmentation', 'segmentation'); this.assertUnlocked(secondInfo.segment, 'segmentation', 'segmentation');
    firstInfo.segment.tokenIds = firstInfo.segment.tokenIds.concat(secondInfo.segment.tokenIds);
    firstInfo.segment.end = secondInfo.segment.end;
    firstInfo.segment.boundarySource = command.boundarySource || 'manual';
    this.project.segments.splice(secondInfo.index, 1);
    if (this.project.plans) delete this.project.plans[secondInfo.segment.id];
  }

  setSafeZone(command) {
    if (!Array.isArray(this.project.safeZones)) this.project.safeZones = [];
    if (typeof command.zoneId !== 'string' || !command.zoneId) fail('SAFE_ZONE_ID_REQUIRED', 'Safe zone command requires zoneId.');
    const index = this.project.safeZones.findIndex(zone => zone.id === command.zoneId);
    if (command.remove) { if (index >= 0) this.project.safeZones.splice(index, 1); this.project.guides = J.captionGuidesFromZones(this.project); return; }
    if (!plainObject(command.value)) fail('SAFE_ZONE_INVALID', `Safe zone "${command.zoneId}" requires an object value.`, { zoneId: command.zoneId });
    const zone = Object.assign({}, clone(command.value), { id: command.zoneId });
    if (index >= 0) this.project.safeZones[index] = zone; else this.project.safeZones.push(zone);
    this.project.guides = J.captionGuidesFromZones(this.project);
  }

  /* Placement is block-level and normalized. Track box = default for the track's captions;
     a segment box overrides it. Both re-plan (readability, warnings) but never move text silently. */
  replanAfterPlacement() {
    if (this.project.transcript.tokens.length && this.project.segments.length) this.project.plans = J.planCaptions(this.project, this.project.media).plans;
  }

  setTrackBox(command) {
    const track = J.captionTrack(this.project, command.trackId);
    if (!track) fail('TRACK_NOT_FOUND', `Track "${String(command.trackId)}" was not found.`, { trackId: command.trackId });
    if (command.reset === true) { track.box = J.defaultCaptionTrack(this.project).box; }
    else {
      if (!J.isCaptionBox(command.box)) fail('CAPTION_BOX_INVALID', 'Track box must be a normalized (0-1) rectangle inside the frame.', { trackId: track.id });
      const box = J.roundCaptionBox(command.box);
      track.box = Object.assign(box, { zoneKind: 'custom', manual: true });
    }
    this.replanAfterPlacement();
  }

  /* Roles: { trackId, roles } merges (null clears a field or a whole role); { trackId, reset: true } clears all.
     Only the base role changes what fits, so only it re-plans; active/emphasis are drawn from the track at render time. */
  setTrackRoles(command) {
    const track = J.captionTrack(this.project, command.trackId);
    if (!track) fail('TRACK_NOT_FOUND', `Track "${String(command.trackId)}" was not found.`, { trackId: command.trackId });
    const before = JSON.stringify(J.normalizeCaptionRoles(track.roles).base);
    track.roles = command.reset === true ? J.normalizeCaptionRoles(null) : J.mergeCaptionRoles(track.roles, command.roles);
    if (JSON.stringify(track.roles.base) !== before) this.replanAfterPlacement();
  }

  setSegmentBox(command) {
    const { segment } = this.segment(command.segmentId);
    this.assertUnlocked(segment, 'box'); this.assertUnlocked(segment, 'box', 'visualPlan');
    if (!plainObject(this.project.plans)) this.project.plans = {};
    const plan = this.project.plans[segment.id] || (this.project.plans[segment.id] = { id: `plan_${segment.id}`, segmentId: segment.id, trackId: segment.trackId || J.CAPTION_PRIMARY_TRACK_ID, generated: {}, manual: {}, lockedFields: [] });
    if (!plainObject(plan.manual)) plan.manual = {};
    if (command.box == null) delete plan.manual.box;
    else {
      if (!J.isCaptionBox(command.box)) fail('CAPTION_BOX_INVALID', 'Segment box must be a normalized (0-1) rectangle inside the frame.', { segmentId: segment.id });
      plan.manual.box = Object.assign(J.roundCaptionBox(command.box), { zoneKind: 'custom', manual: true });
    }
    this.replanAfterPlacement();
  }

  /* ---- tracks (delta plan step 6) ----
     Up to three tracks; the primary one cannot be deleted. Deleting another track deletes its captions and
     the words on them (they are not handed back to the primary track); undo restores everything. */
  requireTrack(trackId) {
    const track = typeof trackId === 'string' ? this.project.tracks.find(item => item.id === trackId) : null;
    if (!track) fail('TRACK_NOT_FOUND', `Track "${String(trackId)}" was not found.`, { trackId });
    return track;
  }

  addTrack(command) {
    if (this.project.tracks.length >= J.CAPTION_MAX_TRACKS) fail('TRACKS_LIMIT', `Caption projects allow at most ${J.CAPTION_MAX_TRACKS} tracks.`, { count: this.project.tracks.length });
    if (command.trackId != null && (typeof command.trackId !== 'string' || !command.trackId)) fail('TRACK_ID_REQUIRED', 'Track id must be a non-empty string.');
    if (command.trackId != null && this.project.tracks.some(item => item.id === command.trackId)) fail('TRACK_ID_DUPLICATE', `Track id "${command.trackId}" is duplicated.`, { trackId: command.trackId });
    const track = J.newCaptionTrack(this.project, { id: command.trackId, kind: command.kind });
    track.name = command.name == null ? `Track ${this.project.tracks.length + 1}` : J.captionTrackName(command.name);
    if (command.box != null) {
      if (!J.isCaptionBox(command.box)) fail('CAPTION_BOX_INVALID', 'Track box must be a normalized (0-1) rectangle inside the frame.', { trackId: track.id });
      track.box = Object.assign(J.roundCaptionBox(command.box), { zoneKind: 'custom', manual: true });
    }
    this.project.tracks.push(track);
  }

  removeTrack(command) {
    const track = this.requireTrack(command.trackId);
    if (track.primary) fail('TRACK_PRIMARY_UNDELETABLE', 'The primary track cannot be deleted.', { trackId: track.id });
    const doomed = J.captionTrackSegments(this.project, track.id), segmentIds = new Set(doomed.map(segment => segment.id)), tokenIds = new Set(doomed.flatMap(segment => segment.tokenIds));
    this.project.segments = this.project.segments.filter(segment => !segmentIds.has(segment.id));
    for (const id of segmentIds) delete this.project.plans[id];
    this.project.transcript.tokens = this.project.transcript.tokens.filter(token => !tokenIds.has(token.id));
    this.project.tracks = this.project.tracks.filter(item => item.id !== track.id);
    this.replanAfterPlacement();
  }

  renameTrack(command) {
    this.requireTrack(command.trackId).name = J.captionTrackName(command.name);
  }

  /* toIndex is the new position in tracks[] (= z-order: later tracks are drawn on top). The primary track stays first. */
  reorderTrack(command) {
    const track = this.requireTrack(command.trackId), tracks = this.project.tracks;
    if (track.primary) fail('TRACK_PRIMARY_FIXED', 'The primary track stays first.', { trackId: track.id });
    if (!Number.isInteger(command.toIndex) || command.toIndex < 1 || command.toIndex >= tracks.length) fail('TRACK_INDEX_INVALID', `Track position must be a whole number from 1 to ${tracks.length - 1}.`, { toIndex: command.toIndex });
    tracks.splice(tracks.indexOf(track), 1); tracks.splice(command.toIndex, 0, track);
    J.captionSortSegments(this.project);
    this.replanAfterPlacement();
  }

  /* { trackId, style } merges (null clears a field); { trackId, reset: true } clears all. Re-plans: style changes what fits. */
  setTrackStyle(command) {
    const track = this.requireTrack(command.trackId);
    track.style = command.reset === true ? {} : J.mergeCaptionTrackStyle(track.style, command.style);
    this.replanAfterPlacement();
  }

  freshSegmentId(used) {
    let value = 1, id;
    do { id = `segment_${String(value++).padStart(6, '0')}`; } while (used.has(id));
    used.add(id);
    return id;
  }

  moveSegmentToTrack(command) {
    const { segment } = this.segment(command.segmentId), target = this.requireTrack(command.trackId);
    if ((segment.trackId || J.CAPTION_PRIMARY_TRACK_ID) === target.id) fail('SEGMENT_ALREADY_ON_TRACK', `Segment "${segment.id}" is already on track "${target.id}".`, { segmentId: segment.id, trackId: target.id });
    // A text block moves whole (its segmentation lock is the default, not a reason to refuse).
    if (J.isCaptionTextBlock(this.project, segment)) { this.editTextBlock({ segmentId: segment.id, trackId: target.id }); return; }
    this.moveTokensToTrack({ tokenIds: segment.tokenIds.slice(), trackId: target.id });
  }

  /* Words move to another track. Each run of moved words becomes its own segment there; the words left behind
     keep their segment (split in two when the moved words sat in the middle). Segments touched must be unlocked. */
  moveTokensToTrack(command) {
    const target = this.requireTrack(command.trackId), project = this.project;
    const ids = Array.isArray(command.tokenIds) ? Array.from(new Set(command.tokenIds)) : [];
    if (!ids.length) fail('TOKENS_REQUIRED', 'Choose at least one word to move.');
    for (const id of ids) this.token(id);
    const owner = new Map();
    for (const segment of project.segments) for (const id of segment.tokenIds) owner.set(id, segment);
    for (const id of ids) if (!owner.has(id)) fail('TOKEN_NOT_IN_SEGMENT', `Token "${id}" is not in any caption.`, { tokenId: id });
    const moving = new Set(ids.filter(id => (owner.get(id).trackId || J.CAPTION_PRIMARY_TRACK_ID) !== target.id));
    if (!moving.size) fail('TOKENS_ALREADY_ON_TRACK', `The words are already on track "${target.id}".`, { trackId: target.id });
    const sources = project.segments.filter(segment => segment.tokenIds.some(id => moving.has(id)));
    for (const segment of sources) { this.assertUnlocked(segment, 'trackAssignment', 'segmentation'); this.assertUnlocked(segment, 'trackAssignment', 'visualPlan'); }
    const used = new Set(project.segments.map(segment => segment.id)), tokens = new Map(project.transcript.tokens.map(token => [token.id, token]));
    const arrivals = [];
    for (const segment of sources) {
      const pieces = [];
      for (const id of segment.tokenIds) {
        const move = moving.has(id), last = pieces[pieces.length - 1];
        if (last && last.move === move) last.ids.push(id); else pieces.push({ move, ids: [id] });
      }
      const staying = pieces.filter(piece => !piece.move);
      if (!staying.length) { // the whole segment moves: same segment, new track
        segment.trackId = target.id;
        if (project.plans[segment.id]) project.plans[segment.id].trackId = target.id;
        arrivals.push(segment); continue;
      }
      const original = clone(project.plans[segment.id] || null), locks = segmentLocks(segment), outer = { start: segment.start, end: segment.end };
      pieces.forEach((piece, index) => {
        const first = tokens.get(piece.ids[0]), last = tokens.get(piece.ids[piece.ids.length - 1]);
        const start = index === 0 ? outer.start : first.start, end = index === pieces.length - 1 ? outer.end : last.end;
        const keepsId = piece === staying[0], id = keepsId ? segment.id : this.freshSegmentId(used);
        const made = { id, trackId: piece.move ? target.id : segment.trackId || J.CAPTION_PRIMARY_TRACK_ID, start, end, tokenIds: piece.ids.slice(), boundarySource: 'manual',
          locks: { segmentation: locks.segmentation, visualPlan: locks.visualPlan, fields: locks.fields.slice() } };
        if (keepsId) Object.assign(segment, made);
        else {
          project.segments.push(made);
          if (!piece.move && original) { project.plans[id] = clone(original); project.plans[id].id = `plan_${id}`; project.plans[id].segmentId = id; }
        }
        if (piece.move) arrivals.push(keepsId ? segment : made);
      });
    }
    // Segments of one track must not overlap in time (only one caption per track is on screen at once).
    const inTarget = project.segments.filter(segment => (segment.trackId || J.CAPTION_PRIMARY_TRACK_ID) === target.id);
    for (const arrival of arrivals) for (const other of inTarget) {
      if (other !== arrival && arrival.start < other.end && arrival.end > other.start) fail('TRACK_SEGMENT_OVERLAP', `Moving these words would overlap another caption on "${target.name}". Move or shorten that caption first.`, { segmentId: arrival.id, otherSegmentId: other.id, trackId: target.id });
    }
    J.captionSortSegments(project);
    this.replanAfterPlacement();
  }

  /* ---- manual text blocks (delta plan step 7, ADR 0007) ----
     One segment of typed words on one track; segmentation locked by default; own box and preset
     animations in plan.manual. Blocks may overlap speech on other tracks, never a caption on their own. */
  requireTextBlock(segmentId) {
    const info = this.segment(segmentId);
    if (!J.isCaptionTextBlock(this.project, info.segment)) fail('SEGMENT_NOT_TEXT_BLOCK', `Segment "${segmentId}" is not a text block.`, { segmentId });
    return info;
  }

  assertBlockFits(trackId, start, end, ignoreId) {
    const other = J.captionTextBlockOverlap(this.project, trackId, start, end, ignoreId);
    if (other) fail('TEXT_BLOCK_OVERLAP', 'This time range overlaps another caption on the same track. Choose another track or an empty time range.', { segmentId: ignoreId, otherSegmentId: other.id, trackId });
  }

  /* Plan only this block (as add-caption always did): adding or editing a block never changes the other captions' look. */
  planTextBlock(segment, manual) {
    const old = this.project.plans[segment.id];
    const seedPlan = old ? Object.assign(clone(old), { manual: clone(manual) }) : { manual: clone(manual) };
    const isolated = Object.assign({}, this.project, { segments: [segment], plans: { [segment.id]: seedPlan } });
    const plan = J.planCaptions(isolated, this.project.media).plans[segment.id];
    plan.trackId = segment.trackId;
    this.project.plans[segment.id] = plan;
  }

  blockManual(command, manual, segment) {
    if (command.box !== undefined) {
      if (segment) { this.assertUnlocked(segment, 'box'); this.assertUnlocked(segment, 'box', 'visualPlan'); }
      if (command.box === null) delete manual.box;
      else if (!J.isCaptionBox(command.box)) fail('CAPTION_BOX_INVALID', 'Text block box must be a normalized (0-1) rectangle inside the frame.', { segmentId: segment && segment.id });
      else manual.box = Object.assign(J.roundCaptionBox(command.box), { zoneKind: 'custom', manual: true });
    }
    if (command.animation !== undefined) {
      if (segment) { this.assertUnlocked(segment, 'animation'); this.assertUnlocked(segment, 'animation', 'visualPlan'); }
      J.applyCaptionTextBlockAnimation(manual, command.animation);
    }
    return manual;
  }

  storeBlockTokens(tokens, dropIds) {
    const transcript = this.project.transcript;
    transcript.tokens = transcript.tokens.filter(token => !dropIds.has(token.id)).concat(tokens);
    transcript.tokens.sort((a, b) => a.start - b.start);
    transcript.timingQuality = 'estimated';
    J.validateTranscript(transcript, { duration: this.project.media.duration });
  }

  createTextBlock(command) {
    const trackId = command.trackId == null ? J.CAPTION_PRIMARY_TRACK_ID : this.requireTrack(command.trackId).id;
    const { start, end } = command;
    if (command.segmentId != null && (typeof command.segmentId !== 'string' || !command.segmentId)) fail('SEGMENT_ID_REQUIRED', 'Segment id must be a non-empty string.');
    const id = command.segmentId || this.nextSegmentId();
    if (this.project.segments.some(item => item.id === id)) fail('SEGMENT_ID_DUPLICATE', `Segment id "${id}" is duplicated.`, { segmentId: id });
    const tokens = J.captionTextBlockTokens({ text: command.text, start, end, language: this.project.transcript.language, segmentId: id,
      usedIds: new Set(this.project.transcript.tokens.map(token => token.id)) });
    this.assertBlockFits(trackId, start, end, null);
    const manual = this.blockManual(command, {}, null);
    this.storeBlockTokens(tokens, new Set());
    const segment = { id, trackId, start, end, tokenIds: tokens.map(token => token.id), boundarySource: 'manual',
      locks: { segmentation: command.lockSegmentation !== false, visualPlan: false, fields: [] } };
    this.project.segments.push(segment);
    J.captionSortSegments(this.project);
    this.planTextBlock(segment, manual);
  }

  /* { segmentId, text?, start?, end?, trackId?, box? (null clears), animation? }. Changing text or timing re-spreads the words. */
  editTextBlock(command) {
    const { segment } = this.requireTextBlock(command.segmentId), project = this.project;
    const edits = ['text', 'start', 'end', 'trackId', 'box', 'animation'].filter(field => command[field] !== undefined);
    if (!edits.length) fail('TEXT_BLOCK_EDIT_EMPTY', 'Nothing to change on this text block.', { segmentId: segment.id });
    const tokenMap = new Map(project.transcript.tokens.map(token => [token.id, token])), oldTokens = segment.tokenIds.map(id => tokenMap.get(id));
    if (command.text !== undefined) this.assertUnlocked(segment, 'tokenText');
    if (command.start !== undefined) { this.assertUnlocked(segment, 'timing'); this.assertUnlocked(segment, 'start'); }
    if (command.end !== undefined) { this.assertUnlocked(segment, 'timing'); this.assertUnlocked(segment, 'end'); }
    let trackId = segment.trackId || J.CAPTION_PRIMARY_TRACK_ID;
    if (command.trackId !== undefined && command.trackId !== trackId) {
      this.assertUnlocked(segment, 'trackAssignment'); this.assertUnlocked(segment, 'trackAssignment', 'visualPlan');
      trackId = this.requireTrack(command.trackId).id;
    }
    const start = command.start !== undefined ? Number(command.start) : segment.start, end = command.end !== undefined ? Number(command.end) : segment.end;
    const text = command.text !== undefined ? command.text : oldTokens.map(token => token.text).join(' ');
    const keep = new Set(segment.tokenIds), used = new Set(project.transcript.tokens.filter(token => !keep.has(token.id)).map(token => token.id));
    const tokens = J.captionTextBlockTokens({ text, start, end, language: project.transcript.language, segmentId: segment.id, previous: oldTokens, usedIds: used });
    this.assertBlockFits(trackId, start, end, segment.id);
    const plan = project.plans[segment.id], manual = this.blockManual(command, clone(plan && plan.manual || {}), segment);
    this.storeBlockTokens(tokens, keep);
    Object.assign(segment, { trackId, start, end, tokenIds: tokens.map(token => token.id), boundarySource: 'manual' });
    J.captionSortSegments(project);
    this.planTextBlock(segment, manual);
  }

  /* Deletes the block, its plan and its words. Speech captions are never deleted this way. */
  deleteTextBlock(command) {
    const { segment, index } = this.requireTextBlock(command.segmentId), words = new Set(segment.tokenIds);
    this.project.segments.splice(index, 1);
    delete this.project.plans[segment.id];
    this.project.transcript.tokens = this.project.transcript.tokens.filter(token => !words.has(token.id));
  }

  /* The effects of the whole project (no trackId), one track, all as plain choices. { look: {stage: id|null} } merges; { reset: true } goes back to the standard look. */
  setCaptionLook(command) {
    if (command.trackId != null) {
      const track = this.requireTrack(command.trackId);
      const edit = command.reset === true ? { look: null, lookSettings: null } : {};
      if (command.reset !== true && command.look !== undefined) edit.look = command.look;
      if (command.reset !== true && command.lookSettings !== undefined) edit.lookSettings = command.lookSettings;
      track.style = J.mergeCaptionTrackStyle(track.style, edit);
    } else {
      const style = plainObject(this.project.style) ? clone(this.project.style) : { preset: typeof this.project.style === 'string' ? this.project.style : 'creator' };
      if (command.reset === true) { delete style.look; delete style.lookSettings; delete style.effect; delete style.holdEffect; delete style.exitEffect; }
      else {
        const look = J.mergeCaptionLook(style.look, command.look);
        for (const [key, legacy] of [['enter', 'effect'], ['hold', 'holdEffect'], ['exit', 'exitEffect']]) if (command.look && command.look[key] !== undefined) delete style[legacy];
        if (Object.keys(look).length) style.look = look; else delete style.look;
        if (command.lookSettings !== undefined) {
          const settings = J.mergeCaptionLookSettings(style.lookSettings, command.lookSettings);
          if (Object.keys(settings).length) style.lookSettings = settings; else delete style.lookSettings;
        }
      }
      this.project.style = style;
    }
    this.replanAfterPlacement();
  }

  /* One caption's own effects (stored as manual overrides, so re-planning keeps them). { look } merges, { reset: true } clears them. */
  setSegmentLook(command) {
    const { segment } = this.segment(command.segmentId);
    this.assertUnlocked(segment, 'look'); this.assertUnlocked(segment, 'look', 'visualPlan');
    if (!plainObject(this.project.plans)) this.project.plans = {};
    const plan = this.project.plans[segment.id] || (this.project.plans[segment.id] = { id: `plan_${segment.id}`, segmentId: segment.id, trackId: segment.trackId || J.CAPTION_PRIMARY_TRACK_ID, generated: {}, manual: {}, lockedFields: [] });
    if (!plainObject(plan.generated)) plan.generated = {};
    if (!plainObject(plan.manual)) plan.manual = {};
    const patch = command.reset === true ? Object.fromEntries(J.CAPTION_LOOK_KEYS.map(key => [key, null])) : J.normalizeCaptionLook(command.look, true);
    for (const [key, id] of Object.entries(patch)) {
      const field = J.CAPTION_LOOK_FIELDS[key].plan;
      for (const name of key === 'treat' ? ['textTreatment', 'treatment'] : [field]) { if (id === null) delete plan.manual[name]; else plan.manual[name] = id; }
    }
    if (command.reset === true || command.lookSettings !== undefined) {
      const settings = command.reset === true ? {} : J.mergeCaptionLookSettings(plan.manual.lookSettings, command.lookSettings);
      if (Object.keys(settings).length) plan.manual.lookSettings = settings; else delete plan.manual.lookSettings;
    }
    this.replanAfterPlacement();
  }

  /* A seeded random look, stored as ordinary choices (never re-drawn). Scope: segmentId, else trackId, else the project.
     variation defaults to a number derived from the current choices, so pressing again gives another look and replaying gives the same one. */
  randomizeCaptionLook(command) {
    let scope, current, profileId;
    if (command.segmentId != null) {
      const { segment } = this.segment(command.segmentId); this.assertUnlocked(segment, 'look'); this.assertUnlocked(segment, 'look', 'visualPlan');
      const stored = this.project.plans[segment.id], manual = stored && stored.manual || {};
      scope = `segment:${segment.id}`; current = J.CAPTION_LOOK_KEYS.map(key => manual[J.CAPTION_LOOK_FIELDS[key].plan] || '');
      profileId = J.captionStyleProfileId(this.project, J.captionTrack(this.project, segment.trackId));
    } else if (command.trackId != null) {
      const track = this.requireTrack(command.trackId);
      if (!J.captionTrackSegments(this.project, track.id).some(segment => !segmentLocks(segment).visualPlan) && this.project.transcript.tokens.length) fail('TRACK_NOTHING_TO_REROLL', `Track "${track.name}" has no unlocked captions.`, { trackId: track.id });
      scope = `track:${track.id}`; current = track.style && track.style.look || {}; profileId = J.captionStyleProfileId(this.project, track);
    } else { scope = 'project'; current = this.project.style && this.project.style.look || {}; profileId = J.captionStyleProfileId(this.project); }
    const variation = Number.isInteger(command.variation) ? command.variation : J.sid(JSON.stringify(current));
    let fields = command.fields;
    if (command.segmentId != null) {
      const locked = new Set(segmentLocks(this.segment(command.segmentId).segment).fields);
      fields = (Array.isArray(fields) && fields.length ? fields : ['layout', 'enter', 'hold', 'exit', 'active']).filter(key => !locked.has(J.CAPTION_LOOK_FIELDS[key] && J.CAPTION_LOOK_FIELDS[key].plan));
    }
    if (Array.isArray(fields) && !fields.length) return;
    const look = J.randomCaptionLook(this.project, { scope, variation, profileId, fields });
    if (command.segmentId != null) this.setSegmentLook({ segmentId: command.segmentId, look });
    else this.setCaptionLook({ trackId: command.trackId, look });
  }

  /* Randomize the look of one track (kept as reroll-track). Locked captions keep theirs. */
  rerollTrack(command) { this.randomizeCaptionLook({ trackId: this.requireTrack(command.trackId).id, variation: command.variation }); }

  setVisualOverride(command) {
    const { segment } = this.segment(command.segmentId);
    this.assertUnlocked(segment, command.field); this.assertUnlocked(segment, command.field, 'visualPlan');
    if (typeof command.field !== 'string' || !command.field) fail('VISUAL_FIELD_REQUIRED', 'Visual override requires a field.');
    if (!command.remove && command.value === undefined) fail('VISUAL_VALUE_REQUIRED', `Visual override "${command.field}" requires a value.`, { segmentId: segment.id, field: command.field });
    if (!plainObject(this.project.plans)) this.project.plans = {};
    const plan = this.project.plans[segment.id] || (this.project.plans[segment.id] = { id: `plan_${segment.id}`, segmentId: segment.id, trackId: segment.trackId || J.CAPTION_PRIMARY_TRACK_ID, generated: {}, manual: {}, lockedFields: [] });
    if (!plainObject(plan.generated)) plan.generated = {};
    if (!plainObject(plan.manual)) plan.manual = {};
    if (command.remove) delete plan.manual[command.field]; else plan.manual[command.field] = clone(command.value);
  }

  setSegmentLock(command) {
    const { segment } = this.segment(command.segmentId);
    segment.locks = segmentLocks(segment);
    if (!['segmentation', 'visualPlan'].includes(command.lock)) fail('SEGMENT_LOCK_INVALID', 'Segment lock must be "segmentation" or "visualPlan".', { segmentId: segment.id, lock: command.lock });
    segment.locks[command.lock] = command.locked !== false;
  }

  setFieldLock(command) {
    const { segment } = this.segment(command.segmentId);
    if (typeof command.field !== 'string' || !command.field) fail('FIELD_LOCK_INVALID', 'Field lock requires a field name.', { segmentId: segment.id });
    segment.locks = segmentLocks(segment);
    const fields = new Set(segment.locks.fields);
    if (command.locked === false) fields.delete(command.field); else fields.add(command.field);
    segment.locks.fields = Array.from(fields).sort();
  }
}

J.CaptionStore = CaptionStore;
J.captionResolvedPlan = plan => {
  const generated = (plan && plan.generated) || {}, manual = (plan && plan.manual) || {}, resolved = Object.assign({}, generated, manual);
  // Effect settings layer: the caption's own values on top of its track / project ones (planned into generated).
  if (manual.lookSettings && generated.lookSettings) resolved.lookSettings = J.mergeCaptionLookSettings(generated.lookSettings, manual.lookSettings);
  return resolved;
};
})();
