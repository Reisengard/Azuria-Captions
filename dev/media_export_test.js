'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.resolve(__dirname, '..'), context = { console, J: {}, globalThis: null, Blob, WritableStream, AbortController };
context.globalThis = context; vm.createContext(context);
for (const name of ['10d_media_preview.js', '11b_media_demux.js', '11c_caption_compositor.js', '11d_media_audio.js', '11e_media_export.js']) {
  vm.runInContext(fs.readFileSync(path.join(root, 'src', name), 'utf8'), context, { filename: name });
}
const J = context.J;

(async () => {
  const decoderConfig = { codec: 'avc1.42001f', codedWidth: 1920, codedHeight: 1080 };
  const audioConfig = { codec: 'mp4a.40.2', numberOfChannels: 2, sampleRate: 48000, description: new Uint8Array([17, 144]) };
  class Track { constructor(type) { this.type = type; } async getCodec() { return this.type === 'video' ? 'avc' : 'aac'; }
    async getCodedWidth() { return 1920; } async getCodedHeight() { return 1080; } async getDecoderConfig() { return this.type === 'video' ? decoderConfig : audioConfig; }
    async computeFrameRateMetrics() { return { averageFrameRate: 29.97 }; } }
  class Input { async getPrimaryVideoTrack() { return new Track('video'); } async getPrimaryAudioTrack() { return new Track('audio'); }
    async computeDuration() { return 2; } dispose() { this.disposed = true; } }
  class CanvasSink { async *canvasesAtTimestamps(times) { for (const timestamp of times) yield { canvas: { timestamp }, timestamp, duration: 1 / 30 }; } }
  class PacketSink { async *packets() {} }
  const lib = { Input, BlobSource: class {}, EncodedPacketSink: PacketSink, CanvasSink, ALL_FORMATS: [] };
  const adapter = new J.MediaDemuxAdapter(new Blob(['mp4']), { library: lib }), info = await adapter.open();
  assert.equal(info.videoCodec, 'avc'); assert.equal(info.audioCodec, 'aac'); assert.equal(info.duration, 2);
  const frames = []; for await (const frame of adapter.framesAt([0, 1 / 30])) frames.push(frame);
  assert.deepStrictEqual(frames.map(frame => frame.outputTimestamp), [0, 1 / 30]); adapter.dispose();

  class UnsupportedInput extends Input { async getPrimaryAudioTrack() { const track = new Track('audio'); track.getCodec = async () => 'opus'; return track; } }
  await assert.rejects(() => new J.MediaDemuxAdapter(new Blob(['mp4']), { library: Object.assign({}, lib, { Input: UnsupportedInput }) }).open(),
    error => error.code === 'MEDIA_AUDIO_CODEC_UNSUPPORTED');

  const packets = [0, .5, 1, 1.5].map(timestamp => ({ timestamp, duration: .5, clone(changes) { return Object.assign({}, this, changes); } }));
  const audioAdapter = { info: { hasAudio: true, audioCodec: 'aac', audioConfig }, async *audioPackets() { yield* packets; } };
  const added = [], source = { async add(packet, meta) { added.push({ packet, meta }); }, close() { this.closed = true; } };
  const audio = await J.pumpAacPassthrough(audioAdapter, source, 2); assert.equal(audio.packets, 4); assert.equal(audio.duration, 2);
  assert.equal(added[0].packet.timestamp, 0); assert.deepStrictEqual(added[0].meta.decoderConfig, audioConfig); assert(source.closed);
  const aborted = new AbortController(); aborted.abort();
  await assert.rejects(() => J.pumpAacPassthrough(audioAdapter, source, 2, { signal: aborted.signal }), error => error.code === 'MEDIA_EXPORT_CANCELLED');

  const supported = await J.checkCaptionExportSupport({}, { VideoEncoder: { async isConfigSupported(config) { return { supported: true, config }; } } });
  assert.equal(supported.supported, true); assert.equal(supported.config.width, 1080); assert.equal(supported.config.height, 1920); assert.equal(supported.config.framerate, 30);
  assert.equal((await J.checkCaptionExportSupport({}, {})).supported, false);
  assert.deepStrictEqual(Array.from([J.CAPTION_EXPORT_DEFAULTS.width, J.CAPTION_EXPORT_DEFAULTS.height, J.CAPTION_EXPORT_DEFAULTS.fps]), [1080, 1920, 30]);
  console.log('media export tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
