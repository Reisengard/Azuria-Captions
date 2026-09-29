/* Dependency-free tests for Gate 4.2 local media import and lifecycle. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
global.window = globalThis;
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', '01_util.js'), 'utf8'));
vm.runInThisContext(fs.readFileSync(path.join(root, 'src', '10c_media_import.js'), 'utf8'));

class FakeFile {
  constructor(name, data, options = {}) { this.name = name; this.data = Buffer.from(data); this.size = this.data.length; this.type = options.type || 'video/mp4'; this.lastModified = options.lastModified || 10; }
  slice(start, end) { const part = this.data.subarray(start, end); return { arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) }; }
}
class FakeVideo {
  constructor(metadata) { this.listeners = {}; this.duration = metadata.duration; this.videoWidth = metadata.width; this.videoHeight = metadata.height; this.paused = 0; this.removed = 0; }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  removeEventListener(name, fn) { if (this.listeners[name] === fn) delete this.listeners[name]; }
  load() { if (this.src) queueMicrotask(() => this.listeners.loadedmetadata && this.listeners.loadedmetadata()); }
  pause() { this.paused++; }
  removeAttribute(name) { if (name === 'src') { this.src = ''; this.removed++; } }
}

(async () => {
  const videos = [], revoked = [];
  const env = {
    document: { createElement: () => { const video = new FakeVideo({ duration: 15, width: 1080, height: 1920 }); videos.push(video); return video; } },
    URL: { createObjectURL: file => `blob:${file.name}:${videos.length}`, revokeObjectURL: url => revoked.push(url) },
  };
  const first = new FakeFile('first.mp4', 'first-video-bytes', { lastModified: 100 });
  const second = new FakeFile('second.mp4', 'second-video-bytes', { lastModified: 200 });
  assert.equal(J.mediaFileFromInput({ target: { files: [first] } }), first);
  assert.equal(J.mediaFileFromInput({ dataTransfer: { files: [second] } }), second);
  assert.notEqual(await J.fingerprintMediaFile(first, env), await J.fingerprintMediaFile(second, env));

  const controller = new J.MediaSourceController({ env });
  const loaded = await controller.load([first]);
  assert.equal(loaded.metadata.duration, 15);
  assert.equal(loaded.metadata.width, 1080);
  assert.equal(loaded.projectMedia.relinkRequired, false);
  assert.equal(Object.hasOwn(loaded.projectMedia, 'file'), false);
  assert.equal(Object.hasOwn(loaded.projectMedia, 'objectUrl'), false);

  await controller.load([second]);
  assert.deepStrictEqual(revoked, [loaded.objectUrl], 'loading a second file did not release the first URL');
  assert.equal(videos[0].removed, 1);
  const secondReference = controller.current.metadata;
  controller.close();
  assert.equal(revoked.length, 2, 'closing did not release the active URL');
  assert.equal(controller.current, null);

  const relinkController = new J.MediaSourceController({ env });
  await relinkController.relink([second], secondReference);
  relinkController.close();
  await assert.rejects(() => relinkController.relink([first], secondReference), error => error.code === 'MEDIA_RELINK_MISMATCH');
  assert.equal(relinkController.current, null);

  assert.throws(() => J.mediaFileFromInput({ files: [] }), error => error.code === 'MEDIA_FILE_REQUIRED');
  await assert.rejects(() => relinkController.load([new FakeFile('notes.txt', 'x', { type: 'text/plain' })]), error => error.code === 'MEDIA_FILE_TYPE_UNSUPPORTED');

  let releaseFingerprint;
  const slowFile = new FakeFile('slow.mp4', 'slow-video');
  slowFile.slice = () => ({ arrayBuffer: () => new Promise(resolve => { releaseFingerprint = () => resolve(new ArrayBuffer(1)); }) });
  const racing = new J.MediaSourceController({ env });
  const slowLoad = racing.load([slowFile]);
  await new Promise(resolve => setImmediate(resolve));
  const fastLoad = racing.load([second]);
  releaseFingerprint();
  await assert.rejects(slowLoad, error => error.code === 'MEDIA_LOAD_CANCELLED');
  await fastLoad;
  assert.equal(racing.current.file, second, 'an older import replaced the latest file');
  racing.close();
  console.log('Gate 4.2 media import tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
