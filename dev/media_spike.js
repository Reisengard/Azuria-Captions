/* Gate 0.3 disposable feasibility spike. This is intentionally not product media code. */
(() => {
'use strict';

const $ = id => document.getElementById(id);
const status = $('status');
const sourceUrl = 'fixtures/media/generated/portrait-15s-30fps-av.mp4';
const fps = 30;
const width = 1080;
const height = 1920;
const frameDurationUs = Math.round(1e6 / fps);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const show = value => { status.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2); };

async function supportedVideoConfig() {
  const candidates = [
    { codec: 'avc1.640028', avc: { format: 'avc' } },
    { codec: 'avc1.4d4028', avc: { format: 'avc' } },
    { codec: 'avc1.420028', avc: { format: 'avc' } },
  ];
  for (const candidate of candidates) {
    const config = Object.assign({ width, height, framerate: fps, bitrate: 8_000_000, latencyMode: 'quality', hardwareAcceleration: 'no-preference' }, candidate);
    const result = await VideoEncoder.isConfigSupported(config);
    if (result.supported) return result.config;
  }
  throw new Error('No supported H.264 VideoEncoder configuration for 1080x1920/30 fps.');
}

async function supportedAudioConfig(channels) {
  const config = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: channels, bitrate: 192000 };
  const result = await AudioEncoder.isConfigSupported(config);
  if (!result.supported) throw new Error('AAC AudioEncoder is unavailable.');
  return result.config;
}

async function seek(video, time) {
  const target = Math.min(Math.max(0, time), Math.max(0, video.duration - 0.001));
  if (Math.abs(video.currentTime - target) < 0.0005 && video.readyState >= 2) return;
  await new Promise((resolve, reject) => {
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(video.error || new Error(`Seek failed at ${target}`)); };
    const cleanup = () => { video.removeEventListener('seeked', done); video.removeEventListener('error', fail); };
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', fail, { once: true });
    video.currentTime = target;
  });
}

function drawFrame(ctx, video, index) {
  ctx.drawImage(video, 0, 0, width, height);
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(70, height - 360, width - 140, 220);
  ctx.fillStyle = '#8ee6c4';
  ctx.font = '700 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('JIZURA CAPTION SPIKE', width / 2, height - 260);
  ctx.fillStyle = '#fff';
  ctx.font = '42px ui-monospace, monospace';
  ctx.fillText(`frame ${String(index).padStart(3, '0')}  ${(index / fps).toFixed(3)}s`, width / 2, height - 190);
}

async function encodeAudio(muxer, sourceBuffer, duration) {
  const context = new AudioContext({ sampleRate: 48000 });
  let decoded;
  try { decoded = await context.decodeAudioData(sourceBuffer.slice(0)); }
  finally { await context.close(); }
  const channels = Math.min(2, decoded.numberOfChannels);
  const config = await supportedAudioConfig(channels);
  let error = null;
  let chunks = 0;
  let endUs = 0;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => { chunks++; endUs = Math.max(endUs, chunk.timestamp + (chunk.duration || 0)); muxer.addAudioChunk(chunk, meta); },
    error: value => { error = value; },
  });
  encoder.configure(config);
  const block = 4800;
  const sourceFrames = Math.min(decoded.length, Math.round(duration * decoded.sampleRate));
  for (let offset = 0; offset < sourceFrames; offset += block) {
    if (error) throw error;
    const frames = Math.min(block, sourceFrames - offset);
    const data = new Float32Array(frames * channels);
    for (let channel = 0; channel < channels; channel++) data.set(decoded.getChannelData(channel).subarray(offset, offset + frames), channel * frames);
    const audio = new AudioData({ format: 'f32-planar', sampleRate: decoded.sampleRate, numberOfFrames: frames, numberOfChannels: channels, timestamp: Math.round(offset * 1e6 / decoded.sampleRate), data });
    encoder.encode(audio);
    audio.close();
    while (encoder.encodeQueueSize > 16) await sleep(1);
  }
  await encoder.flush();
  encoder.close();
  if (error) throw error;
  return { codec: config.codec, channels, sampleRate: config.sampleRate, chunks, endUs };
}

