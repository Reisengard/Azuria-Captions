/* ============================================================
   JIZURA — production Video Captions MP4 export (Gate 6.2–6.5)
   ============================================================ */
'use strict';

(() => {
const WIDTH = 1080, HEIGHT = 1920, FPS = 30, MAX_BLOB_SECONDS = 30, MAX_BLOB_SOURCE_BYTES = 128 * 1024 * 1024;
class CaptionExportError extends Error { constructor(code, message, details) { super(message); this.name = 'CaptionExportError'; this.code = code; Object.assign(this, details || {}); } }
const fail = (code, message, details) => { throw new CaptionExportError(code, message, details); };
const abortCheck = signal => { if (signal && signal.aborted) fail('MEDIA_EXPORT_CANCELLED', 'Video export was cancelled.'); };
const timestamps = (duration, fps) => Array.from({ length: Math.ceil(duration * fps) }, (_, index) => index / fps);

function streamTarget(M, writable) {
  const stream = new WritableStream({
    async write(chunk) { await writable.seek(chunk.position); await writable.write(chunk.data); },
    close() { return writable.close(); },
    abort(reason) { return writable.abort ? writable.abort(reason) : writable.close(); },
  });
  return new M.StreamTarget(stream, { chunked: true, chunkSize: 8 * 1024 * 1024 });
}

async function checkCaptionExportSupport(info, env = globalThis) {
  const config = { codec: 'avc1.420033', width: info.outputWidth || WIDTH, height: info.outputHeight || HEIGHT, bitrate: 8_000_000, framerate: FPS, latencyMode: 'quality' };
  if (!env.VideoEncoder || typeof env.VideoEncoder.isConfigSupported !== 'function') return { supported: false, reason: 'Video encoding is unavailable. Use the latest Chrome or Edge.' };
  try { const result = await env.VideoEncoder.isConfigSupported(config); return { supported: !!result.supported, config: result.config || config,
    reason: result.supported ? null : `H.264 encoding at ${config.width}×${config.height} is unavailable. Try Chrome or Edge, or update graphics drivers.` }; }
  catch (error) { return { supported: false, reason: `H.264 capability check failed: ${error.message || error}` }; }
}

class CaptionVideoExporter {
  constructor(options = {}) { this.env = options.env || globalThis; this.library = options.library || this.env.Mediabunny; this.adapterFactory = options.adapterFactory || ((file, config) => new J.MediaDemuxAdapter(file, config)); this.running = false; this.output = null; this.adapter = null; }

  async export(file, project, options = {}) {
    if (this.running) fail('MEDIA_EXPORT_BUSY', 'A video export is already running.');
    this.running = true; const signal = options.signal, M = this.library, startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now(); let target, bufferTarget;
    const progress = (phase, value, detail) => options.onProgress && options.onProgress({ phase, progress: Math.max(0, Math.min(1, value)), detail });
    try {
      if (!M || !M.Output || !M.CanvasSource || !M.Mp4OutputFormat) fail('MEDIA_EXPORT_ENGINE_UNAVAILABLE', 'The bundled video export engine could not be loaded. Reload JIZURA.');
      progress('checking', 0, 'Checking source and codecs'); abortCheck(signal);
      this.adapter = this.adapterFactory(file, { library: M }); const info = await this.adapter.open(signal);
      const size = J.videoOutputSize ? J.videoOutputSize(project) : { width: WIDTH, height: HEIGHT };
      const width = size.width, height = size.height;
      const clips = J.videoClips ? J.videoClips(project, info.duration) : [{ start: 0, end: info.duration }];
      if (J.validateVideoEdits && project.settings && project.settings.videoEdit) J.validateVideoEdits(project.settings.videoEdit, info.duration);
      const duration = clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
      const edited = clips.length !== 1 || clips[0].start !== 0 || clips[0].end !== info.duration;
      const capability = await checkCaptionExportSupport({ ...info, outputWidth: width, outputHeight: height }, this.env); if (!capability.supported) fail('MEDIA_ENCODER_UNSUPPORTED', capability.reason);
      if (!options.writable && (duration > MAX_BLOB_SECONDS || Number(file.size) > MAX_BLOB_SOURCE_BYTES)) fail('MEDIA_FILE_SAVE_REQUIRED', 'This video is too long for an in-memory export. Use a browser that supports choosing a save location.');
      const canvas = options.canvas || (this.env.OffscreenCanvas ? new this.env.OffscreenCanvas(width, height) : this.env.document.createElement('canvas'));
      canvas.width = width; canvas.height = height; const ctx = canvas.getContext('2d'); if (!ctx) fail('MEDIA_EXPORT_CANVAS_UNAVAILABLE', 'A 2D export canvas is unavailable.');
      target = options.writable ? streamTarget(M, options.writable) : (bufferTarget = new M.BufferTarget());
      this.output = new M.Output({ format: new M.Mp4OutputFormat({ fastStart: false }), target });
      const videoSource = new M.CanvasSource(canvas, { codec: 'avc', quality: new M.Quality({ bitrate: capability.config.bitrate || 8_000_000 }),
        fullCodecString: capability.config.codec, keyFrameInterval: 2, hardwareAcceleration: 'no-preference' });
      this.output.addVideoTrack(videoSource, { frameRate: FPS, maximumPacketCount: Math.ceil(duration * FPS) });
      let audioSource = null;
      if (info.hasAudio) { audioSource = edited ? new M.AudioSampleSource({ codec: 'aac', bitrate: 192000 }) : new M.EncodedAudioPacketSource('aac'); this.output.addAudioTrack(audioSource); }
      await this.output.start();
      const times = timestamps(duration, FPS), fit = project.settings && project.settings.sourceFit || 'contain';
      const videoPump = (async () => { let encoded = 0;
        const sourceTimes = times.map(time => J.videoSourceTime ? J.videoSourceTime(clips, time) : time);
        for await (const frame of this.adapter.framesAt(sourceTimes, signal)) { abortCheck(signal);
          if (J.drawVideoEdit) J.drawVideoEdit(ctx, frame.canvas, width, height, project); else J.drawSourceVideo(ctx, frame.canvas, width, height, fit, '#000000');
          J.drawCaptionOverlay(ctx, project, sourceTimes[encoded], { designWidth: width, designHeight: height });
          await videoSource.add(times[encoded], Math.min(1 / FPS, duration - times[encoded]), { keyFrame: encoded % (FPS * 2) === 0 }); encoded++; progress('video', encoded / times.length, `${encoded}/${times.length}`); }
        videoSource.close(); return encoded;
      })();
      const audioPump = audioSource ? edited ? J.pumpEditedAudio(this.adapter, audioSource, clips, { signal }) : J.pumpAacPassthrough(this.adapter, audioSource, info.duration, { signal, onProgress: value => progress('audio', value, 'Preserving original audio') }) : Promise.resolve({ packets: 0, mode: 'none' });
      const [frameCount, audio] = await Promise.all([videoPump, audioPump]); abortCheck(signal); progress('finalizing', 1, 'Finalizing MP4'); await this.output.finalize();
      const blob = bufferTarget ? new Blob([bufferTarget.buffer], { type: 'video/mp4' }) : null;
      const elapsedSeconds = ((typeof performance !== 'undefined' ? performance.now() : Date.now()) - startedAt) / 1000;
      return { blob, frameCount, duration, width, height, fps: FPS, audio, fileBacked: !!options.writable,
        metrics: { elapsedSeconds, realtimeFactor: duration > 0 ? elapsedSeconds / duration : null, framesPerSecond: elapsedSeconds > 0 ? frameCount / elapsedSeconds : null } };
    } catch (error) {
      if (this.output && this.output.state !== 'finalized' && this.output.state !== 'canceled') { try { await this.output.cancel(); } catch (_) {} }
      else if (!this.output && options.writable) { try { if (options.writable.abort) await options.writable.abort(error); else await options.writable.close(); } catch (_) {} }
      if (error && (error.code || error.name === 'CaptionExportError')) throw error;
      throw new CaptionExportError('MEDIA_EXPORT_FAILED', `Video export failed: ${error.message || error}`, { cause: error });
    } finally { if (this.adapter) this.adapter.dispose(); this.adapter = null; this.output = null; this.running = false; }
  }
}

J.CAPTION_EXPORT_DEFAULTS = Object.freeze({ width: WIDTH, height: HEIGHT, fps: FPS, maxBlobSeconds: MAX_BLOB_SECONDS });
J.CaptionExportError = CaptionExportError;
J.checkCaptionExportSupport = checkCaptionExportSupport;
J.CaptionVideoExporter = CaptionVideoExporter;
})();
