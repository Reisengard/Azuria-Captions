/* ============================================================
   JIZURA — actionable Video Captions failure recovery (Gate 7.3)
   ============================================================ */
'use strict';

(() => {
const RECOVERY = Object.freeze({
  MEDIA_FILE_REQUIRED: 'Choose a local video and try again.',
  MEDIA_FILE_TYPE_UNSUPPORTED: 'Choose an H.264/AAC MP4 file.',
  MEDIA_VIDEO_CODEC_UNSUPPORTED: 'Convert the source video to H.264 MP4, then relink it.',
  MEDIA_AUDIO_CODEC_UNSUPPORTED: 'Convert the soundtrack to AAC in an MP4 file. JIZURA will not silently remove audio.',
  MEDIA_CONTAINER_MALFORMED: 'Re-export the source as a standard H.264/AAC MP4 and try again.',
  MEDIA_DEMUX_FAILED: 'Check that the file is a complete, readable MP4. Re-export it if necessary.',
  MEDIA_ENCODER_UNSUPPORTED: 'Use the latest desktop Chrome or Edge, update graphics drivers, or export a shorter PNG sequence from Lyric Motion.',
  MEDIA_FILE_SAVE_REQUIRED: 'Open JIZURA in Chrome or Edge so you can choose a file-backed save location.',
  MEDIA_AUDIO_PASSTHROUGH_UNAVAILABLE: 'Use AAC audio in the source MP4; audio is never omitted without warning.',
  MEDIA_AUDIO_START_UNSUPPORTED: 'Re-export the source with video and audio starting at 00:00.',
  MEDIA_AUDIO_DURATION_MISMATCH: 'Re-export the source with matching audio and video durations.',
  MEDIA_EXPORT_CANCELLED: 'Nothing else is required. Start Export again when ready.',
  MEDIA_EXPORT_FAILED: 'Close memory-heavy tabs, choose a file-backed save location, and retry in Chrome or Edge.',
  MEDIA_RELINK_MISMATCH: 'Choose the exact source video used when this project was saved.',
  UNSUPPORTED_SCHEMA_VERSION: 'Update JIZURA to a build that supports this project version. The file was not changed.',
  PROJECT_JSON_INVALID: 'Choose an unmodified JIZURA project JSON file.',
  TRANSCRIPT_JSON_INVALID: 'Fix the transcript JSON syntax or export it again, then re-import it.',
  UNSUPPORTED_TRANSCRIPT_SCHEMA_VERSION: 'Export the transcript in the current JIZURA timed-text format.',
  TOKEN_TIMING_OVERLAP: 'Correct the overlapping word times shown in the transcript and import it again.',
  TOKEN_START_NEGATIVE: 'Change negative word start times to zero or later.',
  TOKEN_END_BEFORE_START: 'Make every word end after it starts.',
  TOKEN_END_AFTER_DURATION: 'Keep word timings within the source-video duration.',
  SUBTITLE_CUE_TIMING_INVALID: 'Correct invalid or overlapping SRT/VTT cue times and import it again.',
  ESTIMATED_TIMING_REQUIRED: 'Mark SRT/VTT-derived tokens as estimated, or import word-timestamp JSON.',
  TRANSCRIPT_TIMING_INVALID: 'Correct overlapping or negative transcript timings, then import the file again.',
  TIMED_TEXT_WORD_TIMING_REQUIRED: 'Import word-timestamp JSON for precise active-word captions. SRT/VTT timing remains estimated.',
  FONT_LOAD_FAILED: 'Check the network connection or choose another font; JIZURA will use a system fallback.',
  CAPTION_STATIC_FALLBACK: 'Shorten the caption or reduce motion/intensity if you want an animated alternative.',
});

J.MEDIA_RECOVERY_MESSAGES = RECOVERY;
J.recoveryForError = error => {
  let code = error && error.code || 'UNKNOWN';
  if (code === 'UNKNOWN' && error && (error.name === 'QuotaExceededError' || /memory|quota|write|disk/i.test(error.message || ''))) code = 'MEDIA_EXPORT_FAILED';
  const action = RECOVERY[code] || 'Check the source and project settings, then try again.';
  const message = error && error.message ? String(error.message) : 'The operation could not be completed.';
  return { code, message, action, display: `${message} ${action}` };
};
})();
