/* ============================================================
   JIZURA — development-only media/caption diagnostics overlay
   ============================================================ */
'use strict';

(() => {
const finite = value => Number.isFinite(value);
const activeAt = (items, time) => (items || []).find(item => finite(item.start) && finite(item.end) && item.start <= time && time < item.end) || null;
const resolvedPlan = stored => stored ? Object.assign({}, stored.generated || stored, stored.manual || {}) : null;
const yesNo = value => value ? 'yes' : 'no';

function mediaDebugEnabled(env = globalThis, explicit) {
  if (typeof explicit === 'boolean') return explicit;
  try { return new env.URLSearchParams(env.location && env.location.search || '').get('jizuraDebug') === '1'; }
  catch (error) { return false; }
}

function mediaCapabilityLabel(capabilities) {
  if (!capabilities) return 'not probed';
  const summary = capabilities.summary || capabilities;
  return `preview:${yesNo(summary.preview)} frame-cb:${yesNo(summary.preciseFrameCallbacks)} codecs:${yesNo(summary.selectedCodecsSupported)} worker-canvas:${yesNo(summary.workerCanvas)} file-save:${yesNo(summary.fileBackedSave)}`;
}

function mediaDebugSnapshot(input = {}) {
  const time = finite(input.mediaTime) ? input.mediaTime : 0;
  const project = input.project || {};
  const planning = input.planning || {};
  const segments = input.segments || planning.segments || project.segments || [];
  const tokens = input.tokens || planning.tokens || project.transcript && project.transcript.tokens || [];
  const segment = activeAt(segments, time), token = activeAt(tokens, time);
  const plans = input.plans || planning.plans || project.plans || {};
  const stored = segment && plans[segment.id], plan = resolvedPlan(stored);
  const metadata = input.metadata || {};
  const diagnostics = input.previewDiagnostics || input.diagnostics || {};
  return Object.freeze({
    mediaTime: time,
    presentedFrameTimestamp: finite(metadata.presentationTime) ? metadata.presentationTime : finite(metadata.expectedDisplayTime) ? metadata.expectedDisplayTime : null,
    presentedFrames: finite(metadata.presentedFrames) ? metadata.presentedFrames : null,
    activeSegmentId: segment && segment.id || null, activeTokenId: token && token.id || null,
    planId: stored && stored.id || plan && plan.id || null, seed: plan && finite(plan.seed) ? plan.seed : finite(planning.seed) ? planning.seed : finite(project.seed) ? project.seed : null,
    zone: plan && (plan.zoneId || plan.position) || null, layout: plan && plan.layout || null,
    previewScale: finite(input.previewScale) ? input.previewScale : finite(diagnostics.previewScale) ? diagnostics.previewScale : null,
    droppedCallbacks: Number(diagnostics.droppedCallbacks) || 0,
    capabilities: mediaCapabilityLabel(input.capabilities),
  });
}

function mediaDebugLines(snapshot) {
  const number = (value, digits = 3) => finite(value) ? value.toFixed(digits) : '—';
  return [
    `media ${number(snapshot.mediaTime)}s  presented ${number(snapshot.presentedFrameTimestamp, 1)}ms  frame ${snapshot.presentedFrames == null ? '—' : snapshot.presentedFrames}`,
    `segment ${snapshot.activeSegmentId || '—'}  token ${snapshot.activeTokenId || '—'}`,
    `plan ${snapshot.planId || '—'}  seed ${snapshot.seed == null ? '—' : snapshot.seed}`,
    `zone ${snapshot.zone || '—'}  layout ${snapshot.layout || '—'}`,
    `scale ${number(snapshot.previewScale, 3)}  dropped ${snapshot.droppedCallbacks}`,
    `capabilities ${snapshot.capabilities}`,
  ];
}

class MediaDebugOverlay {
  constructor(options = {}) {
    this.env = options.env || globalThis; this.enabled = mediaDebugEnabled(this.env, options.enabled);
    this.fontSize = Number(options.fontSize) || 18; this.padding = Number(options.padding) || 14;
    this.lastSnapshot = null;
  }
  setEnabled(enabled) { this.enabled = !!enabled; }
  draw(ctx, input) {
    if (!this.enabled) return null;
    const snapshot = mediaDebugSnapshot(input), lines = mediaDebugLines(snapshot), size = this.fontSize, pad = this.padding, lineHeight = size * 1.35;
    ctx.save();
    try {
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
      ctx.font = `600 ${size}px ui-monospace, SFMono-Regular, Consolas, monospace`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      let width = 0;
      for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
      ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(pad, pad, width + pad * 2, lines.length * lineHeight + pad * 2);
      ctx.fillStyle = '#B7FF4A';
      lines.forEach((line, index) => ctx.fillText(line, pad * 2, pad * 2 + index * lineHeight));
    } finally { ctx.restore(); }
    this.lastSnapshot = snapshot; return snapshot;
  }
}

J.mediaDebugEnabled = mediaDebugEnabled;
J.mediaCapabilityLabel = mediaCapabilityLabel;
J.mediaDebugSnapshot = mediaDebugSnapshot;
J.mediaDebugLines = mediaDebugLines;
J.MediaDebugOverlay = MediaDebugOverlay;
})();