async function run() {
  if (!globalThis.VideoEncoder || !globalThis.AudioEncoder || !globalThis.VideoFrame) throw new Error('WebCodecs encoders are unavailable.');
  $('run').disabled = true;
  show('Loading synthetic source fixture…');
  const started = performance.now();
  const response = await fetch(sourceUrl);
  if (!response.ok) throw new Error(`Fixture fetch failed: HTTP ${response.status}`);
  const sourceBuffer = await response.arrayBuffer();
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  const objectUrl = URL.createObjectURL(new Blob([sourceBuffer], { type: 'video/mp4' }));
  video.src = objectUrl;
  await new Promise((resolve, reject) => {
    video.addEventListener('loadedmetadata', resolve, { once: true });
    video.addEventListener('error', () => reject(video.error || new Error('Source video failed to load.')), { once: true });
  });

  const videoConfig = await supportedVideoConfig();
  const target = new Mp4Muxer.ArrayBufferTarget();
  const muxer = new Mp4Muxer.Muxer({
    target,
    video: { codec: 'avc', width, height, frameRate: fps },
    audio: { codec: 'aac', numberOfChannels: 1, sampleRate: 48000 },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let videoError = null;
  let encodedFrames = 0;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => { encodedFrames++; muxer.addVideoChunk(chunk, meta); },
    error: value => { videoError = value; },
  });
  encoder.configure(videoConfig);
  const canvas = $('canvas');
  const ctx = canvas.getContext('2d', { alpha: false });
  const requestedSeconds = Number(new URLSearchParams(location.search).get('seconds')) || video.duration;
  const exportDuration = Math.min(video.duration, Math.max(1 / fps, requestedSeconds));
  const totalFrames = Math.round(exportDuration * fps);
  try {
    for (let index = 0; index < totalFrames; index++) {
      if (videoError) throw videoError;
      await seek(video, index / fps);
      drawFrame(ctx, video, index);
      const frame = new VideoFrame(canvas, { timestamp: index * frameDurationUs, duration: frameDurationUs });
      encoder.encode(frame, { keyFrame: index % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4) await sleep(2);
      if (index % 15 === 0) show(`Encoding source frame ${index + 1}/${totalFrames}…`);
    }
    await encoder.flush();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
    URL.revokeObjectURL(objectUrl);
  }
  if (videoError) throw videoError;
  const audio = await encodeAudio(muxer, sourceBuffer, exportDuration);
  muxer.finalize();
  const blob = new Blob([target.buffer], { type: 'video/mp4' });
  const elapsedSeconds = (performance.now() - started) / 1000;
  const result = {
    ok: true,
    source: { duration: video.duration, width: video.videoWidth, height: video.videoHeight, bytes: sourceBuffer.byteLength },
    output: { duration: totalFrames / fps, width, height, fps, frames: encodedFrames, bytes: blob.size, videoCodec: videoConfig.codec, audio },
    elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
    realtimeFactor: Number((elapsedSeconds / exportDuration).toFixed(3)),
    approach: 'seek-based HTMLVideoElement prototype; AAC decoded and re-encoded',
  };
  globalThis.__mediaSpikeResult = result;
  const link = $('download');
  link.href = URL.createObjectURL(blob);
  link.download = 'media-spike-output.mp4';
  link.hidden = false;
  show(result);
  if (new URLSearchParams(location.search).has('report')) {
    await fetch('/__media_spike_output', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: blob });
    await fetch('/__media_spike_result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  }
  return result;
}

$('run').addEventListener('click', () => run().catch(async error => {
  const result = { ok: false, error: error && error.stack ? error.stack : String(error) };
  globalThis.__mediaSpikeResult = result;
  show(result);
  if (new URLSearchParams(location.search).has('report')) {
    await fetch('/__media_spike_result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  }
}));
if (new URLSearchParams(location.search).has('autorun')) $('run').click();
})();
