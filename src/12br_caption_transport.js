/* ============================================================
   JIZURA — Video Captions workbench: transport: play / pause, scrub, skipping cut sections
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb;
const { ui, $, status, sourceVideo } = W;

function togglePlay() {
  const video = sourceVideo(); if (!video) return;
  if (!video.paused) { video.pause(); return; }
  const clips = J.videoClips(ui.store.project), time = video.currentTime;
  if (time >= clips[clips.length - 1].end) video.currentTime = clips[0].start;
  else if (!clips.some(clip => time >= clip.start && time < clip.end)) video.currentTime = (clips.find(clip => clip.start > time) || clips[0]).start;
  video.play().catch(error => status(error.message, true));
}

function scrubTo(value) {
  const video = sourceVideo(); if (!video) return;
  video.currentTime = video.duration * Number(value) / 1000; if (ui.preview) ui.preview.renderNow();
}

function attachVideo(video) {
  video.addEventListener('play', () => { $('captionPlay').textContent = '❚❚'; });
  video.addEventListener('pause', () => { $('captionPlay').textContent = '▶'; });
}

/* While playing, jump over the trimmed-away parts of the source video. */
function skipCuts(frame, video) {
  const clips = J.videoClips(ui.store.project);
  if (!video.paused && !video.seeking && !clips.some(clip => frame.mediaTime >= clip.start && frame.mediaTime < clip.end)) {
    const next = clips.find(clip => clip.start > frame.mediaTime);
    if (next) video.currentTime = next.start; else video.pause();
  }
}

function init() {
  $('captionPlay').addEventListener('click', togglePlay);
  $('captionScrub').addEventListener('input', event => scrubTo(event.target.value));
}
Object.assign(W, { attachVideo, scrubTo, skipCuts, togglePlay });
W.inits.push(init);
})();
