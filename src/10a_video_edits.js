/* Non-destructive video edits. All times refer to the original source. */
(() => {
'use strict';
J.videoFormats = {
  shorts: { label: 'YouTube Shorts · 9:16 · 1080 × 1920', width: 1080, height: 1920 },
  reels: { label: 'Instagram Reels / Stories · 9:16 · 1080 × 1920', width: 1080, height: 1920 },
  youtube: { label: 'YouTube · 16:9 · 1920 × 1080', width: 1920, height: 1080 },
  square: { label: 'Square post · 1:1 · 1080 × 1080', width: 1080, height: 1080 },
  portrait: { label: 'Portrait post · 4:5 · 1080 × 1350', width: 1080, height: 1350 },
};
J.videoEditSettings = project => project.settings && project.settings.videoEdit || { format: 'shorts', clips: [], panels: [], notes: [] };
/* How a video whose shape differs from the output fills the frame (full-frame layout only; panels always crop to fill).
   contain = whole video with bars, cover = crop to fill, blur = whole video over a blurred, darkened copy of itself.
   Optional in the project: old edits fall back to settings.sourceFit, then 'contain' (unchanged rendering). */
J.VIDEO_FITS = Object.freeze(['contain', 'cover', 'blur']);
J.videoEditFit = project => {
  const edit = J.videoEditSettings(project), fit = edit.fit || project.settings && project.settings.sourceFit;
  return J.VIDEO_FITS.includes(fit) ? fit : 'contain';
};
J.VIDEO_OVERLAY_LIMIT = 4;
J.VIDEO_OVERLAY_MAX_CHARS = 8_000_000;   // data-URL length, about 6 MB of PNG
J.videoOutputSize = project => J.videoFormats[J.videoEditSettings(project).format] || J.videoFormats.shorts;
J.videoClips = (project, duration = project.media.duration) => {
  const clips = J.videoEditSettings(project).clips || [];
  return clips.length ? clips : [{ start: 0, end: duration }];
};
J.videoEditDuration = clips => clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
J.videoSourceTime = (clips, time) => {
  for (const clip of clips) { const length = clip.end - clip.start; if (time < length) return clip.start + Math.max(0, time); time -= length; }
  return clips[clips.length - 1].end;
};
J.validateVideoEdits = (edit, duration) => {
  const fail = message => { throw new Error(message); };
  if (!edit || !J.videoFormats[edit.format]) fail('Choose an output format.');
  for (const key of ['clips', 'panels', 'notes']) if (!Array.isArray(edit[key]) || edit[key].length > 100) fail('Invalid video edit list.');
  if (edit.overlays !== undefined) J.validateVideoOverlays(edit.overlays);
  if (edit.fit !== undefined && !J.VIDEO_FITS.includes(edit.fit)) fail('Choose how the video fills the frame.');
  if (edit.background !== undefined && !/^#[0-9a-f]{6}$/i.test(edit.background)) fail('Check the bar colour.');
  let previousEnd = 0;
  for (const clip of edit.clips) {
    if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < previousEnd || clip.end <= clip.start || !(clip.end <= duration + .001)) fail('Kept sections must be in source order, inside the video, and must not overlap.');
    previousEnd = clip.end;
  }
  for (const panel of edit.panels) for (const rect of [panel.source, panel.target]) {
    if (!rect || !['x', 'y', 'w', 'h'].every(key => Number.isFinite(rect[key])) || rect.x < 0 || rect.y < 0 || rect.w <= 0 || rect.h <= 0 || rect.x + rect.w > 1.00001 || rect.y + rect.h > 1.00001) fail('Crop and placement must fit within the frame.');
  }
  for (const note of edit.notes) {
    if (typeof note.text !== 'string' || !note.text.trim() || note.text.length > 1000 || !Number.isFinite(note.start) || !Number.isFinite(note.end) || note.start < 0 || note.end <= note.start || note.end > duration || !Number.isFinite(note.x) || !Number.isFinite(note.y) || note.x < 0 || note.x > 1 || note.y < 0 || note.y > 1 || !Number.isFinite(note.size) || note.size < 1 || note.size > 15 || !/^#[0-9a-f]{6}$/i.test(note.color)) fail('Check note text, timing, position, size, and color.');
  }
};
/* Overlays are transparent images (frames, logos, templates) stored inside the project as data URLs.
   Rects are fractions of the output frame and may bleed past it. `layer` is 'below' or 'above' the captions. */
J.validateVideoOverlays = overlays => {
  const fail = message => { throw new Error(message); };
  if (!Array.isArray(overlays) || overlays.length > J.VIDEO_OVERLAY_LIMIT) fail(`Use at most ${J.VIDEO_OVERLAY_LIMIT} overlays.`);
  const ids = new Set();
  for (const overlay of overlays) {
    if (!overlay || typeof overlay.id !== 'string' || !overlay.id || ids.has(overlay.id)) fail('Each overlay needs a unique id.');
    ids.add(overlay.id);
    if (typeof overlay.src !== 'string' || !/^data:image\/(png|webp);base64,/.test(overlay.src)) fail('Overlays must be PNG or WebP images.');
    if (overlay.src.length > J.VIDEO_OVERLAY_MAX_CHARS) fail('Overlay image is too large (limit about 6 MB).');
    if (typeof overlay.name !== 'string' || overlay.name.length > 200) fail('Check the overlay name.');
    if (![overlay.x, overlay.y, overlay.w, overlay.h].every(Number.isFinite) || overlay.w <= 0 || overlay.h <= 0 || overlay.w > 4 || overlay.h > 4 || overlay.x < -2 || overlay.y < -2 || overlay.x > 2 || overlay.y > 2) fail('Check overlay position and size.');
    if (!Number.isFinite(overlay.opacity) || overlay.opacity < 0 || overlay.opacity > 1) fail('Overlay opacity must be between 0 and 100%.');
    if (overlay.layer !== 'above' && overlay.layer !== 'below') fail('Overlay layer must be above or below the captions.');
  }
};
// Decoded images are cached by their data URL. Drawing is synchronous, so callers preload first
// (J.preloadVideoOverlays) and an overlay that is not decoded yet is simply skipped for that frame.
const overlayImages = new Map();
J.videoOverlayImage = src => overlayImages.get(src);
J.preloadVideoOverlays = (project, onReady) => {
  const jobs = [];
  for (const overlay of J.videoEditSettings(project).overlays || []) {
    if (overlayImages.has(overlay.src) || typeof Image === 'undefined') continue;
    jobs.push(new Promise(resolve => {
      const image = new Image();
      image.onload = () => { overlayImages.set(overlay.src, image); resolve(); };
      image.onerror = () => resolve();
      image.src = overlay.src;
    }));
  }
  return Promise.all(jobs).then(() => { if (jobs.length && onReady) onReady(); });
};
J.drawVideoOverlays = (ctx, project, layer, info) => {
  const W = info.designWidth, H = info.designHeight;
  for (const overlay of J.videoEditSettings(project).overlays || []) {
    if (layer !== 'all' && overlay.layer !== layer) continue;
    const image = J.videoOverlayImage(overlay.src); if (!image) continue;
    ctx.save();
    try { ctx.globalAlpha *= overlay.opacity; ctx.drawImage(image, overlay.x * W, overlay.y * H, overlay.w * W, overlay.h * H); } finally { ctx.restore(); }
  }
};
/* The blurred background is the cover crop drawn into a small canvas (1/16 of the frame, softened when the
   context supports filters) and scaled back up: cheap per frame and the same in preview and export. */
let blurCanvas = null;
const smallCanvas = (width, height) => {
  if (!blurCanvas) {
    if (typeof OffscreenCanvas === 'function') blurCanvas = new OffscreenCanvas(width, height);
    else if (typeof document !== 'undefined' && document.createElement) blurCanvas = document.createElement('canvas');
    if (!blurCanvas || !blurCanvas.getContext) { blurCanvas = null; return null; }
  }
  if (blurCanvas.width !== width) blurCanvas.width = width;
  if (blurCanvas.height !== height) blurCanvas.height = height;
  return blurCanvas;
};
const drawBlurredFill = (ctx, video, width, height, background) => {
  const small = smallCanvas(Math.max(8, Math.round(width / 16)), Math.max(8, Math.round(height / 16))), sctx = small && small.getContext('2d');
  if (sctx) {
    J.drawSourceVideo(sctx, video, small.width, small.height, 'cover', background);
    if ('filter' in sctx) {
      // Soften in place: draw the tiny frame onto itself through a blur (a second pass hides the pixel grid).
      sctx.save(); try { sctx.filter = 'blur(1.5px)'; sctx.drawImage(small, 0, 0); } finally { sctx.restore(); }
    }
  }
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = background; ctx.fillRect(0, 0, width, height);
    if (sctx) { ctx.imageSmoothingEnabled = true; if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high'; ctx.drawImage(small, 0, 0, width, height); }
    else J.drawSourceVideo(ctx, video, width, height, 'cover', background);
    ctx.fillStyle = 'rgba(0,0,0,.35)'; ctx.fillRect(0, 0, width, height);
  } finally { ctx.restore(); }
  const rect = J.sourceFrameRect(Number(video.videoWidth || video.displayWidth || video.naturalWidth || video.width), Number(video.videoHeight || video.displayHeight || video.naturalHeight || video.height), width, height, 'contain');
  ctx.save(); try { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height); } finally { ctx.restore(); }
  return Object.assign({}, rect, { fit: 'blur' });
};
J.drawVideoEdit = (ctx, video, width, height, project) => {
  const edit = J.videoEditSettings(project), panels = edit.panels || [];
  if (!panels.length) {
    const fit = J.videoEditFit(project), background = edit.background || '#000000';
    return fit === 'blur' ? drawBlurredFill(ctx, video, width, height, background) : J.drawSourceVideo(ctx, video, width, height, fit, background);
  }
  const sw = video.videoWidth || video.displayWidth || video.width, sh = video.videoHeight || video.displayHeight || video.height;
  ctx.save();
  try {
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height);
    for (const panel of panels) {
      const s = panel.source, t = panel.target;
      const fit = J.sourceFrameRect(s.w * sw, s.h * sh, t.w * width, t.h * height, 'cover');
      const cropW = t.w * width / fit.scale, cropH = t.h * height / fit.scale;
      ctx.drawImage(video, s.x * sw + (s.w * sw - cropW) / 2, s.y * sh + (s.h * sh - cropH) / 2, cropW, cropH, t.x * width, t.y * height, t.w * width, t.h * height);
    }
  } finally { ctx.restore(); }
};
J.drawVideoNotes = (ctx, project, time, info) => {
  const W = info.designWidth, H = info.designHeight;
  for (const note of J.videoEditSettings(project).notes || []) {
    if (time < note.start || time >= note.end) continue;
    ctx.save();
    try {
      const size = Math.min(W, H) * note.size / 100;
      ctx.font = `700 ${size}px sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      const lines = [], maxWidth = W * .9;
      for (const paragraph of note.text.split('\n')) {
        let line = '';
        for (const char of Array.from(paragraph)) { if (line && ctx.measureText(line + char).width > maxWidth) { lines.push(line); line = ''; } line += char; }
        lines.push(line);
      }
      lines.forEach((line, i) => {
        const x = Math.max(W * .05 + ctx.measureText(line).width / 2, Math.min(W * .95 - ctx.measureText(line).width / 2, note.x * W));
        const y = Math.max(size / 2, Math.min(H - size / 2, note.y * H + (i - (lines.length - 1) / 2) * size * 1.2));
        ctx.lineWidth = size * .13; ctx.strokeStyle = '#000'; ctx.strokeText(line, x, y); ctx.fillStyle = note.color; ctx.fillText(line, x, y);
      });
    } finally { ctx.restore(); }
  }
};
})();
