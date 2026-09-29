/* Gate 0.4 disposable aesthetic prototype. Product modules begin in Gate 1. */
'use strict';

const CaptionAestheticSpike = (() => {
  const DURATION = 15;
  const SEGMENTS = [[0, 5], [5, 9], [9, 13], [13, 15], [15, 18], [18, 21]];
  const LAYOUTS = ['bottomStack', 'centerStack', 'twoLinePunch'];
  const PROFILES = {
    creator: { accent: '#b7ff4a', panel: 'rgba(10,11,16,.74)', inactive: '#f7f7f2', fontSize: 82, motions: ['fade', 'softRise', 'softScale'], impactChance: 0.08 },
    punchy: { accent: '#ffde59', panel: 'rgba(9,9,12,.82)', inactive: '#ffffff', fontSize: 92, motions: ['softRise', 'softScale', 'fade'], impactChance: 0.55 },
  };

  function hash(seed, value) {
    let h = (seed ^ 0x9e3779b9) >>> 0;
    for (const ch of String(value)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
    h ^= h >>> 16; h = Math.imul(h, 0x7feb352d); h ^= h >>> 15; return h >>> 0;
  }
  const choice = (items, seed, key) => items[hash(seed, key) % items.length];

  function emphasis(token, previous) {
    if (token.manualEmphasis) return { score: 1, reasons: ['manual'] };
    const reasons = [];
    if (/\d/.test(token.text)) reasons.push('number');
    if (/[!?]$/.test(token.text)) reasons.push('punctuation');
    if (previous && previous.normalizedText === token.normalizedText) reasons.push('repetition');
    return { score: Math.min(1, reasons.length * 0.35), reasons };
  }

  function buildPlan(transcript, profileKey = 'creator', seed = 3107) {
    const profile = PROFILES[profileKey];
    if (!profile) throw new Error(`Unknown profile: ${profileKey}`);
    const tokens = transcript.tokens.map((token, index, all) => Object.assign({}, token, { intent: emphasis(token, all[index - 1]) }));
    const segments = SEGMENTS.map(([from, to], index) => {
      const words = tokens.slice(from, to);
      const strongest = words.reduce((best, token) => token.intent.score > best.intent.score ? token : best, words[0]);
      const hasStrongIntent = strongest.intent.score >= 0.7 || words.some(token => /!$/.test(token.text));
      return {
        id: `demo_segment_${String(index + 1).padStart(2, '0')}`,
        tokenIds: words.map(token => token.id),
        start: Math.max(0, words[0].start - 0.12),
        end: Math.min(DURATION, words[words.length - 1].end + 0.38),
        layout: choice(LAYOUTS, seed, `layout:${index}`),
        motion: choice(profile.motions, seed, `motion:${index}`),
        impact: !!(hasStrongIntent && (hash(seed, `impact:${index}`) / 0xffffffff < profile.impactChance || strongest.manualEmphasis)),
        accent: profile.accent,
      };
    });
    // Guarantee that the short demonstration visibly covers all reviewed layouts and subtle motions.
    LAYOUTS.forEach((layout, index) => { segments[index].layout = layout; });
    ['fade', 'softRise', 'softScale'].forEach((motion, index) => { segments[index].motion = motion; });
    return { version: 1, profileKey, seed, duration: DURATION, tokens, segments };
  }

  const activeToken = (plan, time) => plan.tokens.find(token => time >= token.start && time < token.end) || null;
  const activeSegment = (plan, time) => plan.segments.find(segment => time >= segment.start && time < segment.end) || null;
  const ease = value => 1 - Math.pow(1 - Math.max(0, Math.min(1, value)), 3);

  function lineLayout(ctx, words, maxWidth, font) {
    ctx.font = font;
    const space = ctx.measureText(' ').width;
    const widths = words.map(word => ctx.measureText(word.text).width);
    const total = widths.reduce((sum, width) => sum + width, 0) + space * Math.max(0, words.length - 1);
    if (total <= maxWidth || words.length < 3) return [{ words, widths, width: total }];
    let best = 1;
    let score = Infinity;
    for (let split = 1; split < words.length; split++) {
      const first = widths.slice(0, split).reduce((a, b) => a + b, 0) + space * (split - 1);
      const second = widths.slice(split).reduce((a, b) => a + b, 0) + space * (words.length - split - 1);
      const candidate = Math.max(first, second) + Math.abs(first - second) * 0.25;
      if (candidate < score && first <= maxWidth && second <= maxWidth) { best = split; score = candidate; }
    }
    return [[0, best], [best, words.length]].map(([from, to]) => ({
      words: words.slice(from, to), widths: widths.slice(from, to),
      width: widths.slice(from, to).reduce((a, b) => a + b, 0) + space * Math.max(0, to - from - 1),
    }));
  }

  function render(ctx, plan, time) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const profile = PROFILES[plan.profileKey];
    const gradient = ctx.createLinearGradient(0, 0, W, H);
    gradient.addColorStop(0, '#242735'); gradient.addColorStop(.52, '#151720'); gradient.addColorStop(1, '#31242d');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = .16; ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
    for (let y = 120; y < H; y += 120) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff99'; ctx.font = '600 25px system-ui'; ctx.textAlign = 'left'; ctx.fillText(`JIZURA / ${plan.profileKey.toUpperCase()} / ${plan.seed}`, 54, 70);
    const segment = activeSegment(plan, time);
    if (!segment) return;
    const words = segment.tokenIds.map(id => plan.tokens.find(token => token.id === id));
    const enter = ease((time - segment.start) / .28);
    const exit = Math.max(0, Math.min(1, (segment.end - time) / .22));
    let alpha = exit;
    let translateY = 0;
    let scale = 1;
    if (segment.motion === 'fade') alpha *= enter;
    if (segment.motion === 'softRise') { alpha *= enter; translateY = (1 - enter) * 38; }
    if (segment.motion === 'softScale') { alpha *= enter; scale = .94 + .06 * enter; }
    if (segment.impact) scale *= .96 + .04 * ease((time - segment.start) / .16);
    const size = profile.fontSize + (segment.layout === 'centerStack' ? 14 : 0);
    const weight = segment.impact ? 800 : 720;
    const font = `${weight} ${size}px system-ui, sans-serif`;
    const lines = lineLayout(ctx, words, W - 180, font);
    const lineHeight = size * 1.18;
    let centerY = H - 330;
    if (segment.layout === 'centerStack') centerY = H * .5;
    if (segment.layout === 'twoLinePunch') centerY = H * .69;
    const panelHeight = lines.length * lineHeight + 90;
    ctx.save(); ctx.globalAlpha = alpha; ctx.translate(W / 2, centerY + translateY); ctx.scale(scale, scale);
    ctx.fillStyle = profile.panel; ctx.beginPath(); ctx.roundRect(-W / 2 + 58, -panelHeight / 2, W - 116, panelHeight, 32); ctx.fill();
    const active = activeToken(plan, time);
    const space = (() => { ctx.font = font; return ctx.measureText(' ').width; })();
    lines.forEach((line, lineIndex) => {
      let x = -line.width / 2;
      const y = (lineIndex - (lines.length - 1) / 2) * lineHeight + size * .34;
      line.words.forEach((word, wordIndex) => {
        const wordWidth = line.widths[wordIndex];
        const isActive = active && active.id === word.id;
        const isSpoken = time >= word.end;
        ctx.save();
        ctx.translate(x + wordWidth / 2, y);
        // Active scale is drawn inside a premeasured slot, so neighboring words never reflow.
        if (isActive) ctx.scale(1.035, 1.035);
        ctx.font = font; ctx.textAlign = 'center'; ctx.fillStyle = isActive ? segment.accent : isSpoken ? '#c9cbd2' : profile.inactive;
        ctx.fillText(word.text, 0, 0);
        if (isActive) { ctx.fillStyle = segment.accent; ctx.fillRect(-wordWidth / 2, 15, wordWidth, 7); }
        ctx.restore();
        x += wordWidth + space;
      });
    });
    ctx.restore();
  }

  return { DURATION, LAYOUTS, PROFILES, buildPlan, activeToken, activeSegment, render };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = CaptionAestheticSpike;

if (typeof document !== 'undefined' && document.getElementById('preview')) {
  (async () => {
    const response = await fetch('fixtures/captions/word-timestamps.json');
    const transcript = await response.json();
    const canvas = document.getElementById('preview');
    const ctx = canvas.getContext('2d');
    const timeline = document.getElementById('time');
    const debug = document.getElementById('debug');
    const query = new URLSearchParams(location.search);
    let seed = Number(query.get('seed')) || 3107;
    let profile = CaptionAestheticSpike.PROFILES[query.get('profile')] ? query.get('profile') : 'creator';
    let plan = CaptionAestheticSpike.buildPlan(transcript, profile, seed);
    let playing = false, time = Math.max(0, Math.min(CaptionAestheticSpike.DURATION, Number(query.get('t')) || 0)), startedAt = 0, startTime = time;
    document.getElementById('seed').textContent = `Seed ${seed}`;
    document.querySelectorAll('.profile').forEach(item => item.setAttribute('aria-pressed', item.dataset.profile === profile ? 'true' : 'false'));
    const updateDebug = () => {
      const segment = CaptionAestheticSpike.activeSegment(plan, time);
      const token = CaptionAestheticSpike.activeToken(plan, time);
      debug.textContent = JSON.stringify({ time: +time.toFixed(3), profile, seed, activeSegment: segment && segment.id, activeToken: token && token.id, layout: segment && segment.layout, motion: segment && segment.motion, impact: segment && segment.impact }, null, 2);
    };
    const draw = () => { CaptionAestheticSpike.render(ctx, plan, time); timeline.value = time; updateDebug(); };
    const frame = now => {
      if (playing) {
        time = startTime + (now - startedAt) / 1000;
        if (time >= CaptionAestheticSpike.DURATION) { time = CaptionAestheticSpike.DURATION; playing = false; document.getElementById('play').textContent = 'Play'; }
        draw(); requestAnimationFrame(frame);
      }
    };
    document.getElementById('play').addEventListener('click', event => {
      playing = !playing;
      if (time >= CaptionAestheticSpike.DURATION) time = 0;
      event.currentTarget.textContent = playing ? 'Pause' : 'Play';
      if (playing) { startTime = time; startedAt = performance.now(); requestAnimationFrame(frame); }
    });
    document.getElementById('restart').addEventListener('click', () => { time = 0; startTime = 0; startedAt = performance.now(); draw(); });
    timeline.addEventListener('input', () => { time = +timeline.value; startTime = time; startedAt = performance.now(); draw(); });
    document.querySelectorAll('.profile').forEach(button => button.addEventListener('click', () => {
      profile = button.dataset.profile; plan = CaptionAestheticSpike.buildPlan(transcript, profile, seed);
      document.querySelectorAll('.profile').forEach(item => item.setAttribute('aria-pressed', item === button ? 'true' : 'false')); draw();
    }));
    document.getElementById('variation').addEventListener('click', () => { seed += 1; plan = CaptionAestheticSpike.buildPlan(transcript, profile, seed); document.getElementById('seed').textContent = `Seed ${seed}`; draw(); });
    document.getElementById('seed').addEventListener('click', () => { seed = 3107; plan = CaptionAestheticSpike.buildPlan(transcript, profile, seed); document.getElementById('seed').textContent = `Seed ${seed}`; draw(); });
    draw();
  })().catch(error => { document.getElementById('debug').textContent = error.stack || String(error); });
}
