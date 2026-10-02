/* ============================================================
   JIZURA — caption-safe subtle motion primitives (Gate 3.2)
   ============================================================ */
(() => {
'use strict';

const PACK = 'caption-core';
const clamp = J.clamp;
const meta = (intensity, motionCost, attentionCost, minDuration = 0.3) => ({
  intensity, motionCost, attentionCost, captionSafe: true, 
  minDuration, preferredDuration: 0.7, maxWords: 12, portraitFriendly: true, emojiSafe: true,
  requiresFullFrame: false, flashes: false, movesCamera: false,
  incompatibleComponentIds: [], incompatibleCategories: [],
});
const ready = it => { if (!it.charFns) it.charFns = []; if (!it.pieceFns) it.pieceFns = []; return it; };

J.registerAll('enter', {
  captionFade: Object.assign({
    name: '字幕・フェード',
    apply(_env, it, p) { it.alpha = (it.alpha == null ? 1 : it.alpha) * J.E.outCubic(clamp(p)); },
  }, meta(1, 0.1, 0.12)),

  captionSoftRise: Object.assign({
    name: '字幕・ソフトライズ',
    apply(_env, it, p) {
      const e = J.E.outCubic(clamp(p));
      it.y += (1 - e) * Math.min(18, it.size * 0.18);
      it.alpha = (it.alpha == null ? 1 : it.alpha) * e;
    },
  }, meta(1, 0.18, 0.18, 0.4)),

  captionSoftScale: Object.assign({
    name: '字幕・ソフトスケール',
    apply(_env, it, p) {
      const e = J.E.outCubic(clamp(p));
      it.size *= 0.96 + 0.04 * e;
      it.alpha = (it.alpha == null ? 1 : it.alpha) * e;
    },
  }, meta(1, 0.14, 0.16, 0.4)),

  captionWordFade: Object.assign({
    name: '字幕・語ごとフェード',
    apply(_env, it, p) {
      ready(it).charFns.push((i, _glyph, count) => {
        const order = count > 1 ? i / (count - 1) : 0;
        const q = clamp((p - order * 0.28) / 0.72);
        return q >= 0.999 ? null : { a: J.E.outCubic(q) };
      });
    },
  }, meta(1, 0.16, 0.18, 0.5)),

  captionSoftReplace: Object.assign({
    name: '字幕・ソフト置換',
    apply(_env, it, p) {
      const e = J.E.outCubic(clamp(p));
      it.alpha = (it.alpha == null ? 1 : it.alpha) * e;
      it.y += (1 - e) * Math.min(8, it.size * 0.08);
    },
  }, meta(1, 0.12, 0.14, 0.35)),
}, PACK);

J.register('hold', 'captionStill', Object.assign({ name: '字幕・静止', apply() {} }, meta(0, 0, 0, 0)), PACK);

/* Active-word treatments return paint-only changes. Their contract forbids
   width, font-size, tracking, or anchor changes, keeping measured geometry
   identical across upcoming/active/spoken states. */
J.CAPTION_ACTIVE = J.CAPTION_ACTIVE || {};
J.CAPTION_ACTIVE_ORDER = J.CAPTION_ACTIVE_ORDER || [];
J.registerCaptionActive = (id, definition) => {
  if (!definition || !definition.name || typeof definition.style !== 'function') throw new Error(`active.${id}: name and style are required`);
  const capabilities = J.validateComponentMetadata('active', id, definition);
  definition.pack = PACK; definition.capabilities = capabilities;
  J.CAPTION_ACTIVE[id] = definition;
  if (!J.CAPTION_ACTIVE_ORDER.includes(id)) J.CAPTION_ACTIVE_ORDER.push(id);
  return definition;
};
J.captionActiveCandidates = () => J.CAPTION_ACTIVE_ORDER.filter(id => {
  const def = J.CAPTION_ACTIVE[id], c = def && def.capabilities;
  return c && c.captionSafe;
});

const activeMeta = (attentionCost = 0.06) => meta(0, 0, attentionCost, 0);
J.registerCaptionActive('captionActiveColor', Object.assign({
  name: '字幕・アクティブ色', style: context => ({ color: context.accentColor || '#B39D68' }),
}, activeMeta(0.06)));
J.registerCaptionActive('captionActiveScale', Object.assign({
  name: '字幕・アクティブ拡大', style: context => ({ scale: Math.min(1.04, Math.max(1, Number(context.scale) || 1.04)) }),
}, activeMeta(0.08)));
J.registerCaptionActive('captionActiveLift', Object.assign({
  name: '字幕・アクティブ持ち上げ', style: context => ({ lift: Math.min(2, Math.max(0, Number(context.lift) || 2)) }),
}, activeMeta(0.06)));
J.registerCaptionActive('captionActiveWeight', Object.assign({
  name: '字幕・アクティブウェイト', style: context => ({ weight: context.variableWeightSupported === false ? null : Math.min(900, Math.max(100, Number(context.weight) || 700)) }),
}, activeMeta(0.05)));
J.registerCaptionActive('captionActiveUnderline', Object.assign({
  name: '字幕・アクティブ下線', style: context => ({ underline: true, underlineColor: context.accentColor || '#B39D68' }),
}, activeMeta(0.06)));

J.resolveCaptionActiveStyle = (id, state, context = {}) => {
  if (state !== 'active') return Object.freeze({});
  const def = J.CAPTION_ACTIVE[id];
  if (!def) { const error = new Error(`Unknown caption active treatment "${id}".`); error.code = 'CAPTION_ACTIVE_NOT_FOUND'; throw error; }
  const result = Object.assign({}, def.style(context));
  for (const forbidden of ['fontSize', 'size', 'track', 'tracking', 'x', 'y', 'anchor', 'lineBreaks']) delete result[forbidden];
  return Object.freeze(result);
};
})();
