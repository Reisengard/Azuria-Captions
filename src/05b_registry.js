/* ============================================================
   JIZURA — registries for the newer expression groups + a single
   registration helper used by every expression pack (src/11p_*.js)

   group    registry      order array          picked per
   layout   J.LAYOUTS     J.LAYOUT_ORDER       cut
   enter    J.ENTER       J.ENTER_ORDER        cut
   hold     J.HOLD        J.HOLD_ORDER         cut
   exit     J.EXIT        J.EXIT_ORDER         cut
   decor    J.DECOR       J.DECOR_ORDER        cut (0..n)
   treat    J.TREAT       J.TREAT_ORDER        cut   text treatment (outline, extrude, marker…)
   bg       J.BG          J.BG_ORDER           line  full-screen background graphic
   cam      J.CAMERA      J.CAMERA_ORDER       cut   camera move over the cut
   fx       J.FXE         J.FXE_ORDER          event post-processing / transition effect
   trans    J.TRANS       J.TRANS_ORDER        cut   how this cut takes over from the previous one (both frames composited)

   Common optional fields on every entry:
     name  (Japanese label, required)   tags  (mood keys it suits: glitch calm pop graphic editorial emotional)
     w     (base pick weight, default 1)  pack (set by J.register)

   Caption-reviewed entries additionally declare every required capability
   field below. Entries with no capability declaration remain lyric-only.
   ============================================================ */
