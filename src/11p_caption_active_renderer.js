/* ============================================================
   JIZURA — active-word state and renderer integration (Gate 3.4)
   ============================================================ */
(() => {
'use strict';

const glyphs = value => Array.from(String(value || ''));
const visibleGlyphs = value => glyphs(value).filter(ch => !/\s/u.test(ch));
const round = value => +value.toFixed(6);

J.captionTokenStatesAt = (tokens, clockTime) => {
  const time = Number(clockTime);
  if (!Number.isFinite(time)) { const error = new Error('Caption clock time must be finite.'); error.code = 'CAPTION_CLOCK_INVALID'; throw error; }
  const states = (tokens || []).map(token => {
    const start = Number(token.start), end = Number(token.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
      const error = new Error(`Caption token "${token.id || ''}" has invalid timing.`); error.code = 'CAPTION_TOKEN_TIMING_INVALID'; error.tokenId = token.id; throw error;
    }
    const state = time < start ? 'upcoming' : time >= end ? 'spoken' : 'active';
    const progress = state === 'active' && end > start ? (time - start) / (end - start) : state === 'spoken' ? 1 : 0;
    return Object.freeze({ id: token.id, text: token.text, start, end, state, progress: round(progress) });
  });
  const active = states.find(token => token.state === 'active') || null;
  return Object.freeze({ time, activeTokenId: active && active.id || null, tokens: Object.freeze(states) });
};

/* Maps rendered glyph indices to token states while ignoring layout-inserted
   whitespace/newlines. Token IDs remain the source of truth for repeated words. */
J.captionGlyphStatesAt = (renderedText, tokens, clockTime) => {
  const timeline = J.captionTokenStatesAt(tokens, clockTime), assignments = [];
  for (const token of timeline.tokens) {
    for (let i = 0; i < visibleGlyphs(token.text).length; i++) assignments.push(token);
  }
  let contentIndex = 0;
  const states = [];
  for (const ch of glyphs(renderedText).filter(ch => ch !== '\n' && ch !== '\r')) {
    if (/\s/u.test(ch)) states.push(null);
    else states.push(assignments[contentIndex++] || null);
  }
  return Object.freeze({ timeline, glyphs: Object.freeze(states) });
};

const chainPost = (item, fn) => {
  const previous = item.post;
  item.post = (env, it, box) => { if (previous) previous(env, it, box); fn(env, it, box); };
};

J.prepareCaptionActiveItem = (env, item) => {
  const config = item.captionActive;
  if (!config || !Array.isArray(config.tokens) || !config.tokens.length) return null;
  const clock = Number(config.clockTime);
  const mapped = J.captionGlyphStatesAt(item.text, config.tokens, clock);
  const treatment = config.treatment || 'captionActiveColor';
  // Emphasis role: restyles glyphs of marked words in place (colour, scale, second font). Advances, line breaks and
  // the anchor come from the base layout, so nothing reflows; a wider second face is squeezed into the base slot.
  const emphasis = config.emphasis;
  if (emphasis && Array.isArray(emphasis.tokenIds) && emphasis.tokenIds.length) {
    const marked = new Set(emphasis.tokenIds);
    item.charFns.push((index, glyph) => {
      const token = mapped.glyphs[index];
      if (!token || !marked.has(token.id)) return null;
      const result = {};
      if (emphasis.color) result.color = emphasis.color;
      if (emphasis.scale && emphasis.scale !== 1) result.s = emphasis.scale;
      if (emphasis.font) {
        result.font = emphasis.font;
        const ch = glyph && glyph.ch, base = ch ? J.metrics.adv(item.font, ch) : 0, second = ch ? J.metrics.adv(emphasis.font, ch) : 0;
        if (base > 0 && second > base) result.sx = base / second;
      }
      return Object.keys(result).length ? result : null;
    });
  }
  const style = J.resolveCaptionActiveStyle(treatment, mapped.timeline.activeTokenId ? 'active' : 'upcoming', {
    accentColor: config.accentColor || (env.sc && env.sc.accent), variableWeightSupported: config.variableWeightSupported,
    scale: config.scale, lift: config.lift, weight: config.weight,
  });
  if (!mapped.timeline.activeTokenId) { item.captionState = mapped.timeline; return mapped.timeline; }

  item.charFns.push(index => {
    const token = mapped.glyphs[index];
    if (!token || token.state !== 'active') return null;
    const result = {};
    if (style.color) result.color = style.color;
    if (style.scale) result.s = style.scale;
    if (style.lift) result.dy = -style.lift;
    if (style.weight) result.weight = style.weight;
    return Object.keys(result).length ? result : null;
  });

  if (style.underline) chainPost(item, (drawEnv, drawn, box) => {
    if (!box || !box.boxes || !drawEnv.line) return;
    let visibleIndex = 0;
    for (let glyphIndex = 0; glyphIndex < mapped.glyphs.length; glyphIndex++) {
      const token = mapped.glyphs[glyphIndex];
      if (!token) continue;
      const glyphBox = box.boxes[visibleIndex++];
      if (!glyphBox || token.state !== 'active') continue;
      const y = drawn.y + glyphBox.y + glyphBox.h * 0.58;
      drawEnv.line([[drawn.x + glyphBox.x - glyphBox.w / 2, y], [drawn.x + glyphBox.x + glyphBox.w / 2, y]], style.underlineColor || drawn.color, Math.max(1.5, drawn.size * 0.025), 1);
    }
  });
  item.captionState = mapped.timeline;
  return mapped.timeline;
};
})();
