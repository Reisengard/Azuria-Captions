/* ============================================================
   JIZURA — centralized browser media capability diagnostics
   ============================================================ */
'use strict';

(() => {
const VERSION = 1;
const DEFAULT_TYPES = Object.freeze({
  mp4H264: 'video/mp4; codecs="avc1.4d4028"',
  mp4H264Aac: 'video/mp4; codecs="avc1.4d4028, mp4a.40.2"',
});

const own = (value, key) => value != null && key in Object(value);
const available = value => ({ available: !!value });
const errorText = error => error && error.message ? String(error.message) : String(error || 'Unknown capability error');

function playbackCapability(env, mimeTypes) {
  const result = { available: false, metadata: false, mimeTypes: {} };
  const document = env.document;
  if (!document || typeof document.createElement !== 'function') return result;
  let video;
  try { video = document.createElement('video'); } catch (error) { result.error = errorText(error); return result; }
  result.available = !!video && typeof video.play === 'function';
  result.metadata = !!video && (own(video, 'videoWidth') || typeof video.addEventListener === 'function');
  for (const key of Object.keys(mimeTypes)) {
    let answer = '';
    try { answer = video && typeof video.canPlayType === 'function' ? video.canPlayType(mimeTypes[key]) : ''; }
    catch (error) { answer = ''; }
    result.mimeTypes[key] = answer === 'probably' ? 'probably' : answer === 'maybe' ? 'maybe' : 'no';
  }
  return result;
}

function apiCapability(env, name) {
  const api = env[name];
  return { available: typeof api === 'function', configurationProbe: !!(api && typeof api.isConfigSupported === 'function') };
}

/** Fast checks that are safe to use while rendering UI. No user-agent inference. */
function inspect(env = globalThis, options = {}) {
  const mimeTypes = Object.assign({}, DEFAULT_TYPES, options.mimeTypes || {});
  const canvasPrototype = env.HTMLCanvasElement && env.HTMLCanvasElement.prototype;
  return {
    version: VERSION,
    playback: playbackCapability(env, mimeTypes),
    frameCallback: available(env.HTMLVideoElement && env.HTMLVideoElement.prototype &&
      typeof env.HTMLVideoElement.prototype.requestVideoFrameCallback === 'function'),
    webCodecs: {
      videoDecoder: apiCapability(env, 'VideoDecoder'), videoEncoder: apiCapability(env, 'VideoEncoder'),
      audioDecoder: apiCapability(env, 'AudioDecoder'), audioEncoder: apiCapability(env, 'AudioEncoder'),
    },
    fileSystemAccess: {
      open: typeof env.showOpenFilePicker === 'function', save: typeof env.showSaveFilePicker === 'function',
      writableStream: typeof env.FileSystemWritableFileStream === 'function',
    },
    execution: {
      worker: typeof env.Worker === 'function', offscreenCanvas: typeof env.OffscreenCanvas === 'function',
      canvasTransfer: !!canvasPrototype && typeof canvasPrototype.transferControlToOffscreen === 'function',
    },
  };
}

async function probeConfiguration(env, name, config) {
  if (!config) return { status: 'not-requested', supported: null };
  const api = env[name];
  if (typeof api !== 'function' || typeof api.isConfigSupported !== 'function') {
    return { status: 'unavailable', supported: false };
  }
  try {
    const result = await api.isConfigSupported(config);
    return { status: result && result.supported ? 'supported' : 'unsupported', supported: !!(result && result.supported),
      config: result && result.config ? result.config : config };
  } catch (error) {
    return { status: 'error', supported: false, error: errorText(error), config };
  }
}

/**
 * Probe the exact codec configurations selected by the media adapter/exporter.
 * `configs` keys are videoDecoder, videoEncoder, audioDecoder, and audioEncoder.
 */
async function detect(options = {}, env = globalThis) {
  const report = inspect(env, options);
  const configs = options.configs || {};
  const names = ['videoDecoder', 'videoEncoder', 'audioDecoder', 'audioEncoder'];
  const apiNames = ['VideoDecoder', 'VideoEncoder', 'AudioDecoder', 'AudioEncoder'];
  const probes = await Promise.all(names.map((name, index) => probeConfiguration(env, apiNames[index], configs[name])));
  report.selectedCodecs = {};
  names.forEach((name, index) => { report.selectedCodecs[name] = probes[index]; });
  report.summary = summarize(report);
  return report;
}

function summarize(report) {
  const selected = report.selectedCodecs || {};
  const required = Object.keys(selected).filter(key => selected[key].status !== 'not-requested');
  const unsupported = required.filter(key => selected[key].supported !== true);
  return {
    preview: !!(report.playback.available && report.playback.metadata),
    preciseFrameCallbacks: !!report.frameCallback.available,
    selectedCodecsSupported: required.length > 0 && unsupported.length === 0,
    unsupportedSelectedCodecs: unsupported,
    fileBackedSave: !!(report.fileSystemAccess.save && report.fileSystemAccess.writableStream),
    workerCanvas: !!(report.execution.worker && report.execution.offscreenCanvas),
  };
}

J.MEDIA_CAPABILITIES_VERSION = VERSION;
J.MEDIA_DEFAULT_MIME_TYPES = DEFAULT_TYPES;
J.inspectMediaCapabilities = inspect;
J.detectMediaCapabilities = detect;
J.summarizeMediaCapabilities = summarize;
})();
