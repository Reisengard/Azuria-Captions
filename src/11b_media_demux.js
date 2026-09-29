/* ============================================================
   JIZURA — Mediabunny demux adapter (Gate 6.1)
   ============================================================ */
'use strict';

(() => {
const VERSION = 1;
const SUPPORTED_VIDEO = new Set(['avc']);
const SUPPORTED_AUDIO = new Set(['aac']);

class MediaDemuxError extends Error {
  constructor(code, message, details) { super(message); this.name = 'MediaDemuxError'; this.code = code; Object.assign(this, details || {}); }
}
const fail = (code, message, details) => { throw new MediaDemuxError(code, message, details); };
const cancelled = signal => { if (signal && signal.aborted) fail('MEDIA_EXPORT_CANCELLED', 'Video export was cancelled.'); };

class MediaDemuxAdapter {
  constructor(file, options = {}) {
    this.file = file; this.lib = options.library || globalThis.Mediabunny; this.input = null; this.info = null;
  }

  async open(signal) {
    cancelled(signal);
    const M = this.lib;
    if (!M || !M.Input || !M.BlobSource || !M.EncodedPacketSink || !M.CanvasSink) {
      fail('MEDIA_DEMUX_UNAVAILABLE', 'The bundled media reader could not be loaded. Reload JIZURA and try again.');
    }
    if (!this.file || typeof this.file.arrayBuffer !== 'function') fail('MEDIA_FILE_INVALID', 'The source video is no longer available. Relink it and try again.');
    try {
      this.input = new M.Input({ formats: M.ALL_FORMATS, source: new M.BlobSource(this.file) });
      const video = await this.input.getPrimaryVideoTrack(), audio = await this.input.getPrimaryAudioTrack();
      if (!video) fail('MEDIA_VIDEO_TRACK_MISSING', 'The selected file has no video track.');
      const videoCodec = await video.getCodec();
      if (!SUPPORTED_VIDEO.has(videoCodec)) fail('MEDIA_VIDEO_CODEC_UNSUPPORTED', `Video codec “${videoCodec || 'unknown'}” is unsupported. Use an H.264 MP4 source.`, { codec: videoCodec });
      const audioCodec = audio && await audio.getCodec();
      if (audio && !SUPPORTED_AUDIO.has(audioCodec)) fail('MEDIA_AUDIO_CODEC_UNSUPPORTED', `Audio codec “${audioCodec || 'unknown'}” cannot be preserved. Use AAC audio in an MP4 source.`, { codec: audioCodec });
      const [width, height, duration, videoConfig, audioConfig, frameRate] = await Promise.all([
        video.getCodedWidth(), video.getCodedHeight(), this.input.computeDuration(audio ? [video, audio] : [video]),
        video.getDecoderConfig(), audio ? audio.getDecoderConfig() : null,
        video.computeFrameRateMetrics ? video.computeFrameRateMetrics().catch(() => null) : null,
      ]);
      if (!(width > 0 && height > 0 && duration > 0) || !videoConfig) fail('MEDIA_CONTAINER_MALFORMED', 'The MP4 has invalid track metadata or duration.');
      this.info = Object.freeze({ duration, width, height, videoCodec, audioCodec: audioCodec || null, hasAudio: !!audio,
        videoConfig, audioConfig, sourceFrameRate: frameRate && (frameRate.averageFrameRate || frameRate.average) || null, videoTrack: video, audioTrack: audio });
      cancelled(signal); return this.info;
    } catch (error) {
      this.dispose();
      if (error instanceof MediaDemuxError) throw error;
      fail('MEDIA_DEMUX_FAILED', `The source MP4 could not be read: ${error.message || error}`, { cause: error });
    }
  }

  async *framesAt(timestamps, signal) {
    if (!this.info) fail('MEDIA_DEMUX_NOT_OPEN', 'Open the media adapter before reading frames.');
    const sink = new this.lib.CanvasSink(this.info.videoTrack);
    let index = 0;
    for await (const frame of sink.canvasesAtTimestamps(timestamps)) {
      cancelled(signal);
      if (!frame || !frame.canvas) fail('MEDIA_FRAME_MISSING', `No source frame is available for output frame ${index}.`, { frameIndex: index });
      yield { canvas: frame.canvas, sourceTimestamp: frame.timestamp, sourceDuration: frame.duration, outputTimestamp: timestamps[index], index };
      index++;
    }
  }

  async *audioPackets(signal) {
    if (!this.info || !this.info.audioTrack) return;
    const sink = new this.lib.EncodedPacketSink(this.info.audioTrack);
    for await (const packet of sink.packets()) { cancelled(signal); yield packet; }
  }

  dispose() { if (this.input) { try { this.input.dispose(); } catch (_) {} this.input = null; } this.info = null; }
}

J.MEDIA_DEMUX_VERSION = VERSION;
J.MediaDemuxError = MediaDemuxError;
J.MediaDemuxAdapter = MediaDemuxAdapter;
})();