(() => {
'use strict';

J.TREAT = { none: { name: 'なし', apply() {} } };
J.TREAT_ORDER = ['none'];
J.BG = { none: { name: '無地', draw() {} } };
J.BG_ORDER = ['none'];
J.CAMERA = {
  push: { name: 'ゆっくり寄る', tags: ['calm', 'editorial', 'emotional', 'graphic', 'pop', 'glitch'], w: 5,
    get: (env) => ({ s: 1 + 0.03 * (env.fx.motion ?? 0.7) * J.clamp(env.lt / Math.max(0.3, env.cut.dur)) }) },
};
J.CAMERA_ORDER = ['push'];
// post / transition effects. Entries without draw() are handled by the renderer's built-in branch.
J.FXE = {
  slice:  { name: 'スライスグリッチ', builtin: true },
  block:  { name: 'ブロックグリッチ', builtin: true },
  invert: { name: '反転', builtin: true },
  flash:  { name: 'フラッシュ', builtin: true },
  zoom:   { name: 'ズームブラー', builtin: true },
  mosaic: { name: 'モザイク', builtin: true },
  shake:  { name: '揺れ', builtin: true },
  chroma: { name: '色ズレの跳ね', builtin: true },
};
J.FXE_ORDER = ['chroma', 'shake', 'slice', 'block', 'invert', 'flash', 'zoom', 'mosaic'];
// cut-to-cut transitions: draw(ctx, A, B, p, info) composites the previous cut (A) and this cut (B) in device pixels
J.TRANS = {};
J.TRANS_ORDER = [];

const GROUPS = {
  layout: ['LAYOUTS', 'LAYOUT_ORDER'], enter: ['ENTER', 'ENTER_ORDER'], hold: ['HOLD', 'HOLD_ORDER'], exit: ['EXIT', 'EXIT_ORDER'],
  decor: ['DECOR', 'DECOR_ORDER'], treat: ['TREAT', 'TREAT_ORDER'], bg: ['BG', 'BG_ORDER'], cam: ['CAMERA', 'CAMERA_ORDER'], fx: ['FXE', 'FXE_ORDER'], trans: ['TRANS', 'TRANS_ORDER'],
};
J.GROUP_KEYS = Object.keys(GROUPS);
J.registry = g => J[GROUPS[g][0]];
J.order = g => J[GROUPS[g][1]];

const CAPABILITY_FIELDS = Object.freeze([
  'intensity', 'motionCost', 'attentionCost', 'captionSafe',
  'minDuration', 'preferredDuration', 'maxWords', 'portraitFriendly',
  'emojiSafe', 'requiresFullFrame', 'flashes', 'movesCamera',
  'incompatibleComponentIds', 'incompatibleCategories',
]);
const REQUIRED_CAPABILITY_FIELDS = Object.freeze([
  'intensity', 'motionCost', 'attentionCost', 'captionSafe',
  'minDuration', 'maxWords', 'portraitFriendly', 'emojiSafe',
  'requiresFullFrame', 'flashes', 'movesCamera',
]);
J.COMPONENT_CAPABILITY_FIELDS = CAPABILITY_FIELDS;

const metadataError = (group, key, message, field) => {
  const error = new Error(`${group}.${key}: ${message}`);
  error.name = 'ComponentMetadataError';
  error.code = 'COMPONENT_METADATA_INVALID';
  error.group = group; error.componentId = key;
  if (field) error.field = field;
  throw error;
};
const finiteRange = (value, low, high) => Number.isFinite(value) && value >= low && value <= high;
const stringList = value => Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0);

/* Missing metadata is deliberately valid for legacy Lyric Motion components.
   Once any capability field is present, the complete contract is required. */
J.validateComponentMetadata = (group, key, def) => {
  const present = CAPABILITY_FIELDS.filter(field => def[field] !== undefined);
  if (!present.length) return null;
  for (const field of REQUIRED_CAPABILITY_FIELDS) {
    if (def[field] === undefined) metadataError(group, key, `capability field "${field}" is required`, field);
  }
  if (!Number.isInteger(def.intensity) || def.intensity < 0 || def.intensity > 4) metadataError(group, key, 'intensity must be an integer from 0 to 4', 'intensity');
  for (const field of ['motionCost', 'attentionCost']) if (!finiteRange(def[field], 0, 1)) metadataError(group, key, `${field} must be between 0 and 1`, field);
  for (const field of ['captionSafe', 'portraitFriendly', 'emojiSafe', 'requiresFullFrame', 'flashes', 'movesCamera']) {
    if (typeof def[field] !== 'boolean') metadataError(group, key, `${field} must be boolean`, field);
  }
  if (!Number.isFinite(def.minDuration) || def.minDuration < 0) metadataError(group, key, 'minDuration must be a non-negative number', 'minDuration');
  if (def.preferredDuration !== undefined && (!Number.isFinite(def.preferredDuration) || def.preferredDuration < def.minDuration)) {
    metadataError(group, key, 'preferredDuration must be at least minDuration', 'preferredDuration');
  }
  if (!Number.isInteger(def.maxWords) || def.maxWords < 1) metadataError(group, key, 'maxWords must be a positive integer', 'maxWords');
  for (const field of ['incompatibleComponentIds', 'incompatibleCategories']) {
    if (def[field] !== undefined && !stringList(def[field])) metadataError(group, key, `${field} must be an array of non-empty strings`, field);
  }
  return Object.freeze(Object.fromEntries(CAPABILITY_FIELDS.map(field => [field,
    def[field] === undefined ? [] : Array.isArray(def[field]) ? Object.freeze(def[field].slice()) : def[field]])));
};

/* J.register('layout', 'myKey', { name: '…', … }, 'packName') */
J.register = (group, key, def, pack) => {
  const G = GROUPS[group];
  if (!G) throw new Error('unknown group ' + group);
  if (!def || !def.name) throw new Error(`${group}.${key}: name is required`);
  const capabilities = J.validateComponentMetadata(group, key, def);
  const reg = J[G[0]], order = J[G[1]];
  if (reg[key] && reg[key].pack !== pack) console.warn(`JIZURA: ${group}.${key} is being replaced`);
  def.pack = pack || def.pack || 'core';
  if (capabilities) def.capabilities = capabilities;
  const pendingReview = J.CAPTION_PENDING_REVIEWS && J.CAPTION_PENDING_REVIEWS[`${group}.${key}`];
  if (pendingReview) {
    def.capabilities = J.validateComponentMetadata(group, key, pendingReview.metadata);
    if (J.CAPTION_COMPONENT_REVIEW) J.CAPTION_COMPONENT_REVIEW[`${group}.${key}`] = pendingReview.decision;
    delete J.CAPTION_PENDING_REVIEWS[`${group}.${key}`];
  }
  reg[key] = def;
  if (!def.special && !order.includes(key)) order.push(key);
  return def;
};
J.registerAll = (group, defs, pack) => { for (const k of Object.keys(defs)) J.register(group, k, defs[k], pack); };

/* items whose tags include a mood key (used by おまかせ) */
J.taggedWith = (group, mood) => J.order(group).filter(k => { const d = J.registry(group)[k]; return d && d.tags && d.tags.includes(mood); });

const componentRef = item => {
  if (typeof item === 'string') return { id: item, category: null, def: null };
  if (!item) return { id: '', category: null, def: null };
  const group = item.group || item.category || '';
  const key = item.key || item.id || '';
  const def = item.def || (GROUPS[group] && J.registry(group)[key]) || null;
  return { id: key, qualifiedId: group && key ? `${group}.${key}` : key, category: (def && def.category) || group || null, def };
};

/* The caption picker asks this boundary instead of reading registries directly.
   Unknown legacy components fail closed here but stay in J.order() for lyrics. */
J.captionComponentEligibility = (group, key, context = {}) => {
  const def = GROUPS[group] && J.registry(group)[key];
  if (!def) return { allowed: false, code: 'COMPONENT_NOT_FOUND', group, componentId: key };
  const meta = def.capabilities;
  if (!meta) return { allowed: false, code: 'COMPONENT_CAPABILITIES_UNREVIEWED', group, componentId: key };
  if (!meta.captionSafe) return { allowed: false, code: 'COMPONENT_NOT_CAPTION_SAFE', group, componentId: key };
  if (Number.isFinite(context.duration) && context.duration < meta.minDuration) return { allowed: false, code: 'COMPONENT_DURATION_TOO_SHORT', group, componentId: key };
  if (Number.isFinite(context.wordCount) && context.wordCount > meta.maxWords) return { allowed: false, code: 'COMPONENT_WORD_LIMIT_EXCEEDED', group, componentId: key };
  if (context.portrait && !meta.portraitFriendly) return { allowed: false, code: 'COMPONENT_NOT_PORTRAIT_FRIENDLY', group, componentId: key };
  if (context.hasEmoji && !meta.emojiSafe) return { allowed: false, code: 'COMPONENT_NOT_EMOJI_SAFE', group, componentId: key };
  if (context.allowFullFrame === false && meta.requiresFullFrame) return { allowed: false, code: 'COMPONENT_REQUIRES_FULL_FRAME', group, componentId: key };
  if (context.allowFlashes === false && meta.flashes) return { allowed: false, code: 'COMPONENT_FLASHES_DISABLED', group, componentId: key };
  if (context.allowCameraMotion === false && meta.movesCamera) return { allowed: false, code: 'COMPONENT_CAMERA_MOTION_DISABLED', group, componentId: key };

  const candidateIds = new Set([key, `${group}.${key}`]);
  const candidateCategory = def.category || group;
  for (const selectedItem of context.selected || []) {
    const selected = componentRef(selectedItem);
    if ((meta.incompatibleComponentIds || []).some(id => id === selected.id || id === selected.qualifiedId)) {
      return { allowed: false, code: 'COMPONENT_ID_INCOMPATIBLE', group, componentId: key, incompatibleWith: selected.qualifiedId || selected.id };
    }
    if (selected.category && (meta.incompatibleCategories || []).includes(selected.category)) {
      return { allowed: false, code: 'COMPONENT_CATEGORY_INCOMPATIBLE', group, componentId: key, incompatibleWith: selected.category };
    }
    const other = selected.def && selected.def.capabilities;
    if (other && (other.incompatibleComponentIds || []).some(id => candidateIds.has(id))) {
      return { allowed: false, code: 'COMPONENT_ID_INCOMPATIBLE', group, componentId: key, incompatibleWith: selected.qualifiedId || selected.id };
    }
    if (other && (other.incompatibleCategories || []).includes(candidateCategory)) {
      return { allowed: false, code: 'COMPONENT_CATEGORY_INCOMPATIBLE', group, componentId: key, incompatibleWith: selected.category };
    }
  }
  return { allowed: true, code: 'COMPONENT_ELIGIBLE', group, componentId: key, metadata: meta };
};

J.captionCandidates = (group, context = {}) => J.order(group).filter(key => J.captionComponentEligibility(group, key, context).allowed);
})();
