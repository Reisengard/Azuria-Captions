/* ============================================================
   JIZURA — deterministic caption visual planner (Gate 2.5)
   ============================================================ */
(() => {
'use strict';

J.CAPTION_PLANNER_VERSION = 1;
J.CAPTION_GENERATOR_VERSION = 'caption-planner-1';

const clone = value => JSON.parse(JSON.stringify(value));
const profiles = {
  creator: {
    label: 'Creator', font: 'Inter', fontSize: 76, minFontSize: 44, alignment: 'center', accentColor: '#B7FF4A', textColor: '#FFFFFF', backgroundColor: '#111318', contrastStrategy: 'backplate',
    zones: ['bottom', 'center', 'top'], layouts: ['captionBottomStack', 'captionBottomTwoLine', 'captionLeftAnchor', 'captionRightAnchor', 'captionCenterStack'],
    entrances: ['captionFade', 'captionSoftRise', 'captionSoftScale', 'captionWordFade', 'captionSoftReplace'], holds: ['captionStill'], exits: ['captionFadeOut'],
    activeTreatments: ['captionActiveColor', 'captionActiveWeight', 'captionActiveUnderline'], maxAttempts: 18, allowFullFrame: false,
    segmentation: { minWords: 2, maxWords: 6, targetWords: 4, minDwell: 0.7, targetDwell: 1.8, maxDwell: 3.6 },
    motionBudget: { maxIntensity: 1, maxMotionCost: 0.72, maxAttentionCost: 0.7, maxRollingAttention: 1.15, maxContinuityChanges: 1,
      continuity: { font: 'fixed', alignment: 'fixed', position: 'fixed', treatment: 'sticky', accentColor: 'fixed', animationFamily: 'sticky' } },
  },
  punchy: {
    label: 'Punchy', font: 'Inter', fontSize: 84, minFontSize: 44, alignment: 'center', accentColor: '#FFDE59', textColor: '#FFFFFF', backgroundColor: '#111111', contrastStrategy: 'backplate',
    zones: ['center', 'bottom', 'top'], layouts: ['captionBottomStack', 'captionBottomTwoLine', 'captionCenterStack', 'captionSingleWordHero', 'captionLeftAnchor', 'captionRightAnchor', 'captionTwoLinePunch'],
    entrances: ['captionFade', 'captionSoftRise', 'captionSoftScale', 'captionWordFade', 'captionSoftReplace', 'captionImpact'], holds: ['captionStill'], exits: ['captionFadeOut'],
    activeTreatments: ['captionActiveColor', 'captionActiveScale', 'captionActiveLift'], maxAttempts: 20, allowFullFrame: false,
    segmentation: { minWords: 1, maxWords: 4, targetWords: 3, minDwell: 0.55, targetDwell: 1.35, maxDwell: 2.8 },
    motionBudget: { maxIntensity: 2, maxMotionCost: 0.92, maxAttentionCost: 0.9, maxRollingAttention: 1.45, maxContinuityChanges: 2,
      continuity: { font: 'fixed', alignment: 'sticky', position: 'sticky', treatment: 'sticky', accentColor: 'fixed', animationFamily: 'flexible' } },
  },
  'jizura-mv': {
    label: 'JIZURA / MV', font: 'Noto Sans', fontSize: 80, minFontSize: 42, alignment: 'center', accentColor: '#57E6FF', textColor: '#FFFFFF', backgroundColor: '#0B1020', contrastStrategy: 'outline',
    zones: ['center', 'bottom', 'top'], layouts: ['captionBottomStack', 'captionBottomTwoLine', 'captionCenterStack', 'captionSingleWordHero', 'captionLeftAnchor', 'captionRightAnchor', 'captionTwoLinePunch'],
    entrances: ['captionFade', 'captionSoftRise', 'captionSoftScale', 'captionWordFade', 'captionSoftReplace', 'captionImpact', 'captionType', 'captionBlur', 'captionWipe', 'captionPop', 'captionDrop'],
    holds: ['captionStill', 'captionBreathe'], exits: ['captionFadeOut', 'captionShrinkOut'],
    activeTreatments: ['captionActiveColor', 'captionActiveScale', 'captionActiveLift', 'captionActiveWeight', 'captionActiveUnderline'], maxAttempts: 24, allowFullFrame: false,
    segmentation: { minWords: 1, maxWords: 6, targetWords: 3, minDwell: 0.55, targetDwell: 1.5, maxDwell: 3.2 },
    motionBudget: { maxIntensity: 3, maxMotionCost: 1.1, maxAttentionCost: 1.05, maxRollingAttention: 1.7, maxContinuityChanges: 3,
      continuity: { font: 'sticky', alignment: 'sticky', position: 'sticky', treatment: 'flexible', accentColor: 'sticky', animationFamily: 'flexible' } },
  },
};
J.CAPTION_STYLE_PROFILES = Object.freeze(profiles);

const internalMeta = (intensity, motionCost, attentionCost) => ({ intensity, motionCost, attentionCost, captionSafe: true, minDuration: 0, maxWords: 99, portraitFriendly: true, emojiSafe: true, requiresFullFrame: false, flashes: false, movesCamera: false, incompatibleComponentIds: [], incompatibleCategories: [] });
const SAFE = Object.freeze({
  layout: { group: 'layout', id: 'captionStatic', metadata: internalMeta(0, 0, 0) },
  enter: { group: 'enter', id: 'captionFade', metadata: internalMeta(1, 0.12, 0.18), role: 'primary' },
  hold: { group: 'hold', id: 'captionStill', metadata: internalMeta(0, 0, 0) },
  exit: { group: 'exit', id: 'captionFadeOut', metadata: internalMeta(0, 0.06, 0) },
  active: { group: 'active', id: 'captionActiveColor', metadata: internalMeta(0, 0, 0.06), role: 'secondary' },
  treat: { group: 'treat', id: 'captionBackplate', metadata: internalMeta(0, 0, 0) },
});

const styleFor = (project, track) => {
  const source = (J.captionTrackProjectStyle ? J.captionTrackProjectStyle(project, track) : project.style) || {};
  const key = typeof source === 'string' ? source : source.preset || source.profile || 'creator';
  const normalized = key === 'jizura' || key === 'mv' ? 'jizura-mv' : key;
  const base = profiles[normalized] || profiles.creator;
  const resolvedKey = profiles[normalized] ? normalized : 'creator';
  const overrides = typeof source === 'object' ? source : {};
  return { key: resolvedKey, value: Object.assign({}, base, overrides, {
    profileId: resolvedKey,
    segmentation: Object.assign({}, base.segmentation, overrides.segmentation || {}),
    motionBudget: Object.assign({}, base.motionBudget, overrides.motionBudget || {}, {
      continuity: Object.assign({}, base.motionBudget.continuity, overrides.motionBudget && overrides.motionBudget.continuity || {}),
    }),
  }) };
};
// Fit and readability are measured in the output frame (post format), the one the preview and export draw.
const frameFor = (project, media) => {
  const out = J.videoOutputSize ? J.videoOutputSize(project) : null;
  if (out && out.width > 0 && out.height > 0) return { width: out.width, height: out.height };
  return {
    width: Number(media && (media.width || media.videoWidth) || project.media && project.media.width) || 1080,
    height: Number(media && (media.height || media.videoHeight) || project.media && project.media.height) || 1920,
  };
};
const hasEmoji = text => /\p{Extended_Pictographic}/u.test(text);
const resolvedStored = stored => Object.assign({}, stored && stored.generated || {}, stored && stored.manual || {});
const fieldsLocked = (segment, stored) => new Set([...(segment.locks && segment.locks.fields || []), ...(stored && stored.lockedFields || [])]);
// The primary track keeps the original seed so existing projects plan identically; other tracks fold their ID in (ADR 0003).
const hashSeed = (seed, segmentId, reroll = 0, trackId) => trackId && trackId !== J.CAPTION_PRIMARY_TRACK_ID
  ? J.h(Number(seed) || 0, J.sid(String(trackId)), J.sid(String(segmentId)), reroll, J.CAPTION_PLANNER_VERSION)
  : J.h(Number(seed) || 0, J.sid(String(segmentId)), reroll, J.CAPTION_PLANNER_VERSION);
const advancedEditor = style => style.editor === 'advanced';
// Reviewed lyric ids carry intensity 4. The caption budget would drop them before the id is stored.
const NEUTRAL_POOL_META = Object.freeze({ intensity: 0, motionCost: 0, attentionCost: 0 });
const automaticPoolOk = (project, group, id) => {
  if (!J.captionTechniqueOn || J.captionTechniqueOn(project, group, id) !== true) return false;
  const def = J.registry(group)[id];
  if (!def) return false;
  if (group !== 'layout' && J.captionAdvancedOpen && J.captionAdvancedOpen(project, group)) return true;   // advanced: every effect is on; the set switches only narrow the simple pool
  if (J.isCaptionPackDef && J.isCaptionPackDef(def)) return true;   // caption packs are not Lyric Motion's optional sets (11q_sets marks them "extra")
  const flags = J.captionTechniques(project);
  if (def.extra && flags.extra !== true) return false;
  if (def.wa && flags.wa !== true) return false;
  if (def.set && flags[def.set] !== true) return false;
  return true;
};

J.captionAutomaticPoolOk = automaticPoolOk;
const eligible = (group, segment, text, frame, style, project) => {
  if (advancedEditor(style)) return J.order(group).filter(id => automaticPoolOk(project, group, id));
  if (!J.captionCandidates) return [];
  return J.captionCandidates(group, { duration: segment.end - segment.start, wordCount: segment.tokenIds.length, portrait: frame.height > frame.width,
    hasEmoji: hasEmoji(text), allowFullFrame: style.allowFullFrame === true, allowFlashes: false, allowCameraMotion: false }).filter(id => {
      const definition = J.registry(group)[id], allowedProfiles = definition && definition.captionProfiles;
      const selected = { enter: style.effect, hold: style.holdEffect, exit: style.exitEffect }[group];
      const profileList = selected && selected !== 'auto' ? [selected] : group === 'layout' ? style.layouts : group === 'enter' ? style.entrances : group === 'hold' ? style.holds : group === 'exit' ? style.exits : null;
      return (!allowedProfiles || allowedProfiles.includes(style.profileId)) && (!profileList || profileList.includes(id));
    });
};
/* The caption's look, stage by stage: this caption's own choice, else its track/project look, else the profile's standard.
   Nothing here is drawn by chance. A choice that cannot be used on this caption (too short, safety, portrait) is replaced by the
   safe default and reported in lookWarnings, never silently. */
const usableChoice = (group, id, context, style, project) => {
  if (group === 'active') return !!(J.CAPTION_ACTIVE && J.CAPTION_ACTIVE[id]);
  if (!J.registry(group) || !J.registry(group)[id]) return false;
  // The advanced editor works from the techniques the project enabled; the simple one from the caption-safe set.
  return advancedEditor(style) ? automaticPoolOk(project, group, id) : J.captionComponentEligibility(group, id, context).allowed;
};
const chooseLook = (segment, text, frame, style, project, oldPlan) => {
  const { look } = J.resolveCaptionLook(style, style.profileId), manual = oldPlan && oldPlan.manual || {};
  const context = { duration: segment.end - segment.start, wordCount: segment.tokenIds.length, portrait: frame.height > frame.width, hasEmoji: hasEmoji(text),
    allowFullFrame: style.allowFullFrame === true, allowFlashes: false, allowCameraMotion: false };
  const picked = {}, warnings = [];
  for (const key of J.CAPTION_LOOK_KEYS) {
    const { group, plan } = J.CAPTION_LOOK_FIELDS[key];
    const own = typeof manual[plan] === 'string' && manual[plan] ? manual[plan] : null;
    const id = own || look[key];
    if (usableChoice(group, id, context, style, project)) { picked[key] = id; continue; }
    if (id !== SAFE[group].id && !(group === 'treat' && id === SAFE.treat.id)) warnings.push({ field: key, id, code: 'look-unavailable' });
    picked[key] = SAFE[group].id;
  }
  return { picked, warnings };
};
const componentFor = (group, id) => (J.registry && J.registry(group) && J.registry(group)[id]) ? { group, id } : clone(SAFE[group]);
const metadataFor = component => component.metadata || (J.registry && J.registry(component.group)[component.id] && J.registry(component.group)[component.id].capabilities);
const withMeta = (component, role) => {
  component.metadata = metadataFor(component);
  const resolvedRole = component.role || role;
  if (resolvedRole) component.role = resolvedRole;
  return component;
};
const registeredComponent = (group, id, fallback, role) => {
  const definition = J.registry && J.GROUP_KEYS.includes(group) && J.registry(group)[id];
  return withMeta({ group, id, metadata: definition && definition.capabilities || fallback.metadata }, role);
};
const componentsCompatible = (components, advanced) => components.every((component, index) => {
  if (!J.captionComponentEligibility || !component.group || !J.registry || !J.GROUP_KEYS.includes(component.group) || !J.registry(component.group)[component.id]) return true;
  const selected = components.filter((_, otherIndex) => otherIndex !== index).map(item => ({
    group: item.group, key: item.id, def: J.GROUP_KEYS.includes(item.group) ? J.registry(item.group)[item.id] : null,
  }));
  const result = J.captionComponentEligibility(component.group, component.id, { selected });
  if (result.allowed) return true;
  return advanced === true && (result.code === 'COMPONENT_NOT_CAPTION_SAFE' || result.code === 'COMPONENT_CAPABILITIES_UNREVIEWED');
});
const motionCandidate = (candidate, advanced) => {
  if (!advanced) return candidate;
  return Object.assign({}, candidate, {
    components: candidate.components.map(component => {
      const def = component.group && J.GROUP_KEYS.includes(component.group) && J.registry(component.group)[component.id];
      const meta = def && def.capabilities;
      if (meta && meta.captionSafe === true) return component;
      return Object.assign({}, component, { metadata: NEUTRAL_POOL_META });
    }),
  });
};

const projectZones = (project, frame, style) => {
  const valid = [];
  for (const zone of project.safeZones || []) {
    try { if (zone.kind) { J.validateCaptionZone(zone, frame); valid.push(clone(zone)); } } catch (_) { /* invalid saved zones are not planner candidates */ }
  }
  if (valid.length) return valid;
  return style.zones.map(kind => J.createCaptionZone(kind, frame));
};
const segmentText = (segment, tokenMap) => segment.tokenIds.map(id => tokenMap.get(id)).filter(Boolean).map(token => token.text).join(' ');
const segmentEmphasis = (segment, tokenMap, strength = 1) => segment.tokenIds.map(id => tokenMap.get(id)).filter(Boolean).map(token => ({ id: token.id, score: Math.max(0, Math.min(1, (token.emphasis && token.emphasis.score || 0) * strength)), reasons: token.emphasis && token.emphasis.reasons || [] }));

const candidateFor = (segment, text, emphasis, placement, style, seed, frame, project, oldPlan) => {
  const zone = placement.zone;
  const { picked, warnings } = chooseLook(segment, text, frame, style, project, oldPlan);
  const layout = componentFor('layout', picked.layout), entrance = componentFor('enter', picked.enter), hold = componentFor('hold', picked.hold);
  const exit = componentFor('exit', picked.exit), treatment = componentFor('treat', picked.treat);
  const activeId = picked.active;
  const activeDefinition = J.CAPTION_ACTIVE && J.CAPTION_ACTIVE[activeId];
  const active = { group: 'active', id: activeId, metadata: activeDefinition && activeDefinition.capabilities || SAFE.active.metadata, role: 'secondary' };
  const components = [withMeta(layout), withMeta(entrance, 'primary'), withMeta(hold), withMeta(exit), active, withMeta(treatment)];
  const strongest = emphasis.reduce((best, item) => !best || item.score > best.score ? item : best, null);
  return Object.assign({
    segmentId: segment.id, seed, text, tokenIds: segment.tokenIds.slice(), start: segment.start, end: segment.end,
    zoneId: zone.id, zone: clone(zone), box: clone(placement.box), layout: layout.id, entrance: entrance.id, hold: hold.id, exit: exit.id,
    activeWordTreatment: activeId, textTreatment: treatment.id, decoration: null, lookWarnings: warnings,
    font: style.font, fontSize: style.fontSize, alignment: style.alignment, position: zone.kind, writingMode: style.writingMode || 'horizontal',
    treatment: treatment.id, accentColor: style.accentColor, animationFamily: entrance.id,
    textColor: style.textColor, backgroundColor: style.backgroundColor, contrastStrategy: style.contrastStrategy,
    duration: segment.end - segment.start, maxLines: 2, stableAnchor: true, emphasis, strongestEmphasis: strongest,
    motion: style.motion == null ? .6 : style.motion, intensity: style.intensity == null ? .6 : style.intensity, captionTreatment: style.captionTreatment || 'outline',
    styleProfile: style.profileId, allowFullFrame: style.allowFullFrame === true,
    components,
  }, style.lookSettings && Object.keys(style.lookSettings).length ? { lookSettings: clone(style.lookSettings) } : {});
};

const applyLocks = (candidate, oldPlan, locked) => {
  const previous = resolvedStored(oldPlan);
  for (const field of locked) if (previous[field] !== undefined) candidate[field] = clone(previous[field]);
  return candidate;
};
const completeStoredPlan = (segment, candidate, oldPlan, attempt, fallback, readability, motion, rerollCount) => ({
  id: oldPlan && oldPlan.id || `plan_${segment.id}`, segmentId: segment.id,
  generated: Object.assign({}, candidate, { attempt, fallback, readability, motionSummary: Object.assign({}, motion.totals, { hero: motion.hero }), rerollCount }),
  manual: clone(oldPlan && oldPlan.manual || {}), lockedFields: clone(oldPlan && oldPlan.lockedFields || []),
});

const staticFallback = (segment, text, emphasis, placement, style, seed, frame, project, oldPlan) => {
  let fontSize = style.fontSize, readability, candidate;
  do {
    candidate = candidateFor(segment, text, emphasis, placement, style, seed, frame, project, oldPlan);
    candidate.lookWarnings = (candidate.lookWarnings || []).concat({ field: 'all', code: 'look-simplified' });
    const pooled = group => advancedEditor(style) ? eligible(group, segment, text, frame, style, project)[0] : null;
    const layoutId = pooled('layout') || (style.layouts && style.layouts.find(id => J.LAYOUTS && J.LAYOUTS[id] && J.LAYOUTS[id].capabilities)) || SAFE.layout.id;
    const entranceId = pooled('enter') || SAFE.enter.id;
    const holdId = pooled('hold') || SAFE.hold.id;
    const exitId = pooled('exit') || SAFE.exit.id;
    const treatId = pooled('treat') || SAFE.treat.id;
    candidate.layout = layoutId; candidate.entrance = entranceId; candidate.hold = holdId; candidate.exit = exitId;
    candidate.textTreatment = treatId; candidate.treatment = treatId; candidate.decoration = null;
    candidate.animationFamily = entranceId; candidate.activeWordTreatment = SAFE.active.id;
    const activeDefinition = J.CAPTION_ACTIVE && J.CAPTION_ACTIVE[SAFE.active.id];
    const template = (group, id, safe) => {
      const def = J.registry(group)[id];
      return def && def.capabilities ? safe : advancedEditor(style) ? { metadata: NEUTRAL_POOL_META } : safe;
    };
    candidate.components = [registeredComponent('layout', layoutId, template('layout', layoutId, SAFE.layout)), registeredComponent('enter', entranceId, template('enter', entranceId, SAFE.enter), 'primary'),
      registeredComponent('hold', holdId, template('hold', holdId, SAFE.hold)), registeredComponent('exit', exitId, template('exit', exitId, SAFE.exit)),
      { group: 'active', id: SAFE.active.id, metadata: activeDefinition && activeDefinition.capabilities || SAFE.active.metadata, role: 'secondary' }, registeredComponent('treat', treatId, template('treat', treatId, SAFE.treat))];
    candidate.fontSize = fontSize;
    readability = J.evaluateCaptionReadability(candidate, { frame, constraints: { minFontSize: style.minFontSize, maxLines: 2 } });
    fontSize -= 2;
  } while (!readability.allowed && fontSize >= style.minFontSize);
  return { candidate, readability };
};

const planOne = (segment, tokenMap, placement, style, project, projectSeed, oldPlan, recentPlans, frame, rerollCount, previousPlan) => {
  if (segment.locks && segment.locks.visualPlan && oldPlan) return clone(oldPlan);
  const text = segmentText(segment, tokenMap), emphasis = segmentEmphasis(segment, tokenMap, Number.isFinite(style.emphasisStrength) ? style.emphasisStrength : 1);
  const seed = hashSeed(projectSeed, segment.id, rerollCount, segment.trackId), locked = fieldsLocked(segment, oldPlan);
  const advanced = advancedEditor(style);
  // The look is the user's (or the standard). A caption that does not fit keeps it and gets a smaller font (reported); only when even
  // the smallest font does not fit does it become a static plan. The motion budget only reports: it never swaps an effect.
  const attempt = fontSize => {
    const candidate = applyLocks(candidateFor(segment, text, emphasis, placement, style, seed, frame, project, oldPlan), oldPlan, locked);
    if (!locked.has('fontSize')) candidate.fontSize = fontSize;
    if (!componentsCompatible(candidate.components, advanced)) return null;
    const readability = J.evaluateCaptionReadability(candidate, { frame, constraints: { minFontSize: style.minFontSize, maxLines: 2 } });
    if (!readability.allowed) return { readability };
    const motion = J.evaluateCaptionMotionPlan(motionCandidate(candidate, advanced), { profile: style.motionBudget, manualOverride: true, recentPlans, previousPlan });
    if (!motion.allowed) return null;
    candidate.overBudget = motion.reasons;
    if (fontSize < style.fontSize) candidate.lookWarnings.push({ field: 'fontSize', code: 'font-reduced', from: style.fontSize, to: fontSize });
    return { candidate, readability, motion };
  };
  for (let fontSize = style.fontSize; fontSize >= style.minFontSize; fontSize -= 2) {
    const hit = attempt(fontSize);
    if (hit && hit.candidate) return completeStoredPlan(segment, hit.candidate, oldPlan, 0, false, hit.readability, hit.motion, rerollCount);
    // Only a smaller font can help when the text is the problem (size, width, lines); reading time and contrast are not font matters.
    if (!hit || locked.has('fontSize') || !hit.readability.reasons.some(reason => ['horizontal-overflow', 'vertical-overflow', 'too-many-lines'].includes(reason))) break;
  }
  // The placement is the user's: an unreadable fit becomes a static plan with warnings, never a moved caption.
  const fallback = staticFallback(segment, text, emphasis, placement, style, seed, frame, project, oldPlan);
  const candidate = applyLocks(fallback.candidate, oldPlan, locked);
  const readability = J.evaluateCaptionReadability(candidate, { frame, constraints: { minFontSize: style.minFontSize, maxLines: 2 } });
  const motion = J.evaluateCaptionMotionPlan(candidate, { profile: style.motionBudget, manualOverride: true, recentPlans, previousPlan });
  return completeStoredPlan(segment, candidate, oldPlan, style.maxAttempts, true, readability, motion, rerollCount);
};

/* Where a segment's caption goes: its own override, else its track's box, else (bare projects
   without tracks) the first zone the style would have offered. The planner never picks a position. */
const placementFor = (segment, oldPlan, project, frame, zones) => {
  const box = J.captionEffectiveBox(project, segment, oldPlan);
  if (box) return { box: clone(box), zone: J.captionBoxToZone(box, frame) };
  return { box: J.captionZoneToBox(zones[0], frame), zone: zones[0] };
};

J.captionStyleProfileId = (project, track) => styleFor(project, track).key;

/* Zones the style offers as the default box (saved valid zones, else the style's kinds). */
J.captionProjectZones = (project, frame) => projectZones(project, frame, styleFor(project).value);

J.planCaptions = (project, media, options = {}) => {
  const frame = frameFor(project, media), resolvedStyle = styleFor(project), style = resolvedStyle.value;
  const emphasized = J.applyCaptionEmphasis(project.transcript, { segments: project.segments }), tokenMap = new Map(emphasized.tokens.map(token => [token.id, token]));
  const zones = projectZones(project, frame, style), plans = {}, recentPlans = [], lastByTrack = new Map(), styles = new Map();
  // Budget and repetition are global (recentPlans holds every track in time order); continuity is per track (previousPlan).
  const trackStyleFor = track => {
    const key = track ? track.id : '';
    if (!styles.has(key)) styles.set(key, J.captionTrackStyle(styleFor(project, track).value, track));
    return styles.get(key);
  };
  const primaryTrack = J.captionTrack(project), primaryZone = primaryTrack && J.isCaptionBox(primaryTrack.box) ? J.captionBoxToZone(primaryTrack.box, frame) : zones[0];
  const segments = project.segments && project.segments.length ? project.segments : J.segmentCaptions(emphasized, {
    duration: project.media && project.media.duration, safeZone: primaryZone, existingSegments: project.segments || [], ...style.segmentation,
  }).segments;
  for (const segment of segments) {
    const oldPlan = project.plans && project.plans[segment.id];
    const rerollCount = options.rerollCounts && options.rerollCounts[segment.id] != null ? options.rerollCounts[segment.id] : oldPlan && oldPlan.generated && oldPlan.generated.rerollCount || 0;
    const trackId = segment.trackId || J.CAPTION_PRIMARY_TRACK_ID;
    const stored = planOne(segment, tokenMap, placementFor(segment, oldPlan, project, frame, zones), trackStyleFor(J.captionTrack(project, trackId)), project, project.seed, oldPlan, recentPlans, frame, rerollCount, lastByTrack.get(trackId));
    if (stored.trackId == null) stored.trackId = trackId;
    plans[segment.id] = stored; recentPlans.push(stored.generated); lastByTrack.set(trackId, stored.generated);
  }
  return { version: J.CAPTION_PLANNER_VERSION, generatorVersion: J.CAPTION_GENERATOR_VERSION, projectId: project.id,
    seed: project.seed, profile: resolvedStyle.key, frame, zones, tokens: emphasized.tokens, segments: clone(segments), plans };
};

/* "Randomize" for the whole project: a seeded random look is written into the style as ordinary choices, then everything is planned.
   The result is fixed until the user changes it again. Track looks and locked captions keep their own choices. */
J.createCaptionVisualVariation = (project, options = {}) => {
  const varied = clone(project), requestedSeed = options.seed, variation = Number(options.variation || 1);
  varied.seed = Number.isFinite(requestedSeed) ? requestedSeed : J.h(Number(project.seed) || 0, 0x564152, variation);
  const profileId = styleFor(varied).key;
  varied.style = Object.assign({}, typeof varied.style === 'object' && varied.style || {}, { look: J.randomCaptionLook(varied, { scope: 'project', variation, profileId }) });
  const result = J.planCaptions(varied, options.media);
  varied.plans = result.plans;
  return varied;
};

/* Randomize one caption: its look becomes a seeded random choice stored as the caption's own overrides. */
J.rerollCaptionVisual = (project, segmentId, options = {}) => {
  const segment = (project.segments || []).find(item => item.id === segmentId);
  if (!segment) { const error = new Error(`Segment "${segmentId}" was not found.`); error.code = 'SEGMENT_NOT_FOUND'; throw error; }
  if (segment.locks && segment.locks.visualPlan) { const error = new Error(`Segment "${segmentId}" visual plan is locked.`); error.code = 'SEGMENT_FIELD_LOCKED'; throw error; }
  const current = project.plans && project.plans[segmentId], count = (current && current.generated && current.generated.rerollCount || 0) + 1;
  const track = J.captionTrack(project, segment.trackId), profileId = styleFor(project, track).key;
  const look = J.randomCaptionLook(project, { scope: `segment:${segmentId}`, variation: count, profileId });
  const changed = clone(project); changed.plans = clone(project.plans || {});
  const plan = changed.plans[segmentId] || (changed.plans[segmentId] = { id: `plan_${segmentId}`, segmentId, generated: {}, manual: {}, lockedFields: [] });
  plan.manual = Object.assign({}, plan.manual);
  for (const [key, id] of Object.entries(look)) plan.manual[J.CAPTION_LOOK_FIELDS[key].plan] = id;
  plan.generated = Object.assign({}, plan.generated, { rerollCount: count });
  changed.plans[segmentId] = J.planCaptions(changed, options.media, { rerollCounts: { [segmentId]: count } }).plans[segmentId];
  return changed;
};
})();
