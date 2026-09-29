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

J.captionTechniqueOn = (project, group, id) => {
  const explicit = J.captionTechniques(project).enabled[group];
  if (explicit && typeof explicit[id] === 'boolean') return explicit[id];
  if (!J.GROUP_KEYS.includes(group)) return false;
  const registry = J.registry(group);
  const def = registry[id];
  if (!def || !Object.prototype.hasOwnProperty.call(registry, id)) return false;
  if (!def.capabilities || def.capabilities.captionSafe !== true) return false;
  const listed = captionProfileList(project, group);
  if (listed == null) return true;
  return listed.includes(id);
};

J.validateCaptionProject = project => {
  if (!project || project.mode !== 'video-captions') return project;
  if (project.settings && project.settings.videoEdit && J.validateVideoEdits) J.validateVideoEdits(project.settings.videoEdit, project.media.duration);
  const tokens = project.transcript && Array.isArray(project.transcript.tokens) ? project.transcript.tokens : [];
  const tokenIds = new Set(tokens.map(token => token.id));
  const segmentIds = new Set();
  let previous = null;
  for (let index = 0; index < (project.segments || []).length; index++) {
    const segment = project.segments[index];
    if (!plainObject(segment) || typeof segment.id !== 'string' || !segment.id) fail('SEGMENT_ID_REQUIRED', `Segment at index ${index} requires an id.`, { segmentIndex: index });
    if (segmentIds.has(segment.id)) fail('SEGMENT_ID_DUPLICATE', `Segment id "${segment.id}" is duplicated.`, { segmentId: segment.id, segmentIndex: index });
    segmentIds.add(segment.id);
    if (!Array.isArray(segment.tokenIds) || !segment.tokenIds.length) fail('SEGMENT_TOKENS_REQUIRED', `Segment "${segment.id}" requires token IDs.`, { segmentId: segment.id });
    for (const tokenId of segment.tokenIds) if (!tokenIds.has(tokenId)) {
      fail('SEGMENT_TOKEN_NOT_FOUND', `Segment "${segment.id}" references missing token "${tokenId}".`, { segmentId: segment.id, tokenId });
    }
    if (!Number.isFinite(segment.start) || segment.start < 0 || !Number.isFinite(segment.end) || segment.end < segment.start) {
      fail('SEGMENT_TIMING_INVALID', `Segment "${segment.id}" has invalid timing.`, { segmentId: segment.id, start: segment.start, end: segment.end });
    }
    if (previous && segment.start < previous.start) fail('SEGMENT_ORDER_INVALID', `Segment "${segment.id}" is out of order.`, { segmentId: segment.id, previousSegmentId: previous.id });
    previous = segment;
  }
  for (const [segmentId, plan] of Object.entries(project.plans || {})) {
    if (!segmentIds.has(segmentId)) fail('PLAN_SEGMENT_NOT_FOUND', `Plan references missing segment "${segmentId}".`, { segmentId });
    if (plan && plan.metadata && plan.metadata.captionSafe !== true) {
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
      if (!eligible.allowed) fail('CAPTION_TECHNIQUE_UNSAFE', `Segment "${segmentId}" uses unsafe component "${componentId}".`, { segmentId, componentId, reason: eligible.code });
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
        this.project.settings.videoEdit = clone(command.value);
        break;
      }
      case 'set-caption-style': {
        if (!plainObject(command.style)) fail('CAPTION_STYLE_INVALID', 'Caption style requires an object.');
        this.project.style = clone(command.style);
        if (this.project.transcript.tokens.length) this.project.plans = J.planCaptions(this.project, this.project.media).plans;
        break;
      }
      case 'add-caption': {
        const { start, end } = command;
        const words = J.tokenizeCaptionText(command.text, this.project.transcript.language);
        if (!words.length) fail('TOKEN_TEXT_REQUIRED', 'Enter caption text first.');
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) fail('SEGMENT_TIMING_INVALID', 'End time must be later than start time.');
        if (this.project.segments.some(segment => start < segment.end && end > segment.start)) fail('TOKEN_TIMING_OVERLAP', 'This time range overlaps an existing caption. Choose an empty time range.');
        const id = this.nextSegmentId(), used = new Set(this.project.transcript.tokens.map(token => token.id));
        const tokens = words.map((text, index) => {
          let tokenId = `manual_${id}_${index}`;
          while (used.has(tokenId)) tokenId += '_';
          used.add(tokenId);
          return J.canonicalToken({ id: tokenId, text, start: start + (end - start) * index / words.length,
            end: start + (end - start) * (index + 1) / words.length, source: 'manual', timingQuality: 'estimated' }, index);
        });
        this.project.transcript.tokens.push(...tokens);
        this.project.transcript.tokens.sort((a, b) => a.start - b.start);
        this.project.transcript.timingQuality = 'estimated';
        J.validateTranscript(this.project.transcript, { duration: this.project.media.duration });
        const segment = { id, start, end, tokenIds: tokens.map(token => token.id), boundarySource: 'manual', locks: { segmentation: false, visualPlan: false, fields: [] } };
        this.project.segments.push(segment);
        this.project.segments.sort((a, b) => a.start - b.start);
        const isolated = Object.assign({}, this.project, { segments: [segment], plans: {} });
        this.project.plans[id] = J.planCaptions(isolated, this.project.media).plans[id];
        break;
      }
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
        const leftInfo = this.segment(command.segmentId), right = this.project.segments[leftInfo.index + 1];
        if (!right) fail('SEGMENT_BOUNDARY_LAST', 'The final segment has no following boundary.', { segmentId: command.segmentId });
        this.assertUnlocked(leftInfo.segment, 'segmentation', 'segmentation'); this.assertUnlocked(right, 'segmentation', 'segmentation');
        const leftToken = this.token(leftInfo.segment.tokenIds[leftInfo.segment.tokenIds.length - 1]), rightToken = this.token(right.tokenIds[0]), boundary = Number(command.time);
        if (!Number.isFinite(boundary) || boundary < leftToken.end || boundary > rightToken.start) fail('SEGMENT_BOUNDARY_CONSTRAINT', 'Boundary must stay between neighboring token timings.', { segmentId: command.segmentId, min: leftToken.end, max: rightToken.start });
        leftInfo.segment.end = boundary; right.start = boundary; leftInfo.segment.boundarySource = 'manual'; right.boundarySource = 'manual'; break;
      }
      case 'set-safe-zone': this.setSafeZone(command); break;
      case 'set-visual-override': this.setVisualOverride(command); break;
      case 'set-segment-lock': this.setSegmentLock(command); break;
      case 'set-segment-locks': {
        const { segment } = this.segment(command.segmentId); segment.locks = segmentLocks(segment);
        segment.locks.segmentation = command.locked !== false; segment.locks.visualPlan = command.locked !== false; break;
      }
      case 'set-segment-animation-disabled': {
        const { segment } = this.segment(command.segmentId); this.assertUnlocked(segment, 'animationDisabled'); this.assertUnlocked(segment, 'animationDisabled', 'visualPlan');
        if (!plainObject(this.project.plans)) this.project.plans = {};
        const plan = this.project.plans[segment.id] || (this.project.plans[segment.id] = { id: `plan_${segment.id}`, segmentId: segment.id, generated: {}, manual: {}, lockedFields: [] });
        if (!plainObject(plan.manual)) plan.manual = {}; plan.manual.animationDisabled = command.disabled !== false; break;
      }
      case 'set-project-setting': {
        if (typeof command.field !== 'string' || !command.field) fail('PROJECT_SETTING_INVALID', 'Project setting requires a field name.');
        if (!plainObject(this.project.settings)) this.project.settings = {}; this.project.settings[command.field] = clone(command.value); break;
      }
      case 'set-field-lock': this.setFieldLock(command); break;
      case 'reroll-segment': this.rerollSegment(command); break;
      case 'set-technique': this.setTechnique(command); break;
      default: fail('COMMAND_UNKNOWN', `Unknown caption command "${command.type}".`, { commandType: command.type });
    }
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
    if (this.project.plans && this.project.plans[segment.id]) {
      this.project.plans[rightId] = clone(this.project.plans[segment.id]);
      this.project.plans[rightId].id = `plan_${rightId}`; this.project.plans[rightId].segmentId = rightId;
    }
  }

  mergeSegments(command) {
    const firstInfo = this.segment(command.segmentId);
    const secondInfo = command.nextSegmentId ? this.segment(command.nextSegmentId) : { segment: this.project.segments[firstInfo.index + 1], index: firstInfo.index + 1 };
    if (!secondInfo.segment || secondInfo.index !== firstInfo.index + 1) fail('SEGMENTS_NOT_ADJACENT', 'Only adjacent segments can be merged.', { segmentId: command.segmentId, nextSegmentId: command.nextSegmentId });
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
    if (command.remove) { if (index >= 0) this.project.safeZones.splice(index, 1); return; }
    if (!plainObject(command.value)) fail('SAFE_ZONE_INVALID', `Safe zone "${command.zoneId}" requires an object value.`, { zoneId: command.zoneId });
    const zone = Object.assign({}, clone(command.value), { id: command.zoneId });
    if (index >= 0) this.project.safeZones[index] = zone; else this.project.safeZones.push(zone);
  }

  setVisualOverride(command) {
    const { segment } = this.segment(command.segmentId);
    this.assertUnlocked(segment, command.field); this.assertUnlocked(segment, command.field, 'visualPlan');
    if (typeof command.field !== 'string' || !command.field) fail('VISUAL_FIELD_REQUIRED', 'Visual override requires a field.');
    if (!command.remove && command.value === undefined) fail('VISUAL_VALUE_REQUIRED', `Visual override "${command.field}" requires a value.`, { segmentId: segment.id, field: command.field });
    if (!plainObject(this.project.plans)) this.project.plans = {};
    const plan = this.project.plans[segment.id] || (this.project.plans[segment.id] = { id: `plan_${segment.id}`, segmentId: segment.id, generated: {}, manual: {}, lockedFields: [] });
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

  rerollSegment(command) {
    const { segment } = this.segment(command.segmentId);
    this.assertUnlocked(segment, 'visualPlan', 'visualPlan');
    if (!plainObject(this.project.plans)) this.project.plans = {};
    const plan = this.project.plans[segment.id] || (this.project.plans[segment.id] = { id: `plan_${segment.id}`, segmentId: segment.id, generated: {}, manual: {}, lockedFields: [] });
    if (!plainObject(plan.generated)) plan.generated = {};
    if (!plainObject(plan.manual)) plan.manual = {};
    const count = Number.isInteger(plan.generated.rerollCount) ? plan.generated.rerollCount + 1 : 1;
    const baseSeed = Number.isFinite(this.project.seed) ? this.project.seed : 0;
    plan.generated.rerollCount = count;
    plan.generated.seed = J.h(baseSeed, J.sid(segment.id), count);
  }
}

J.CaptionStore = CaptionStore;
J.captionResolvedPlan = plan => Object.assign({}, (plan && plan.generated) || {}, (plan && plan.manual) || {});
})();
