/* ============================================================
   JIZURA — local video import, relinking, and object URL lifecycle
   ============================================================ */
'use strict';

(() => {
const SAMPLE_BYTES = 65536;
const MEDIA_FIELDS = Object.freeze(['name', 'size', 'lastModified', 'fingerprint', 'type', 'duration', 'width', 'height',
  'sourceFrameRate', 'hasAudio', 'videoCodec', 'audioCodec', 'relinkRequired']);

class MediaImportError extends Error {
  constructor(code, message, details) { super(message); this.name = 'MediaImportError'; this.code = code; Object.assign(this, details || {}); }
}
const fail = (code, message, details) => { throw new MediaImportError(code, message, details); };
const finite = value => Number.isFinite(value) ? value : null;

function mediaFileFromInput(input) {
  const files = input && input.dataTransfer ? input.dataTransfer.files : input && input.target ? input.target.files : input && input.files ? input.files : input;
  const file = files && typeof files.length === 'number' ? files[0] : null;
  if (!file) fail('MEDIA_FILE_REQUIRED', 'Choose or drop a local video file.');
  return file;
}

function validateFile(file) {
  if (!file || typeof file !== 'object' || typeof file.name !== 'string' || typeof file.slice !== 'function') {
    fail('MEDIA_FILE_INVALID', 'The selected item is not a readable local file.');
  }
  if (file.type && !String(file.type).toLowerCase().startsWith('video/')) {
    fail('MEDIA_FILE_TYPE_UNSUPPORTED', `“${file.name}” is not identified as a video file.`, { name: file.name, type: file.type });
  }
  return file;
}

const bytes = async blob => new Uint8Array(await blob.arrayBuffer());
function headerBytes(file) {
  const text = `${Number(file.size) || 0}:${Number(file.lastModified) || 0}:`;
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 255;
  return out;
}
function join(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0), result = new Uint8Array(length);
  let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result;
}
function fallbackHash(data) {
  let a = 2166136261 >>> 0, b = 2246822519 >>> 0;
  for (let i = 0; i < data.length; i++) { a = Math.imul(a ^ data[i], 16777619); b = Math.imul(b ^ data[i], 3266489917); }
  return `fnv-${(a >>> 0).toString(16).padStart(8, '0')}${(b >>> 0).toString(16).padStart(8, '0')}`;
}

async function fingerprintMediaFile(file, env = globalThis) {
  validateFile(file);
  const size = Number(file.size) || 0;
  const parts = [headerBytes(file), await bytes(file.slice(0, Math.min(size, SAMPLE_BYTES)))];
  if (size > SAMPLE_BYTES) parts.push(await bytes(file.slice(Math.max(SAMPLE_BYTES, size - SAMPLE_BYTES), size)));
  const data = join(parts), subtle = env.crypto && env.crypto.subtle;
  if (!subtle || typeof subtle.digest !== 'function') return fallbackHash(data);
  const digest = new Uint8Array(await subtle.digest('SHA-256', data));
  return `sha256-${Array.from(digest, value => value.toString(16).padStart(2, '0')).join('')}`;
}

function mediaProjectReference(media, relinkRequired) {
  const result = {};
  for (const field of MEDIA_FIELDS) if (media && media[field] !== undefined) result[field] = media[field];
  if (relinkRequired !== undefined) result.relinkRequired = !!relinkRequired;
  return result;
}

function mediaReferencesMatch(expected, actual) {
  if (!expected || !actual) return false;
  if (expected.fingerprint && actual.fingerprint) return expected.fingerprint === actual.fingerprint;
  return expected.name === actual.name && Number(expected.size) === Number(actual.size) &&
    Number(expected.lastModified || 0) === Number(actual.lastModified || 0);
}

class MediaSourceController {
  constructor(options = {}) {
    this.env = options.env || globalThis;
    this.document = options.document || this.env.document;
    this.urlApi = options.urlApi || this.env.URL;
    this.current = null;
    this._pending = null;
    this._candidate = null;
    this._generation = 0;
    this._activeUrls = new Set();
  }

  async load(input, options = {}) {
    const file = validateFile(mediaFileFromInput(input));
    this.close();
    const generation = this._generation;
    if (!this.document || typeof this.document.createElement !== 'function') fail('MEDIA_ELEMENT_UNAVAILABLE', 'Video metadata cannot be read in this environment.');
    if (!this.urlApi || typeof this.urlApi.createObjectURL !== 'function' || typeof this.urlApi.revokeObjectURL !== 'function') {
      fail('MEDIA_OBJECT_URL_UNAVAILABLE', 'Local video URLs are unavailable in this environment.');
    }
    const video = this.document.createElement('video');
    if (!video || typeof video.addEventListener !== 'function') fail('MEDIA_ELEMENT_UNAVAILABLE', 'A video element could not be created.');
    const objectUrl = this.urlApi.createObjectURL(file);
    this._activeUrls.add(objectUrl);
    this._candidate = { video, objectUrl };
    try {
      const fingerprint = await fingerprintMediaFile(file, this.env);
      if (generation !== this._generation) fail('MEDIA_LOAD_CANCELLED', 'Media loading was replaced or closed.');
      const metadataPromise = new Promise((resolve, reject) => {
        const cleanup = () => { video.removeEventListener('loadedmetadata', loaded); video.removeEventListener('error', failed); this._pending = null; };
        const loaded = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new MediaImportError('MEDIA_METADATA_FAILED', `Could not read video metadata for “${file.name}”.`, { name: file.name, mediaError: video.error || null })); };
        this._pending = { cancel: () => { cleanup(); reject(new MediaImportError('MEDIA_LOAD_CANCELLED', 'Media loading was replaced or closed.')); } };
        video.addEventListener('loadedmetadata', loaded, { once: true }); video.addEventListener('error', failed, { once: true });
      });
      video.preload = 'auto'; video.playsInline = true; video.src = objectUrl;
      if (typeof video.load === 'function') video.load();
      await metadataPromise;
      const metadata = {
        name: file.name, size: Number(file.size) || 0, lastModified: Number(file.lastModified) || 0,
        fingerprint, type: file.type || '', duration: finite(video.duration), width: finite(video.videoWidth), height: finite(video.videoHeight),
        sourceFrameRate: null, hasAudio: null, videoCodec: null, audioCodec: null, relinkRequired: false,
      };
      if (!(metadata.duration >= 0) || !(metadata.width > 0) || !(metadata.height > 0)) {
        fail('MEDIA_METADATA_INVALID', `“${file.name}” did not provide valid video metadata.`, { metadata });
      }
      if (options.expectedMedia && options.requireMatch !== false && !mediaReferencesMatch(options.expectedMedia, metadata)) {
        fail('MEDIA_RELINK_MISMATCH', `“${file.name}” does not match the saved source video.`, { expected: mediaProjectReference(options.expectedMedia), actual: mediaProjectReference(metadata) });
      }
      this.current = { file, video, objectUrl, metadata };
      this._candidate = null;
      return { video, objectUrl, metadata: mediaProjectReference(metadata), projectMedia: mediaProjectReference(metadata) };
    } catch (error) {
      this._release(video, objectUrl);
      if (error instanceof MediaImportError) throw error;
      throw new MediaImportError('MEDIA_IMPORT_FAILED', `Could not import “${file.name}”: ${error.message || error}`, { cause: error });
    }
  }

  relink(input, expectedMedia) { return this.load(input, { expectedMedia, requireMatch: true }); }

  close() {
    this._generation++;
    if (this._pending) { const pending = this._pending; this._pending = null; pending.cancel(); }
    if (this._candidate) { this._release(this._candidate.video, this._candidate.objectUrl); this._candidate = null; }
    if (this.current) { this._release(this.current.video, this.current.objectUrl); this.current = null; }
  }

  _release(video, objectUrl) {
    try { if (video) { if (typeof video.pause === 'function') video.pause(); video.removeAttribute && video.removeAttribute('src'); video.load && video.load(); } } catch (error) {}
    try { if (objectUrl && this._activeUrls.has(objectUrl)) { this._activeUrls.delete(objectUrl); this.urlApi.revokeObjectURL(objectUrl); } } catch (error) {}
  }
}

J.MEDIA_REFERENCE_FIELDS = MEDIA_FIELDS;
J.MediaImportError = MediaImportError;
J.mediaFileFromInput = mediaFileFromInput;
J.fingerprintMediaFile = fingerprintMediaFile;
J.mediaProjectReference = mediaProjectReference;
J.mediaReferencesMatch = mediaReferencesMatch;
J.MediaSourceController = MediaSourceController;
})();
