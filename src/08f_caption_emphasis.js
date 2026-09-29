/* ============================================================
   JIZURA — explainable caption emphasis intent (Gate 2.2)
   ============================================================ */
(() => {
'use strict';

const clamp = value => Math.max(0, Math.min(1, Number(value) || 0));
const clone = value => JSON.parse(JSON.stringify(value));
const terminal = /[.!?\u2026\u3002\uff01\uff1f]["')\u3009\u300b\u300d\u300f\u3011\uff09]*$/u;
const expressive = /[!?\uff01\uff1f]["')\u3009\u300b\u300d\u300f\u3011\uff09]*$/u;
const punctuation = /[,;:\u3001\uff0c\uff1b\uff1a]["')\u3009\u300b\u300d\u300f\u3011\uff09]*$/u;
const currency = /^(?:(?:[$¢£¥₩€₹₽₫]|R\$)\s*)[-+]?(?:\d[\d.,]*|[.,]\d+)(?:\s*(?:USD|EUR|GBP|JPY|CNY|RMB|KRW|BRL|INR))?$/iu;
const percentage = /^[-+]?(?:\d[\d.,]*|[.,]\d+)\s*%$/u;
const number = /^[-+]?(?:\d[\d.,]*|[.,]\d+)(?:st|nd|rd|th)?$/iu;
const letters = /\p{L}/u;

const normalized = token => {
  if (token && typeof token.normalizedText === 'string' && token.normalizedText) return token.normalizedText;
  return typeof J.normalizeTokenText === 'function' ? J.normalizeTokenText(token && token.text) : String(token && token.text || '').trim().toLocaleLowerCase();
};

const manualIntent = manual => {
  if (!manual || typeof manual !== 'object' || typeof manual.enabled !== 'boolean') return null;
  const enabled = manual.enabled;
  const requested = Number.isFinite(manual.score) ? clamp(manual.score) : enabled ? 1 : 0;
  return {
    score: enabled ? requested : 0,
    reasons: [enabled ? 'manual' : 'manual-disabled'],
    manual: true,
  };
};

const capitalizationSignal = (text, sentenceStart) => {
  const raw = String(text || '').replace(/[^\p{L}]+/gu, '');
  if (raw.length < 2 || !letters.test(raw)) return null;
  const upper = raw === raw.toLocaleUpperCase() && raw !== raw.toLocaleLowerCase();
  if (upper) return { reason: 'all-caps', weight: 0.16 };
  const initial = raw[0] === raw[0].toLocaleUpperCase() && raw[0] !== raw[0].toLocaleLowerCase();
  return initial && !sentenceStart ? { reason: 'capitalization', weight: 0.07 } : null;
};

/* Score a single token. Context is intentionally simple and inspectable:
   { index, tokens } or { previous, repetitionCount, sentenceStart }. */
J.scoreCaptionEmphasis = (token, context = {}) => {
  const manual = manualIntent(token && token.manualEmphasis);
  if (manual) return manual;

  const tokens = Array.isArray(context.tokens) ? context.tokens : null;
  const index = Number.isInteger(context.index) ? context.index : -1;
  const previous = context.previous || (tokens && index > 0 ? tokens[index - 1] : null);
  const text = String(token && token.text || '').trim();
  const key = normalized(token);
  const previousText = String(previous && previous.text || '');
  const sentenceStart = context.sentenceStart === true || !previous || terminal.test(previousText);
  const reasons = [], contributions = [];
  const add = (reason, weight) => { reasons.push(reason); contributions.push({ reason, weight }); };

  if (expressive.test(text)) add('expressive-punctuation', 0.24);
  else if (terminal.test(text)) add('sentence-final', 0.13);
  else if (punctuation.test(text)) add('punctuation', 0.06);

  if (percentage.test(text)) add('percentage', 0.34);
  else if (currency.test(text)) add('currency', 0.34);
  else if (number.test(text)) add('number', 0.24);

  let repetitionCount = Number.isInteger(context.repetitionCount) ? context.repetitionCount : 1;
  if (tokens && index >= 0) {
    repetitionCount = 1;
    for (let cursor = index - 1; cursor >= 0 && normalized(tokens[cursor]) === key; cursor--) repetitionCount++;
  } else if (previous && normalized(previous) === key) repetitionCount = Math.max(2, repetitionCount);
  if (key && repetitionCount > 1) add('repetition', Math.min(0.48, 0.18 + (repetitionCount - 1) * 0.1));

  const caps = capitalizationSignal(text, sentenceStart);
  if (caps) add(caps.reason, caps.weight);

  return {
    score: +clamp(contributions.reduce((sum, item) => sum + item.weight, 0)).toFixed(3),
    reasons,
    contributions,
    manual: false,
  };
};

/* Return a new transcript; imported text, timings, stable IDs, and manual data
   remain untouched. Only the generated emphasis field is replaced. */
J.applyCaptionEmphasis = transcript => {
  if (typeof J.validateTranscript === 'function') J.validateTranscript(transcript);
  const result = clone(transcript);
  // Typed text blocks and speech are scored as separate streams, so a title laid over speech
  // does not change the context (sentence start, repetition) of the spoken words, or vice versa.
  const typed = token => token.source === 'manual';
  const speech = result.tokens.filter(token => !typed(token)), blocks = result.tokens.filter(typed);
  const scored = new Map();
  for (const stream of [speech, blocks]) stream.forEach((token, index) => scored.set(token, J.scoreCaptionEmphasis(token, { index, tokens: stream })));
  result.tokens = result.tokens.map(token => Object.assign({}, token, { emphasis: scored.get(token) }));
  return result;
};
})();
