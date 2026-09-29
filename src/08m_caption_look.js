/* ============================================================
   JIZURA — caption look: the user's choice of effects (no hidden randomness)
   A look names one effect per stage. Unset stages use the standard look of the style profile.
   Randomness exists only in J.randomCaptionLook, which the user triggers; its result is stored as plain choices.
   ============================================================ */
(() => {
'use strict';

const plain = value => !!value && typeof value === 'object' && !Array.isArray(value);
const lookError = (message, details) => new J.ProjectError('CAPTION_LOOK_INVALID', message, details);

/* look key -> registry group and the plan field the choice ends up in */
J.CAPTION_LOOK_FIELDS = Object.freeze({
  layout: { group: 'layout', plan: 'layout' },
  enter: { group: 'enter', plan: 'entrance' },
  hold: { group: 'hold', plan: 'hold' },
  exit: { group: 'exit', plan: 'exit' },
  active: { group: 'active', plan: 'activeWordTreatment' },
  treat: { group: 'treat', plan: 'textTreatment' },
});
J.CAPTION_LOOK_KEYS = Object.freeze(Object.keys(J.CAPTION_LOOK_FIELDS));

/* What a caption looks like when nothing was chosen. Always the same, never drawn by chance. */
J.CAPTION_STANDARD_LOOKS = Object.freeze({
  creator: Object.freeze({ layout: 'captionBottomStack', enter: 'captionFade', hold: 'captionStill', exit: 'captionFadeOut', active: 'captionActiveColor', treat: 'captionBackplate' }),
  punchy: Object.freeze({ layout: 'captionBottomStack', enter: 'captionSoftScale', hold: 'captionStill', exit: 'captionFadeOut', active: 'captionActiveScale', treat: 'captionBackplate' }),
  'jizura-mv': Object.freeze({ layout: 'captionBottomStack', enter: 'captionSoftRise', hold: 'captionStill', exit: 'captionFadeOut', active: 'captionActiveColor', treat: 'captionBackplate' }),
});

const idKnown = (key, id) => {
  const { group } = J.CAPTION_LOOK_FIELDS[key];
  if (group === 'active') return !!(J.CAPTION_ACTIVE && J.CAPTION_ACTIVE[id]);
  if (group === 'treat' && id === 'captionBackplate') return true;
  return !!(J.registry && J.registry(group) && J.registry(group)[id]);
};

/* Validate a look and return a clean copy. With allowNull a null field means "clear it" (edits). */
J.normalizeCaptionLook = (input, allowNull = false) => {
  const out = {};
  if (input == null) return out;
  if (!plain(input)) throw lookError('Caption look must be an object.');
  for (const [key, value] of Object.entries(input)) {
    if (!J.CAPTION_LOOK_FIELDS[key]) throw lookError(`Caption look has no field "${key}".`, { field: key });
    if (value == null || value === 'auto') {
      if (!allowNull) throw lookError(`Caption look "${key}" needs an effect id.`, { field: key });
      out[key] = null; continue;
    }
    if (typeof value !== 'string' || !idKnown(key, value)) throw lookError(`Caption look "${key}" has an unknown effect "${String(value)}".`, { field: key, value });
    out[key] = value;
  }
  return out;
};

/* Apply an edit (nulls clear a stage) on top of the stored look. */
J.mergeCaptionLook = (current, edit) => {
  const base = J.normalizeCaptionLook(current), patch = J.normalizeCaptionLook(edit, true);
  for (const [key, value] of Object.entries(patch)) { if (value === null) delete base[key]; else base[key] = value; }
  return base;
};

/* The look a resolved style asks for, stage by stage.
   Order: standard of the profile < older per-stage style fields (effect, holdEffect, exitEffect) < style.look. */
J.resolveCaptionLook = (style, profileId) => {
  const source = plain(style) ? style : {};
  const standard = J.CAPTION_STANDARD_LOOKS[profileId || source.profileId || source.preset || source.profile] || J.CAPTION_STANDARD_LOOKS.creator;
  const legacy = { enter: source.effect, hold: source.holdEffect, exit: source.exitEffect }, chosen = plain(source.look) ? source.look : {};
  const look = {}, explicit = {};
  for (const key of J.CAPTION_LOOK_KEYS) {
    const value = [chosen[key], legacy[key]].find(item => typeof item === 'string' && item && item !== 'auto' && idKnown(key, item));
    look[key] = value || standard[key]; explicit[key] = !!value;
  }
  return { look, explicit };
};

/* Effects offered for one stage: the caption-safe ones, or in the advanced editor the techniques the project enabled. */
J.captionLookOptions = (group, project, context = {}) => {
  if (group === 'active') return Object.keys(J.CAPTION_ACTIVE || {});
  if (project && project.style && project.style.editor === 'advanced' && J.captionAutomaticPoolOk) return J.order(group).filter(id => J.captionAutomaticPoolOk(project, group, id));
  const base = { duration: 2, wordCount: 3, portrait: true, hasEmoji: false, allowFullFrame: false, allowFlashes: false, allowCameraMotion: false };
  return J.captionCandidates ? J.captionCandidates(group, Object.assign(base, context)) : [];
};

/* Settings of the chosen effects, stored next to the look: { stage: { all | effectId: { key: value } } }.
   `all` holds what every effect of the stage shares (entrance length, hold strength); an effect id holds that effect's own
   settings (keys match the params the effect reads). An unset key keeps the effect's own value (planned from the seed, or its colour rule). */
const range = (min, max, step, def) => Object.freeze({ type: 'range', min, max, step, def });
const color = def => Object.freeze({ type: 'color', def });
J.CAPTION_LOOK_SETTINGS = Object.freeze({
  enter: { all: { duration: range(.05, 1.5, .05, .4) } },
  hold: { all: { strength: range(0, 2, .05, 1) } },
  exit: { all: { duration: range(.05, 1.5, .05, .18) } },
  active: {
    captionActiveColor: { color: color('#f5a50c') },
    captionActiveScale: { scale: range(1, 1.04, .005, 1.04) },
    captionActiveLift: { lift: range(.2, 2, .1, 2) },
    captionActiveWeight: { weight: range(100, 900, 100, 700) },
    captionActiveUnderline: { color: color('#f5a50c') },
  },
  treat: {
    splitColor: { colorA: color('#ffffff'), colorB: color('#f5a50c'), sp: range(.2, .8, .01, .535) },
    gradientV: { colorA: color('#ffffff'), colorB: color('#f5a50c') },
    outline: { color: color('#ffffff'), k: range(.01, .08, .002, .03) },
    outlineFill: { color: color('#f5a50c'), k: range(.03, .35, .005, .09) },
    captionOutlined: { color: color('#f5a50c'), k: range(.03, .35, .005, .09) },
    doubleOutline: { color: color('#f5a50c'), a: range(.03, .15, .005, .08), b: range(.03, .2, .005, .095) },
    extrude: { color: color('#7a4f06'), d: range(.03, .25, .005, .11) },
    longShadow: { color: color('#3a3f4a'), L: range(.1, 1, .01, .5), ang: range(0, 355, 5, 45) },
    hardShadow: { color: color('#f5a50c'), d: range(.02, .15, .005, .065) },
    softShadow: { color: color('#000000'), b: range(.02, .3, .01, .11), dy: range(0, .15, .005, .05) },
    glow: { color: color('#f5a50c'), b: range(.05, .4, .01, .21) },
  },
});

/* The settings a stage offers for one effect, in display order: the shared ones first, then the effect's own. */
J.captionLookSettingsSpec = (stage, effectId) => {
  const spec = J.CAPTION_LOOK_SETTINGS[stage] || {}, out = [];
  for (const scope of ['all', effectId]) if (scope && spec[scope]) for (const [key, def] of Object.entries(spec[scope])) out.push({ scope, key, def });
  return out;
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const settingOk = (def, value) => def.type === 'color' ? typeof value === 'string' && HEX_COLOR.test(value)
  : typeof value === 'number' && Number.isFinite(value) && value >= def.min - 1e-9 && value <= def.max + 1e-9;

/* Validate settings and return a clean copy. With allowNull a null value clears that setting (a null scope or stage clears all of it). */
J.normalizeCaptionLookSettings = (input, allowNull = false) => {
  const out = {};
  if (input == null) return out;
  if (!plain(input)) throw lookError('Caption look settings must be an object.');
  for (const [stage, scopes] of Object.entries(input)) {
    const stageSpec = J.CAPTION_LOOK_SETTINGS[stage];
    if (!stageSpec) throw lookError(`Caption look settings have no stage "${stage}".`, { field: stage });
    if (scopes == null && allowNull) { out[stage] = null; continue; }
    if (!plain(scopes)) throw lookError(`Caption look settings "${stage}" must be an object.`, { field: stage });
    const stageOut = {};
    for (const [scope, values] of Object.entries(scopes)) {
      const scopeSpec = stageSpec[scope];
      if (!scopeSpec) throw lookError(`"${scope}" has no settings for ${stage}.`, { field: stage, scope });
      if (values == null && allowNull) { stageOut[scope] = null; continue; }
      if (!plain(values)) throw lookError(`Caption look settings "${stage}.${scope}" must be an object.`, { field: stage, scope });
      const scopeOut = {};
      for (const [key, value] of Object.entries(values)) {
        const def = scopeSpec[key];
        if (!def) throw lookError(`"${scope}" has no setting "${key}".`, { field: stage, scope, key });
        if (value == null && allowNull) { scopeOut[key] = null; continue; }
        if (!settingOk(def, value)) throw lookError(`Setting "${stage}.${scope}.${key}" has an invalid value.`, { field: stage, scope, key, value });
        scopeOut[key] = def.type === 'color' ? value.toLowerCase() : value;
      }
      stageOut[scope] = scopeOut;
    }
    out[stage] = stageOut;
  }
  return out;
};

/* Apply an edit on top of stored settings (nulls clear); empty scopes and stages are dropped. Also layers inherited levels. */
J.mergeCaptionLookSettings = (current, edit) => {
  const base = J.normalizeCaptionLookSettings(current), patch = J.normalizeCaptionLookSettings(edit, true);
  for (const [stage, scopes] of Object.entries(patch)) {
    if (scopes === null) { delete base[stage]; continue; }
    const stageOut = base[stage] || {};
    for (const [scope, values] of Object.entries(scopes)) {
      if (values === null) { delete stageOut[scope]; continue; }
      const scopeOut = Object.assign({}, stageOut[scope]);
      for (const [key, value] of Object.entries(values)) { if (value === null) delete scopeOut[key]; else scopeOut[key] = value; }
      if (Object.keys(scopeOut).length) stageOut[scope] = scopeOut; else delete stageOut[scope];
    }
    if (Object.keys(stageOut).length) base[stage] = stageOut; else delete base[stage];
  }
  return base;
};

/* One effect's settings after layering: its stage's shared values and its own. */
J.captionLookSettingsFor = (settings, stage, effectId) => {
  const scopes = plain(settings) && plain(settings[stage]) ? settings[stage] : {};
  return Object.assign({}, plain(scopes.all) ? scopes.all : {}, effectId && plain(scopes[effectId]) ? scopes[effectId] : {});
};

/* A seeded random look. Deterministic for the same project seed, scope and variation number, and it only
   runs when the user asks for it: the result is stored as ordinary choices, so it never changes by itself. */
J.randomCaptionLook = (project, options = {}) => {
  const fields = Array.isArray(options.fields) && options.fields.length ? options.fields : ['layout', 'enter', 'hold', 'exit', 'active'];
  const scope = J.sid(String(options.scope || 'project')), seed = J.h(Number(project && project.seed) || 0, 0x4c4f4b, scope, Number(options.variation) || 0);
  const profileId = options.profileId || 'creator', standard = J.CAPTION_STANDARD_LOOKS[profileId] || J.CAPTION_STANDARD_LOOKS.creator, out = {};
  fields.forEach((key, index) => {
    if (!J.CAPTION_LOOK_FIELDS[key]) throw lookError(`Caption look has no field "${key}".`, { field: key });
    let pool = J.captionLookOptions(J.CAPTION_LOOK_FIELDS[key].group, project);
    const group = J.CAPTION_LOOK_FIELDS[key].group;
    const own = pool.filter(id => { const def = group === 'active' ? J.CAPTION_ACTIVE[id] : J.registry(group)[id]; return !def || !def.captionProfiles || def.captionProfiles.includes(profileId); });
    if (own.length) pool = own;
    out[key] = pool.length ? pool[J.h(seed, index, 0x52) % pool.length] : standard[key];
  });
  return out;
};
})();
