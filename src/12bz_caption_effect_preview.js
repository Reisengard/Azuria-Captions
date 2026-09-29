/* ============================================================
   JIZURA — animated effect thumbnails for the caption Style panel
   Draws one sample caption through the same compositor as the preview and the export, so a thumbnail shows
   exactly what the effect does. Nothing here touches a project: the sample is built in memory.
   ============================================================ */
(() => {
'use strict';

const SAMPLE_WORDS = ['Lyric'];
const SAMPLE_WORDS_MANY = ['Lyric', 'caption', 'preview'];   // layouts and the spoken word need more than one word to show anything
const FRAME = { width: 320, height: 180 };
const cache = new Map();

/* A one-caption project. `plan` holds the effect choices; unset stages stay still / plain. */
J.captionSampleProject = (plan = {}, options = {}) => {
  const duration = options.duration || 2.4, words = options.words || SAMPLE_WORDS, per = duration / words.length, frame = options.frame || FRAME;
  const emphasize = new Set(options.emphasize || []);
  const tokens = words.map((text, index) => Object.assign({ id: `w${index}`, text, start: index * per, end: (index + 1) * per, source: 'sample' },
    emphasize.has(index) ? { manualEmphasis: { enabled: true } } : {}));
  const segment = { id: 's1', start: 0, end: duration, tokenIds: tokens.map(token => token.id), trackId: J.CAPTION_PRIMARY_TRACK_ID };
  const box = { x: .05, y: .1, width: .9, height: .8 };
  const generated = Object.assign({ id: 'p1', segmentId: 's1', trackId: J.CAPTION_PRIMARY_TRACK_ID, layout: 'captionCenterStack', entrance: 'cut', hold: 'captionStill', exit: 'cut',
    activeWordTreatment: 'captionActiveColor', captionTreatment: 'outline', motion: .7, seed: 7, fontSize: 56, box, accentColor: '#4fd6ff', textColor: '#ffffff' }, plan);
  const track = Object.assign({ id: J.CAPTION_PRIMARY_TRACK_ID, primary: true, box }, options.roles ? { roles: options.roles } : {});
  return { mode: 'video-captions', media: { width: frame.width, height: frame.height, duration }, transcript: { tokens }, tracks: [track],
    segments: [segment], plans: { s1: { id: 'p1', segmentId: 's1', generated, manual: {}, lockedFields: [] } }, style: { preset: 'creator' }, settings: {}, seed: 1 };
};

/* A still sample of a track's word styles: the second word is being spoken, the last one is emphasised.
   `plan` carries what the track resolves to (font, colours, spoken-word effect, text finish); `roles` are the track's roles. */
const ROLE_SAMPLE_WORDS = ['Every', 'word', 'counts', '100%'];
const ROLE_SAMPLE_FRAME = { width: 400, height: 125 };
J.paintCaptionRoleSample = (canvas, roles, plan = {}) => {
  const ctx = canvas.getContext('2d'), per = .6, words = ROLE_SAMPLE_WORDS;
  const project = J.captionSampleProject(Object.assign({ fontSize: 34, box: { x: .03, y: .06, width: .94, height: .88 } }, plan),
    { words, duration: words.length * per, frame: ROLE_SAMPLE_FRAME, roles, emphasize: [words.length - 1] });
  const scale = canvas.width / ROLE_SAMPLE_FRAME.width;
  try {
    ctx.save(); ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0d1826'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    J.drawCaptionOverlay(ctx, project, per * 1.5, { designWidth: ROLE_SAMPLE_FRAME.width, designHeight: ROLE_SAMPLE_FRAME.height, scale: 1, reducedMotion: true });
    ctx.restore();
  } catch (error) {
    try { ctx.restore(); } catch (ignored) { /* nothing was saved */ }
    ctx.fillStyle = '#131316'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  canvas.dataset.ready = '1';
};

/* Which stage of the sample to loop for a group: the entrance, the middle, or the exit. */
J.captionEffectSampleTime = (group, now, duration = 2.4) => {
  const u = now / 1000;
  if (group === 'enter') return ((u % 1.6) / 1.6) * Math.min(.9, duration * .4);
  if (group === 'exit') return duration - Math.min(.7, duration * .3) + ((u % 1.6) / 1.6) * Math.min(.69, duration * .29);
  return .3 + ((u % 2.2) / 2.2) * (duration - .6);
};

/* Plan fields for previewing one choice of `group` on top of a neutral base. */
const GROUP_FIELD = { layout: 'layout', enter: 'entrance', hold: 'hold', exit: 'exit', active: 'activeWordTreatment', treat: 'textTreatment', decor: 'decoration' };

J.captionEffectPreviewPlan = (group, id, base = {}) => {
  const plan = Object.assign({}, base);
  const field = GROUP_FIELD[group];
  if (field) plan[field] = id;
  if (group === 'hold' || group === 'active') plan.entrance = 'cut';
  if (group === 'exit') plan.hold = 'captionStill';
  return plan;
};

/* Draw the sample of one choice at `now` (ms) into a canvas. Fails soft: a dark tile. */
J.paintCaptionEffect = (canvas, group, id, now, base) => {
  const ctx = canvas.getContext('2d');
  const key = [group, id, JSON.stringify(base || {})].join('|');
  let project = cache.get(key);
  if (!project) { project = J.captionSampleProject(J.captionEffectPreviewPlan(group, id, base), { words: group === 'layout' || group === 'active' ? SAMPLE_WORDS_MANY : SAMPLE_WORDS }); cache.set(key, project); if (cache.size > 400) cache.delete(cache.keys().next().value); }
  const scale = canvas.width / FRAME.width;
  try {
    ctx.save(); ctx.clearRect(0, 0, canvas.width, canvas.height);
    const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height); gradient.addColorStop(0, '#0d2036'); gradient.addColorStop(1, '#0a1626');
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.scale(scale, scale);
    J.drawCaptionOverlay(ctx, project, J.captionEffectSampleTime(group, now, project.media.duration), { designWidth: FRAME.width, designHeight: FRAME.height, scale: 1 });
    ctx.restore();
  } catch (error) {
    try { ctx.restore(); } catch (ignored) { /* nothing was saved */ }
    ctx.fillStyle = '#131316'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  canvas.dataset.ready = '1';
};

/* ---- live thumbnails: only cards on screen are painted, at ~15 fps; a still frame when motion is reduced ---- */
const live = new Set();
let observer = null, raf = 0, last = 0;
J.captionEffectPreviewMotion = true;
const paintCard = (canvas, now) => {
  const base = canvas.__base || null;
  J.paintCaptionEffect(canvas, canvas.dataset.g, canvas.dataset.k, J.captionEffectPreviewMotion ? now : 900, base);
};
const tick = now => {
  raf = 0;
  if (document.hidden || !live.size) return;
  if (now - last >= 66) {
    last = now;
    for (const canvas of live) { if (!canvas.isConnected) { live.delete(canvas); continue; } paintCard(canvas, now); }
  }
  if (J.captionEffectPreviewMotion) raf = requestAnimationFrame(tick);
};
J.refreshCaptionEffectPreviews = () => { if (!raf && live.size) raf = requestAnimationFrame(tick); };
/* Start animating one thumbnail canvas (data-g = group, data-k = id; canvas.__base = plan fields shared by every card). */
J.watchCaptionEffect = canvas => {
  if (typeof IntersectionObserver !== 'function') { paintCard(canvas, 0); return; }
  if (!observer) observer = new IntersectionObserver(entries => {
    for (const entry of entries) { if (entry.isIntersecting) live.add(entry.target); else live.delete(entry.target); }
    J.refreshCaptionEffectPreviews();
  }, { rootMargin: '40px 0px', threshold: [0, .1] });
  paintCard(canvas, performance.now());
  observer.observe(canvas);
};
J.resetCaptionEffectWatch = () => { live.clear(); if (observer) { observer.disconnect(); observer = null; } };
if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') document.addEventListener('visibilitychange', () => { if (!document.hidden) J.refreshCaptionEffectPreviews(); });
})();
