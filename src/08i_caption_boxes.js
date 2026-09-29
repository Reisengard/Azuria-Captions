/* ============================================================
   JIZURA — caption placement boxes (delta plan steps 3-4)

   A box is a normalized (0-1) block-level rectangle. It follows the output
   format, so it is stored once and converted to pixels at draw/plan time.
   Position comes from, in order: segment override (plan.manual.box), track
   box, and the style's default (only for a track whose box was never edited).
   Nothing here moves text on its own: problems become warnings.
   ============================================================ */
(() => {
'use strict';

const round9 = value => Math.round(value * 1e9) / 1e9;
const round3 = value => Math.round(value * 1e3) / 1e3;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const FIELDS = ['x', 'y', 'width', 'height'];
const MIN_SIZE = 0.05;
const SNAP_THRESHOLD = 0.012;
const validFrame = frame => !!frame && frame.width > 0 && frame.height > 0;

J.CAPTION_BOX_MIN_SIZE = MIN_SIZE;

J.isCaptionBox = box => !!box && typeof box === 'object' && FIELDS.every(field => Number.isFinite(box[field]))
  && box.x >= 0 && box.y >= 0 && box.width > 0 && box.height > 0 && box.x + box.width <= 1 + 1e-6 && box.y + box.height <= 1 + 1e-6;

/* Keep an edited rectangle inside the frame (a drag stops at the edge; it never wraps). */
J.clampCaptionBox = box => {
  const width = clamp(Number(box.width), MIN_SIZE, 1), height = clamp(Number(box.height), MIN_SIZE, 1);
  const x = clamp(Number(box.x), 0, 1 - width), y = clamp(Number(box.y), 0, 1 - height);
  const out = { x: round9(x), y: round9(y), width: round9(width), height: round9(height) };
  if (![out.x, out.y, out.width, out.height].every(Number.isFinite)) throw new J.ProjectError('CAPTION_BOX_INVALID', 'Caption box requires finite numbers.');
  if (box.zoneKind) out.zoneKind = box.zoneKind;
  return out;
};

/* Stored boxes carry only the four fields at 1e-9 precision; edits are validated, never clamped, by the store. */
J.roundCaptionBox = box => ({ x: round9(box.x), y: round9(box.y), width: round9(box.width), height: round9(box.height) });

J.captionBoxToZone = (box, frame, id) => {
  const kind = box.zoneKind || 'custom';
  return {
    id: id || (kind !== 'custom' ? `caption-${kind}` : 'caption-box'), kind,
    x: round3(box.x * frame.width), y: round3(box.y * frame.height),
    width: round3(box.width * frame.width), height: round3(box.height * frame.height),
    preset: kind === 'custom' ? null : 'vertical-social-safe', manual: box.manual === true || kind === 'custom',
  };
};

J.captionZoneToBox = (zone, frame) => {
  const box = { x: round9(zone.x / frame.width), y: round9(zone.y / frame.height), width: round9(zone.width / frame.width), height: round9(zone.height / frame.height) };
  if (zone.kind) box.zoneKind = zone.kind;
  return box;
};

J.captionTrack = (project, trackId) => (project && project.tracks || []).find(track => track.id === (trackId || J.CAPTION_PRIMARY_TRACK_ID)) || null;

/* Segment override, then track box. Returns null when neither exists (legacy bare projects). */
J.captionEffectiveBox = (project, segment, plan) => {
  const stored = plan && (plan.manual ? plan : { manual: {} });
  if (stored && J.isCaptionBox(stored.manual.box)) return stored.manual.box;
  const track = J.captionTrack(project, segment && segment.trackId);
  return track && J.isCaptionBox(track.box) ? track.box : null;
};

/* The box a stored plan was drawn with, as pixels of `frame`. Plans made before
   boxes existed only carry a pixel zone; they keep rendering from it unchanged. */
J.captionPlanZone = (plan, frame, sourceFrame) => {
  if (plan && J.isCaptionBox(plan.box)) return J.captionBoxToZone(plan.box, frame, plan.zoneId);
  const zone = plan && plan.zone;
  if (!zone) return null;
  const from = sourceFrame || frame;
  return Object.assign({}, zone, { x: zone.x * frame.width / from.width, y: zone.y * frame.height / from.height,
    width: zone.width * frame.width / from.width, height: zone.height * frame.height / from.height });
};

/* Advisory problems with a box. Never used to move or resize it. */
J.captionBoxWarnings = (box, frame) => {
  const warnings = [];
  if (!J.isCaptionBox(box)) return [{ code: 'box-invalid' }];
  if (box.width < 0.2) warnings.push({ code: 'box-narrow', width: box.width });
  if (validFrame(frame)) {
    const safe = J.captionSocialSafeRect(frame), zone = J.captionBoxToZone(box, frame);
    if (zone.x < safe.x - 1e-6 || zone.y < safe.y - 1e-6 || zone.x + zone.width > safe.x + safe.width + 1e-6 || zone.y + zone.height > safe.y + safe.height + 1e-6) {
      warnings.push({ code: 'box-outside-safe-area' });
    }
  }
  return warnings;
};

/* Snap targets: frame centre lines, social-safe edges and thirds. */
J.captionSnapTargets = frame => {
  const targets = { x: [{ at: 0.5, name: 'center' }, { at: 1 / 3, name: 'third' }, { at: 2 / 3, name: 'third' }], y: [{ at: 0.5, name: 'center' }, { at: 1 / 3, name: 'third' }, { at: 2 / 3, name: 'third' }] };
  if (validFrame(frame)) {
    const safe = J.captionSocialSafeRect(frame);
    targets.x.push({ at: safe.x / frame.width, name: 'safe' }, { at: (safe.x + safe.width) / frame.width, name: 'safe' });
    targets.y.push({ at: safe.y / frame.height, name: 'safe' }, { at: (safe.y + safe.height) / frame.height, name: 'safe' });
  }
  return targets;
};

const snapAxis = (start, size, targets, threshold, snapSize) => {
  let best = null;
  // A box edge or its centre may meet a target; the smallest move wins, ties resolve by target order.
  for (const target of targets) for (const [offset, part] of [[0, 'start'], [size / 2, 'middle'], [size, 'end']]) {
    if (snapSize && part === 'middle') continue;
    const delta = target.at - (start + offset);
    if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta) - 1e-12)) best = { delta, name: target.name, at: target.at };
  }
  return best;
};

