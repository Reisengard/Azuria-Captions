/* ============================================================
   JIZURA — Video Captions workbench: transport: play / pause, scrub, speed, loop, frame step, keyboard, skipping cut sections
   (T2: loop and speed are view state, not saved in the project)
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb, TL = J.captionTimeline;
const { ui, $, status, sourceVideo, fmt } = W;
const tr = ui.transport;

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

const duration = () => Number(ui.store.project.media.duration) || 0;
function seekBy(direction, seconds) {
  const video = sourceVideo(); if (!video) return;
  video.pause(); W.seekTimeline(TL.stepTime(video.currentTime, direction, { seconds }, duration()));
}
function seekEdge(end) {
  const clips = J.videoClips(ui.store.project); if (!sourceVideo() || !clips.length) return;
  W.seekTimeline(end ? clips[clips.length - 1].end : clips[0].start);
}
function gotoCaption(direction) {
  const video = sourceVideo(), segment = video && TL.adjacentSegment(ui.store.project.segments, video.currentTime, direction); if (!segment) return;
  W.selectSegment(segment.id, true); W.revealTime(segment.start);
}

/* ---- speed ---- */
function setSpeed(speed) {
  tr.speed = speed; const video = sourceVideo(); if (video) video.playbackRate = speed;
  $('captionSpeed').textContent = `${speed}×`;
}

/* ---- loop: `L` loops the marked region, else the selected caption (± a short lead) ---- */
function renderLoop() {
  $('captionLoop').setAttribute('aria-pressed', String(tr.loopOn));
  W.placeLoop && W.placeLoop();
}
function setLoop(on) {
  const video = sourceVideo(); if (!video) return;
  if (!on) { tr.loopOn = false; tr.region = null; renderLoop(); return; }
  const region = TL.loopRegion(tr.marked, W.selectedSegment(), duration());
  if (!region) { status('ループする字幕を選ぶか、ルーラーを Alt+ドラッグして範囲を指定してください。', true); return; }
  tr.region = region; tr.loopOn = true;
  if (video.currentTime < region.start || video.currentTime >= region.end) W.seekTimeline(region.start);
  renderLoop(); status(`ループ ${fmt(region.start)}–${fmt(region.end)}`);
}
function setMarked(region) {
  tr.marked = region;
  if (region) { tr.region = region; tr.loopOn = true; } else if (tr.loopOn) { tr.loopOn = false; tr.region = null; }
  renderLoop();
}

function attachVideo(video) {
  video.playbackRate = tr.speed;
  video.addEventListener('play', () => { $('captionPlay').textContent = '❚❚'; W.timelineFollow(true); });
  video.addEventListener('pause', () => { $('captionPlay').textContent = '▶'; });
}

/* Per frame while playing: wrap at the loop end, and jump over the trimmed-away parts of the source video. */
function skipCuts(frame, video) {
  if (video.paused || video.seeking) return;
  const wrap = tr.loopOn && !tr.syncing ? TL.loopSeek(frame.mediaTime, tr.region) : null;
  if (wrap !== null) { video.currentTime = wrap; return; }
  const clips = J.videoClips(ui.store.project);
  if (!clips.some(clip => frame.mediaTime >= clip.start && frame.mediaTime < clip.end)) {
    const next = clips.find(clip => clip.start > frame.mediaTime);
    if (next) video.currentTime = next.start; else video.pause();
  }
}

/* ---- keyboard ---- */
const TYPING = /^(INPUT|TEXTAREA|SELECT)$/;
function ignoresKey(event) {
  const target = event.target || {}, tag = target.tagName || '';
  if (TYPING.test(tag) && target.type !== 'checkbox') return true;       // fields and sliders keep their keys
  if (target.isContentEditable || (target.closest && target.closest('[role=menu], .caption-popover'))) return true;   // open menus and popovers keep their own keys
  return !!document.querySelector && !!document.querySelector('dialog[open]');
}
function onKey(event) {
  if (!ui.store || event.defaultPrevented || event.isComposing) return;
  const root = document.getElementById('app'); if (root && root.dataset.productMode && root.dataset.productMode !== 'video-captions') return;
  const action = TL.keyAction(event); if (!action || ignoresKey(event)) return;
  const target = event.target || {};
  if (W.syncKey && W.syncKey(event)) { event.preventDefault(); event.stopImmediatePropagation(); return; }   // during a tap-sync pass Space taps, Enter confirms, Esc discards
  // Native widgets that use the same keys keep them: buttons take Space, sliders take the arrows.
  if ((action === 'play' || action === 'edit') && target.tagName === 'BUTTON') return;
  if (/^(back|forward)-/.test(action) || action === 'prev-caption' || action === 'next-caption') { if (target.closest && target.closest('[data-boundary-segment]')) return; }
  if (!sourceVideo() && action !== 'escape' && action !== 'edit' && action !== 'new' && action !== 'delete' && !/^(nudge|track)-/.test(action)) return;
  const handled = run(action); if (!handled) return;
  event.preventDefault(); event.stopImmediatePropagation();
}
function run(action) {
  switch (action) {
    case 'play': togglePlay(); return true;
    case 'edit': if (!W.editText || ui.selection.segmentIds.size !== 1) return false; W.editText(); return true;
    case 'back-frame': seekBy(-1); return true;
    case 'forward-frame': seekBy(1); return true;
    case 'back-1s': seekBy(-1, 1); return true;
    case 'forward-1s': seekBy(1, 1); return true;
    case 'prev-caption': gotoCaption(-1); return true;
    case 'next-caption': gotoCaption(1); return true;
    case 'start': seekEdge(false); return true;
    case 'end': seekEdge(true); return true;
    case 'loop': setLoop(!tr.loopOn); return true;
    case 'set-start': return W.timingAtPlayhead('start');
    case 'set-end': return W.timingAtPlayhead('end');
    case 'nudge-back': return W.nudgeSegment(-1);
    case 'nudge-forward': return W.nudgeSegment(1);
    case 'track-up': return W.moveSelectedTrack(-1);
    case 'track-down': return W.moveSelectedTrack(1);
    case 'new': return W.newCaptionAtPlayhead();
    case 'split': return W.splitAtPlayhead();
    case 'delete': return W.deleteSelected();
    case 'zoom-in': ui.timeline.follow = false; W.zoomTimeline(2); return true;
    case 'zoom-out': ui.timeline.follow = false; W.zoomTimeline(.5); return true;
    case 'zoom-fit': W.fitTimeline(); return true;
    case 'escape':
      if (tr.loopOn) { setLoop(false); return true; }
      if (ui.selection.segmentIds.size) { W.clearSelection(); return true; }
      return false;
    default: return false;
  }
}

function init() {
  $('captionPlay').addEventListener('click', togglePlay);
  $('captionScrub').addEventListener('input', event => scrubTo(event.target.value));
  $('captionSpeed').addEventListener('click', () => setSpeed(TL.nextSpeed(tr.speed)));
  $('captionSnap').addEventListener('click', () => { tr.snap = !tr.snap; $('captionSnap').setAttribute('aria-pressed', String(tr.snap)); });
  $('captionLoop').addEventListener('click', () => setLoop(!tr.loopOn));
  // Capture phase: the Lyric Motion shortcuts live on the same document and must not also fire.
  document.addEventListener('keydown', onKey, true);
  W.on('project', () => { if (tr.marked && tr.marked.end > duration()) setMarked(null); });
}
Object.assign(W, { attachVideo, scrubTo, setLoop, setMarked, setSpeed, skipCuts, togglePlay, transportKey: run });
W.inits.push(init);
})();
