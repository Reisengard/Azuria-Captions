/* ============================================================
   JIZURA — source-video preview clock and Canvas composition
   ============================================================ */
'use strict';

(() => {
class MediaPreviewError extends Error {
  constructor(code, message) { super(message); this.name = 'MediaPreviewError'; this.code = code; }
}
const finite = value => Number.isFinite(value);

function previewCanvasSize(canvas, options = {}, env = globalThis) {
  const dpr = Math.max(1, Number(options.pixelRatio || env.devicePixelRatio) || 1);
  const cssWidth = Math.max(1, Number(options.cssWidth || canvas.clientWidth || options.designWidth || canvas.width || 1));
  const cssHeight = Math.max(1, Number(options.cssHeight || canvas.clientHeight || options.designHeight || canvas.height || 1));
  const maxPixels = Math.max(1, Number(options.maxPixels) || 2073600);
  const requestedPixels = cssWidth * cssHeight * dpr * dpr;
  const reduction = requestedPixels > maxPixels ? Math.sqrt(maxPixels / requestedPixels) : 1;
  return { width: Math.max(1, Math.round(cssWidth * dpr * reduction)), height: Math.max(1, Math.round(cssHeight * dpr * reduction)),
    cssWidth, cssHeight, pixelRatio: dpr * reduction, scaleReduction: reduction };
}

function sourceFrameRect(sourceWidth, sourceHeight, targetWidth, targetHeight, fit = 'contain') {
  if (!(sourceWidth > 0 && sourceHeight > 0 && targetWidth > 0 && targetHeight > 0)) {
    throw new MediaPreviewError('MEDIA_PREVIEW_DIMENSIONS_INVALID', 'Source and preview dimensions must be positive.');
  }
  if (fit !== 'contain' && fit !== 'cover') throw new MediaPreviewError('MEDIA_PREVIEW_FIT_INVALID', `Unknown preview fit policy “${fit}”.`);
  const scale = (fit === 'cover' ? Math.max : Math.min)(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale, height = sourceHeight * scale;
  return { x: (targetWidth - width) / 2, y: (targetHeight - height) / 2, width, height, scale, fit };
}

function drawSourceVideo(ctx, video, width, height, fit = 'contain', background = '#000000') {
  // Preview uses an HTMLVideoElement, while export uses decoded canvas frames.
  // Those expose their intrinsic dimensions under different property names.
  const sourceWidth = Number(video && (video.videoWidth || video.displayWidth || video.naturalWidth || video.width));
  const sourceHeight = Number(video && (video.videoHeight || video.displayHeight || video.naturalHeight || video.height));
  const rect = sourceFrameRect(sourceWidth, sourceHeight, width, height, fit);
  ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over'; ctx.filter = 'none';
  try { ctx.fillStyle = background; ctx.fillRect(0, 0, width, height); ctx.drawImage(video, rect.x, rect.y, rect.width, rect.height); }
  finally { ctx.restore(); }
  return rect;
}

class MediaPreviewController {
  constructor(options = {}) {
    if (!options.video) throw new MediaPreviewError('MEDIA_PREVIEW_VIDEO_REQUIRED', 'Preview requires a video element.');
    if (!options.canvas || typeof options.canvas.getContext !== 'function') throw new MediaPreviewError('MEDIA_PREVIEW_CANVAS_REQUIRED', 'Preview requires a Canvas.');
    this.video = options.video; this.canvas = options.canvas; this.ctx = options.context || this.canvas.getContext('2d');
    if (!this.ctx) throw new MediaPreviewError('MEDIA_PREVIEW_CONTEXT_UNAVAILABLE', 'The preview Canvas has no 2D context.');
    this.env = options.env || globalThis; this.fit = options.fit || 'contain'; this.background = options.background || '#000000';
    this.designWidth = Number(options.designWidth) || 1080; this.designHeight = Number(options.designHeight) || 1920;
    this.maxPixels = Number(options.maxPixels) || 2073600; this.renderCaptions = typeof options.renderCaptions === 'function' ? options.renderCaptions : null;
    this.onFrame = typeof options.onFrame === 'function' ? options.onFrame : null;
    this.renderSource = options.renderSource || drawSourceVideo;
    this.constrainAspect = options.constrainAspect === true;
    this.onError = typeof options.onError === 'function' ? options.onError : null;
    this.debugOverlay = options.debugOverlay || null; this.getDebugState = typeof options.getDebugState === 'function' ? options.getDebugState : null;
    this.connected = false; this.callbackId = null; this.callbackKind = null; this.drawing = false; this.lastPresentedFrames = null;
    this.diagnostics = { callbacks: 0, renderedFrames: 0, droppedCallbacks: 0, lastMediaTime: 0, lastPresentedFrameTime: null, previewScale: 1 };
    this._listeners = { play: () => this._schedule(), pause: () => { this._cancel(); this.renderNow(); }, seeking: () => this.renderNow(),
      seeked: () => this.renderNow(), loadeddata: () => this.renderNow(), ended: () => { this._cancel(); this.renderNow(); } };
  }

  connect() {
    if (this.connected) return this;
    for (const [name, listener] of Object.entries(this._listeners)) this.video.addEventListener(name, listener);
    this.connected = true; this.renderNow(); if (!this.video.paused && !this.video.ended) this._schedule(); return this;
  }

  disconnect() {
    this._cancel();
    if (this.connected) for (const [name, listener] of Object.entries(this._listeners)) this.video.removeEventListener(name, listener);
    this.connected = false; this.lastPresentedFrames = null;
  }

  setCaptionRenderer(renderCaptions) { this.renderCaptions = typeof renderCaptions === 'function' ? renderCaptions : null; this.renderNow(); }
  setFit(fit) { sourceFrameRect(1, 1, 1, 1, fit); this.fit = fit; this.renderNow(); }

  renderNow(time) { return this._render(finite(time) ? time : Number(this.video.currentTime) || 0, null); }

  _render(time, metadata) {
    try { return this._draw(time, metadata); }
    catch (error) {
      if (this.onError) this.onError(error);
      else if (this.env.console) this.env.console.error('Video preview could not render a frame.', error);
      return null;
    }
  }

  _resize() {
    const sizing = { designWidth: this.designWidth, designHeight: this.designHeight, maxPixels: this.maxPixels };
    if (this.constrainAspect && this.canvas.parentElement) {
      const parent = this.canvas.parentElement;
      const fit = sourceFrameRect(this.designWidth, this.designHeight, Math.max(1, parent.clientWidth), Math.max(1, parent.clientHeight));
      sizing.cssWidth = fit.width; sizing.cssHeight = fit.height;
      Object.assign(this.canvas.style, { width: `${fit.width}px`, height: `${fit.height}px`, position: 'relative', inset: 'auto' });
    }
    const size = previewCanvasSize(this.canvas, sizing, this.env);
    if (this.canvas.width !== size.width) this.canvas.width = size.width;
    if (this.canvas.height !== size.height) this.canvas.height = size.height;
    this.diagnostics.previewScale = Math.min(size.width / this.designWidth, size.height / this.designHeight);
    return size;
  }

  _draw(time, metadata) {
    // Metadata can arrive before a decoded frame is available to drawImage.
    if (Number.isFinite(this.video.readyState) && this.video.readyState < 2) return null;
    if (this.drawing || !(this.video.videoWidth > 0 && this.video.videoHeight > 0)) { if (this.drawing) this.diagnostics.droppedCallbacks++; return null; }
    this.drawing = true;
    try {
      const size = this._resize(), rect = this.renderSource(this.ctx, this.video, size.width, size.height, this.fit, this.background);
      const sx = size.width / this.designWidth, sy = size.height / this.designHeight, designScale = Math.min(sx, sy);
      const offsetX = (size.width - this.designWidth * designScale) / 2, offsetY = (size.height - this.designHeight * designScale) / 2;
      if (this.renderCaptions || this.debugOverlay && typeof this.debugOverlay.draw === 'function') {
        this.ctx.save();
        try {
          this.ctx.setTransform(designScale, 0, 0, designScale, offsetX, offsetY);
          if (this.renderCaptions) this.renderCaptions(this.ctx, time, { designWidth: this.designWidth, designHeight: this.designHeight, canvasWidth: size.width,
            canvasHeight: size.height, scale: designScale, offsetX, offsetY, sourceRect: rect });
          if (this.debugOverlay && typeof this.debugOverlay.draw === 'function') {
            const extra = this.getDebugState ? this.getDebugState(time, metadata) || {} : {};
            this.debugOverlay.draw(this.ctx, Object.assign({}, extra, { mediaTime: time, metadata,
              previewDiagnostics: this.diagnostics, previewScale: designScale }));
          }
        } finally { this.ctx.restore(); }
      }
      this.diagnostics.renderedFrames++; this.diagnostics.lastMediaTime = time;
      this.diagnostics.lastPresentedFrameTime = metadata && finite(metadata.expectedDisplayTime) ? metadata.expectedDisplayTime : null;
      const detail = { mediaTime: time, metadata, sourceRect: rect, size, diagnostics: Object.assign({}, this.diagnostics) };
      if (this.onFrame) this.onFrame(detail); return detail;
    } finally { this.drawing = false; }
  }

  _schedule() {
    if (!this.connected || this.callbackId != null || this.video.paused || this.video.ended) return;
    if (typeof this.video.requestVideoFrameCallback === 'function') {
      this.callbackKind = 'video'; this.callbackId = this.video.requestVideoFrameCallback((now, metadata) => {
        this.callbackId = null; this.diagnostics.callbacks++;
        if (metadata && finite(metadata.presentedFrames)) {
          if (this.lastPresentedFrames != null && metadata.presentedFrames > this.lastPresentedFrames + 1) this.diagnostics.droppedCallbacks += metadata.presentedFrames - this.lastPresentedFrames - 1;
          this.lastPresentedFrames = metadata.presentedFrames;
        }
        const time = metadata && finite(metadata.mediaTime) ? metadata.mediaTime : Number(this.video.currentTime) || 0;
        try { this._render(time, metadata); } finally { this._schedule(); }
      });
    } else if (typeof this.env.requestAnimationFrame === 'function') {
      this.callbackKind = 'animation'; this.callbackId = this.env.requestAnimationFrame(() => {
        this.callbackId = null; this.diagnostics.callbacks++;
        try { this._render(Number(this.video.currentTime) || 0, null); } finally { this._schedule(); }
      });
    }
  }

  _cancel() {
    if (this.callbackId == null) return;
    if (this.callbackKind === 'video' && typeof this.video.cancelVideoFrameCallback === 'function') this.video.cancelVideoFrameCallback(this.callbackId);
    else if (this.callbackKind === 'animation' && typeof this.env.cancelAnimationFrame === 'function') this.env.cancelAnimationFrame(this.callbackId);
    this.callbackId = null; this.callbackKind = null;
  }
}

J.MediaPreviewError = MediaPreviewError;
J.previewCanvasSize = previewCanvasSize;
J.sourceFrameRect = sourceFrameRect;
J.drawSourceVideo = drawSourceVideo;
J.MediaPreviewController = MediaPreviewController;
})();
