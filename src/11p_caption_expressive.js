/* ============================================================
   JIZURA — reviewed expressive caption subset (Gate 3.3)
   Legacy components remain default-deny; approved behavior is exposed through
   constrained wrappers with explicit profile allow-lists.
   ============================================================ */
(() => {
'use strict';

const PACK = 'caption-expressive';
const clamp = J.clamp;
const meta = (intensity, motionCost, attentionCost, minDuration, maxWords = 10) => ({
  intensity, motionCost, attentionCost, captionSafe: true, 
  minDuration, preferredDuration: Math.max(0.7, minDuration), maxWords,
  portraitFriendly: true, emojiSafe: true, requiresFullFrame: false, flashes: false, movesCamera: false,
  incompatibleComponentIds: [], incompatibleCategories: [],
});
const unsafeMeta = () => ({
  intensity: 4, motionCost: 1, attentionCost: 1, captionSafe: false, 
  minDuration: 0, maxWords: 99, portraitFriendly: false, emojiSafe: false,
  requiresFullFrame: false, flashes: false, movesCamera: false,
  incompatibleComponentIds: [], incompatibleCategories: [],
});

J.CAPTION_COMPONENT_REVIEW = J.CAPTION_COMPONENT_REVIEW || {};
J.CAPTION_PENDING_REVIEWS = J.CAPTION_PENDING_REVIEWS || {};
J.reviewCaptionComponent = (group, id, decision) => {
  const def = J.registry(group)[id];
  const frozenDecision = Object.freeze(Object.assign({ group, id }, decision));
  if (!def) {
    J.CAPTION_PENDING_REVIEWS[`${group}.${id}`] = { metadata: unsafeMeta(), decision: frozenDecision };
    J.CAPTION_COMPONENT_REVIEW[`${group}.${id}`] = frozenDecision;
    return null;
  }
  const capabilities = J.validateComponentMetadata(group, id, unsafeMeta());
  def.capabilities = capabilities;
  J.CAPTION_COMPONENT_REVIEW[`${group}.${id}`] = frozenDecision;
  return def;
};

/* These originals either overshoot, move anchors, use large blur, or ignore
   caption timing. They are explicitly rejected; wrappers below reuse only the
   safe idea, not the legacy amplitude/timing. */
[
  ['enter', 'pop', 'overshoot-and-rotation', 'captionImpact'],
  ['enter', 'type', 'timing-not-caption-bounded', 'captionType'],
  ['enter', 'blur', 'blur-and-scale-too-large', 'captionBlur'],
  ['enter', 'wipe', 'wipe-bar-and-extent-unbounded', 'captionWipe'],
  ['hold', 'drift', 'moves-caption-anchor', null],
  ['hold', 'breathe', 'scale-and-tracking-change-geometry', 'captionBreathe'],
  ['exit', 'shrink', 'shrinks-to-unreadable-and-changes-tracking', 'captionShrinkOut'],
].forEach(([group, id, reason, wrapper]) => J.reviewCaptionComponent(group, id, {
  status: wrapper ? 'adapted' : 'rejected', captionSafe: false, reason, wrapper,
}));

const profile = (definition, profiles) => Object.assign(definition, { captionProfiles: Object.freeze(profiles.slice()) });

// Reuse Lyric Motion's per-character entrances, confined to caption text.
for (const [id, original, name] of [
  ['captionPop', 'pop', '字幕・ポップ'], ['captionDrop', 'drop', '字幕・ドロップ'],
]) {
  J.register('enter', id, profile(Object.assign({ name,
    apply(env, item, progress, timing) {
      const local = Object.assign({}, env, { fx: Object.assign({}, env.fx, { motion: Math.min(.65, env.fx.motion) }) });
      J.ENTER[original].apply(local, item, progress, timing);
    },
  }, meta(2, .28, .28, .55, 12)), ['jizura-mv']), PACK);
}

J.registerAll('enter', {
  captionType: profile(Object.assign({
    name: '字幕・タイプ表示', cursor: false,
    apply(_env, it, p) {
      if (!it.charFns) it.charFns = [];
      it.charFns.push((i, _glyph, count) => {
        const visible = Math.ceil(clamp(p) * count);
        return i < visible ? null : { hide: true };
      });
    },
  }, meta(2, 0.22, 0.3, 0.65, 8)), ['jizura-mv']),

  captionBlur: profile(Object.assign({
    name: '字幕・抑制ブラー',
    apply(_env, it, p) {
      const e = J.E.outCubic(clamp(p));
      it.blur = (it.blur || 0) + (1 - e) * 8;
      it.alpha = (it.alpha == null ? 1 : it.alpha) * e;
    },
  }, meta(2, 0.24, 0.28, 0.6)), ['jizura-mv']),

  captionWipe: profile(Object.assign({
    name: '字幕・抑制ワイプ',
    apply(_env, it, p) {
      const e = J.E.inOutCubic(clamp(p)), box = J.itemBox(it);
      it.clip = [box.x0 - 1, J.lerp(box.x0, box.x1 + 1, e)];
    },
  }, meta(2, 0.22, 0.26, 0.55)), ['jizura-mv']),

  captionImpact: profile(Object.assign({
    name: '字幕・抑制インパクト',
    apply(_env, it, p) {
      const e = J.E.outCubic(clamp(p));
      it.size *= 0.9 + 0.1 * e;
      it.alpha = (it.alpha == null ? 1 : it.alpha) * Math.min(1, clamp(p) * 3);
    },
  }, meta(2, 0.32, 0.42, 0.55, 4)), ['punchy', 'jizura-mv']),
}, PACK);

J.register('hold', 'captionBreathe', profile(Object.assign({
  name: '字幕・抑制呼吸',
  apply(env, it, amount) {
    const phase = Math.sin((Number(env.lt) || 0) * J.TAU * 0.55);
    it.size *= 1 + phase * 0.012 * clamp(amount);
  },
}, meta(1, 0.12, 0.1, 1)), ['jizura-mv']), PACK);

J.register('hold', 'captionWave', profile(Object.assign({
  name: '字幕・ウェーブ',
  apply(env, it, amount, timing) {
    J.HOLD.wave.apply(env, it, clamp(amount) * .35 * clamp(env.fx.motion), timing);
  },
}, meta(1, .16, .1, .7)), ['jizura-mv']), PACK);

J.registerAll('exit', {
  captionBlurOut: profile(Object.assign({
    name: '字幕・ブラー退場',
    apply(_env, it, p) {
      const e = J.E.inCubic(clamp(p));
      it.blur = (it.blur || 0) + e * 8;
      it.alpha = (it.alpha == null ? 1 : it.alpha) * (1 - e);
    },
  }, meta(1, .14, .1, .45)), ['jizura-mv']),
  captionFadeOut: Object.assign({
    name: '字幕・フェード退場',
    apply(_env, it, p) { it.alpha = (it.alpha == null ? 1 : it.alpha) * (1 - J.E.inCubic(clamp(p))); },
  }, meta(0, 0.06, 0.04, 0.2)),
  captionShrinkOut: profile(Object.assign({
    name: '字幕・抑制収縮退場',
    apply(_env, it, p) {
      const e = J.E.inCubic(clamp(p));
      it.size *= 1 - e * 0.08;
      it.alpha = (it.alpha == null ? 1 : it.alpha) * (1 - e);
    },
  }, meta(1, 0.14, 0.14, 0.45)), ['jizura-mv']),
}, PACK);

/* Existing specimen/editorial layouts were reviewed but rejected because they
   do not consume caption zones. Gate 3.1's zone-aware layouts are their safe
   replacements. */
[
  ['typeSpecimen', 'captionCenterStack'], ['quote', 'captionCenterStack'], ['lowerThird', 'captionBottomTwoLine'],
].forEach(([id, wrapper]) => {
  J.reviewCaptionComponent('layout', id, { status: 'rejected', captionSafe: false, reason: 'not-zone-aware', wrapper });
});

// Outlined text (縁取り) for captions: a border under the letters. It does not move, flash or change the layout, so it is caption-safe.
// Lyric Motion's outlineFill loads later (11p_looks), so it is looked up when used.
J.register('treat', 'captionOutlined', Object.assign({ name: '字幕・縁取り',
  plan: (rng, st) => J.TREAT.outlineFill.plan(rng, st),
  apply(env, item, params) { J.TREAT.outlineFill.apply(env, item, params); },
}, meta(1, 0, .08, .3, 12)), PACK);
})();
