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
J.drawVideoEdit = (ctx, video, width, height, project) => {
  const panels = J.videoEditSettings(project).panels || [];
  if (!panels.length) return J.drawSourceVideo(ctx, video, width, height, project.settings.sourceFit || 'contain');
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
