/* Dependency-free tests for Gate 4.1 media capability diagnostics. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', '01_util.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', '10b_media_capabilities.js'), 'utf8'));

function codec(supported, normalized) {
  return class { static async isConfigSupported(config) { return { supported, config: normalized || config }; } };
}
function Video() {}
Video.prototype.requestVideoFrameCallback = function () {};
function Canvas() {}
Canvas.prototype.transferControlToOffscreen = function () {};
const env = {
  document: { createElement: tag => {
    assert.equal(tag, 'video');
    return { play() {}, videoWidth: 0, canPlayType: type => type.includes('avc1') ? 'probably' : '' };
  } },
  HTMLVideoElement: Video, HTMLCanvasElement: Canvas,
  VideoDecoder: codec(true), VideoEncoder: codec(true, { codec: 'avc1.normalized', width: 1080, height: 1920 }),
  AudioDecoder: codec(false), AudioEncoder: codec(true),
  showOpenFilePicker() {}, showSaveFilePicker() {}, FileSystemWritableFileStream: function () {},
  Worker: function () {}, OffscreenCanvas: function () {},
};

(async () => {
  const fast = J.inspectMediaCapabilities(env);
  assert.equal(fast.playback.available, true);
  assert.equal(fast.playback.metadata, true);
  assert.equal(fast.playback.mimeTypes.mp4H264Aac, 'probably');
  assert.equal(fast.frameCallback.available, true);
  assert.equal(fast.fileSystemAccess.save, true);
  assert.equal(fast.execution.canvasTransfer, true);

  const report = await J.detectMediaCapabilities({ configs: {
    videoDecoder: { codec: 'avc1.4d4028', codedWidth: 1080, codedHeight: 1920 },
    videoEncoder: { codec: 'avc1.4d4028', width: 1080, height: 1920 },
    audioDecoder: { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 },
  } }, env);
  assert.equal(report.selectedCodecs.videoDecoder.status, 'supported');
  assert.equal(report.selectedCodecs.videoEncoder.config.codec, 'avc1.normalized');
  assert.equal(report.selectedCodecs.audioDecoder.status, 'unsupported');
  assert.equal(report.selectedCodecs.audioEncoder.status, 'not-requested');
  assert.deepStrictEqual(report.summary.unsupportedSelectedCodecs, ['audioDecoder']);
  assert.equal(report.summary.preview, true);
  assert.equal(report.summary.fileBackedSave, true);
  assert.equal(report.summary.workerCanvas, true);

  const absent = await J.detectMediaCapabilities({ configs: { videoEncoder: { codec: 'avc1' } } }, {});
  assert.equal(absent.playback.available, false);
  assert.equal(absent.selectedCodecs.videoEncoder.status, 'unavailable');
  assert.equal(absent.summary.preview, false);

  const broken = Object.assign({}, env, { VideoEncoder: class { static async isConfigSupported() { throw new Error('probe failed'); } } });
  const failed = await J.detectMediaCapabilities({ configs: { videoEncoder: { codec: 'avc1' } } }, broken);
  assert.equal(failed.selectedCodecs.videoEncoder.status, 'error');
  assert.equal(failed.selectedCodecs.videoEncoder.error, 'probe failed');
  console.log('Gate 4.1 media capability tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