/* Move (or edge-resize) with snapping. `mode` is 'move' or 'resize' (right edge: width only). */
J.snapCaptionBox = (box, frame, options = {}) => {
  const threshold = options.threshold == null ? SNAP_THRESHOLD : options.threshold, targets = J.captionSnapTargets(frame);
  const hits = [];
  let { x, y, width, height } = box;
  if (options.mode === 'resize') {
    const hit = snapAxis(x + width, 0, targets.x, threshold, true);
    if (hit) { width += hit.delta; hits.push({ axis: 'x', name: hit.name, at: hit.at }); }
  } else {
    const hx = snapAxis(x, width, targets.x, threshold), hy = snapAxis(y, height, targets.y, threshold);
    if (hx) { x += hx.delta; hits.push({ axis: 'x', name: hx.name, at: hx.at }); }
    if (hy) { y += hy.delta; hits.push({ axis: 'y', name: hy.name, at: hy.at }); }
  }
  return { box: J.clampCaptionBox(Object.assign({}, box, { x, y, width, height })), hits };
};

/* An untouched (never user-edited) track box follows the style's default zone and the frame.
   Edited boxes (manual: true) are left exactly as the user set them. */
J.captionSyncDefaultBoxes = project => {
  if (!project || !Array.isArray(project.tracks)) return project;
  const fresh = J.defaultCaptionTrack(project);
  for (const track of project.tracks) if (track.primary && !(track.box && track.box.manual === true)) track.box = fresh.box;
  return project;
};
})();
