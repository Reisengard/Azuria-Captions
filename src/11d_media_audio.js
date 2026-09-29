/* ============================================================
   JIZURA — compatible AAC passthrough (Gate 6.3)
   ============================================================ */
'use strict';

(() => {
class MediaAudioError extends Error { constructor(code, message, details) { super(message); this.name = 'MediaAudioError'; this.code = code; Object.assign(this, details || {}); } }
const fail = (code, message, details) => { throw new MediaAudioError(code, message, details); };

async function pumpAacPassthrough(adapter, source, duration, options = {}) {
  if (options.signal && options.signal.aborted) fail('MEDIA_EXPORT_CANCELLED', 'Video export was cancelled.');
  if (!adapter.info.hasAudio) return { packets: 0, duration: 0, mode: 'none' };
  if (adapter.info.audioCodec !== 'aac' || !adapter.info.audioConfig) fail('MEDIA_AUDIO_PASSTHROUGH_UNAVAILABLE', 'Original audio cannot be preserved. Use an H.264/AAC MP4 source.');
  let count = 0, first = null, end = 0, lastTimestamp = -Infinity;
  for await (const packet of adapter.audioPackets(options.signal)) {
    if (options.signal && options.signal.aborted) fail('MEDIA_EXPORT_CANCELLED', 'Video export was cancelled.');
    if (first == null) { first = packet.timestamp; if (Math.abs(first) > .1) fail('MEDIA_AUDIO_START_UNSUPPORTED', 'The audio track does not begin near zero and cannot be preserved reliably.'); }
    const timestamp = packet.timestamp - first;
    if (timestamp + 1e-6 < lastTimestamp) fail('MEDIA_AUDIO_TIMESTAMPS_INVALID', 'The audio packets are not in presentation order.');
    if (timestamp >= duration + .05) break;
    const shifted = typeof packet.clone === 'function' ? packet.clone({ timestamp }) : packet;
    await source.add(shifted, count === 0 ? { decoderConfig: adapter.info.audioConfig } : undefined);
    lastTimestamp = timestamp; end = Math.max(end, timestamp + Number(packet.duration || 0)); count++;
    if (options.onProgress) options.onProgress(Math.min(1, end / duration));
  }
  source.close();
  if (!count) fail('MEDIA_AUDIO_PACKETS_MISSING', 'The audio track contains no usable AAC packets.');
  if (Math.abs(end - duration) > .12) fail('MEDIA_AUDIO_DURATION_MISMATCH', 'Original audio duration does not match the video timeline.', { audioDuration: end, videoDuration: duration });
  return { packets: count, duration: end, mode: 'aac-passthrough' };
}

J.MediaAudioError = MediaAudioError;
J.pumpAacPassthrough = pumpAacPassthrough;
// Decode only retained ranges so audio cuts are sample-accurate, even inside AAC packets.
J.pumpEditedAudio = async (adapter, source, clips, options = {}) => {
  const sink = new adapter.lib.AudioSampleSink(adapter.info.audioTrack);
  let offset = 0, count = 0;
  for (const clip of clips) {
    for await (const sample of sink.samples(clip.start, clip.end)) {
      let trimmed;
      try {
        if (options.signal && options.signal.aborted) fail('MEDIA_EXPORT_CANCELLED', 'Video export was cancelled.');
        const first = Math.max(0, Math.round((clip.start - sample.timestamp) * sample.sampleRate));
        const last = Math.min(sample.numberOfFrames, Math.round((clip.end - sample.timestamp) * sample.sampleRate));
        if (last <= first) continue;
        trimmed = sample.trim(first, last);
        trimmed.setTimestamp(Math.max(offset, offset + sample.timestamp + first / sample.sampleRate - clip.start));
        await source.add(trimmed); count++;
      } finally { if (trimmed) trimmed.close(); sample.close(); }
    }
    offset += clip.end - clip.start;
  }
  source.close();
  if (!count) fail('MEDIA_AUDIO_PACKETS_MISSING', 'The retained sections contain no usable audio samples.');
  return { packets: count, duration: offset, mode: 'aac-edited' };
};
})();
