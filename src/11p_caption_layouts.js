/* ============================================================
   JIZURA — caption-safe production layouts (Gate 3.1)

   Layout geometry is resolved independently from active-word state. Preview
   and export can therefore restyle words without moving the anchor or
   changing line breaks.
   ============================================================ */
(() => {
'use strict';

const PACK = 'caption-core';
const round = value => +value.toFixed(3);
const cloneRect = value => ({ x: value.x, y: value.y, width: value.width, height: value.height });
const union = (a, b) => J.unionBB ? J.unionBB(a, b) : (!a ? b : !b ? a : {
  x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1),
  cx: (Math.min(a.x0, b.x0) + Math.max(a.x1, b.x1)) / 2,
  cy: (Math.min(a.y0, b.y0) + Math.max(a.y1, b.y1)) / 2, boxes: [],
});

const metadata = (intensity, maxWords, minDuration = 0.45) => ({
  intensity, motionCost: 0, attentionCost: intensity ? 0.12 : 0,
  captionSafe: true, minDuration, preferredDuration: 1.4, maxWords,
  portraitFriendly: true, emojiSafe: true, requiresFullFrame: false, flashes: false, movesCamera: false,
  incompatibleComponentIds: [], incompatibleCategories: [],
});

const sourceFor = env => {
  const cut = env.cut || {}, params = cut.params || {}, box = env.box || cut.box || params.box;
  return {
    text: cut.text || '', font: params.font || cut.font || (env.st && env.st.fonts && env.st.fonts.body && env.st.fonts.body[0]) || 'gothic',
    fontSize: params.fontSize || cut.fontSize, zone: env.zone || cut.zone || params.zone, box, frame: box ? env.frame || { width: env.W, height: env.H } : undefined,
    textColor: params.textColor || cut.textColor || (env.sc && env.sc.fg), padding: params.padding,
    tokens: cut.captionTokens || cut.tokens || params.tokens,
    clockTime: env.clockTime != null ? env.clockTime : env.time != null ? env.time : (Number(cut.start) || 0) + (Number(env.lt) || 0),
    activeTreatment: cut.activeWordTreatment || params.activeWordTreatment,
    accentColor: params.accentColor || cut.accentColor || (env.sc && env.sc.accent),
    variableWeightSupported: params.variableWeightSupported,
  };
};

const measureWidth = (text, font, fontSize) => {
  if (J.measure) return J.measure({ text, font, size: fontSize, track: 0 }).w;
  return Array.from(String(text)).length * fontSize * 0.57;
};

const splitBalanced = (text, width, font, fontSize, maxLines) => {
  const source = String(text || '').trim();
  if (!source) return [];
  if (maxLines < 2 || measureWidth(source, font, fontSize) <= width) return [source];
  const spaced = /\s/u.test(source), parts = spaced ? source.split(/\s+/u) : Array.from(source);
  let best = null;
  for (let i = 1; i < parts.length; i++) {
    const left = parts.slice(0, i).join(spaced ? ' ' : ''), right = parts.slice(i).join(spaced ? ' ' : '');
    const a = measureWidth(left, font, fontSize), b = measureWidth(right, font, fontSize);
    if (a > width || b > width) continue;
    const score = Math.abs(a - b) + Math.max(a, b) * 0.08;
    if (!best || score < best.score) best = { score, lines: [left, right] };
  }
  return best ? best.lines : [source];
};

const fit = (text, zone, font, requestedSize, maxLines, padding) => {
  const inner = { x: zone.x + padding, y: zone.y + padding, width: zone.width - padding * 2, height: zone.height - padding * 2 };
  let fontSize = Math.min(Number(requestedSize) || Math.max(42, zone.height * 0.2), inner.height / Math.max(1.18, maxLines * 1.18));
  let lines, measurement;
  for (let attempt = 0; attempt < 80; attempt++) {
    lines = splitBalanced(text, inner.width, font, fontSize, maxLines);
    measurement = J.measureCaptionInZone(lines.join('\n'), inner, {
      fontSize, maxLines, lineHeight: 1.18,
      measureText: value => Math.max(...String(value).split('\n').map(line => measureWidth(line, font, fontSize))),
    });
    if (lines.length <= maxLines && Math.max(...lines.map(line => measureWidth(line, font, fontSize))) <= inner.width && lines.length * fontSize * 1.18 <= inner.height) break;
    fontSize -= 2;
    if (fontSize <= 12) break;
  }
  const widths = lines.map(line => round(measureWidth(line, font, fontSize)));
  const lineHeight = fontSize * 1.18;
  return { inner, lines, widths, fontSize: round(fontSize), lineHeight: round(lineHeight), measurement };
};

const compose = (kind, input = {}) => {
  // A normalized box (the placement source) wins over a pixel zone. Geometry never depends on the active word.
  const zone = input.box && input.frame ? J.captionBoxToZone(input.box, input.frame) : input.zone;
  J.validateCaptionZone(zone, input.frame);
  const font = input.font || 'gothic', text = String(input.text || '').trim();
  const padding = Math.max(12, Number(input.padding) || (Number(input.fontSize) || 64) * 0.28);
  const hero = kind === 'captionSingleWordHero';
  const maxLines = hero ? 1 : 2;
  const fitted = fit(text, zone, font, input.fontSize, maxLines, padding);
  const blockHeight = fitted.lines.length * fitted.lineHeight;
  const left = kind === 'captionLeftAnchor', right = kind === 'captionRightAnchor';
  const topAligned = kind === 'captionCenterStack' || hero;
  const x = left ? fitted.inner.x : right ? fitted.inner.x + fitted.inner.width : fitted.inner.x + fitted.inner.width / 2;
  const align = left ? 'left' : right ? 'right' : 'center';
  const y = topAligned ? fitted.inner.y + (fitted.inner.height - blockHeight) / 2 + blockHeight / 2
    : fitted.inner.y + fitted.inner.height - blockHeight / 2;
  const anchor = { x: round(x), y: round(y), align, vertical: topAligned ? 'center' : 'bottom' };
  const lineBreaks = []; let count = 0;
  fitted.lines.slice(0, -1).forEach(line => { count += Array.from(line).length; lineBreaks.push(count); });
  const overflowX = Math.max(0, ...fitted.widths.map(width => width - fitted.inner.width));
  const overflowY = Math.max(0, blockHeight - fitted.inner.height);
  const diagnostics = {
    fits: fitted.lines.length <= maxLines && overflowX <= 0 && overflowY <= 0,
    overflowX: round(overflowX), overflowY: round(overflowY), lineCount: fitted.lines.length,
    maxLines, zone: cloneRect(zone), innerZone: cloneRect(fitted.inner), padding: round(padding),
  };
  return {
    id: kind, text, font, fontSize: fitted.fontSize, lines: fitted.lines, lineBreaks, lineHeight: fitted.lineHeight,
    anchor, stableAnchor: true, activeTokenId: input.activeTokenId || null, diagnostics,
    items: [{ text: fitted.lines.join('\n'), font, size: fitted.fontSize, x: anchor.x, y: anchor.y, align, lead: 1.18, color: input.textColor,
      captionActive: input.tokens && input.tokens.length ? { tokens: input.tokens, clockTime: input.clockTime,
        treatment: input.activeTreatment || 'captionActiveColor', accentColor: input.accentColor,
        variableWeightSupported: input.variableWeightSupported, emphasis: input.emphasis || null } : null }],
  };
};

J.composeCaptionLayout = compose;

const definition = (id, name, intensity, maxWords, options = {}) => Object.assign({
  name, category: 'caption-layout', ...metadata(intensity, maxWords, options.minDuration),
  fits: count => count <= maxWords,
  plan: (_rng, cut) => ({ font: cut.font, fontSize: cut.fontSize, zone: cut.zone, box: cut.box }),
  measure(input) { return compose(id, input); },
  render(env) {
    const resolved = compose(id, sourceFor(env));
    let bb = null;
    for (const item of resolved.items) bb = union(bb, J.mainDraw(env, item));
    return bb;
  },
}, options.definition || {});

const layouts = {
  captionBottomStack: definition('captionBottomStack', '字幕・下段スタック', 0, 8),
  captionBottomTwoLine: definition('captionBottomTwoLine', '字幕・下段2行', 0, 10),
  captionCenterStack: definition('captionCenterStack', '字幕・中央スタック', 0, 8),
  captionSingleWordHero: definition('captionSingleWordHero', '字幕・単語ヒーロー', 1, 1, { minDuration: 0.35 }),
  captionLeftAnchor: definition('captionLeftAnchor', '字幕・左アンカー', 0, 8),
  captionRightAnchor: definition('captionRightAnchor', '字幕・右アンカー', 0, 8),
  captionTwoLinePunch: definition('captionTwoLinePunch', '字幕・2行パンチ', 1, 8),
};
J.registerAll('layout', layouts, PACK);
})();
