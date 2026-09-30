/* ============================================================
   JIZURA — shared preview/export caption compositor (Gate 6.4)
   ============================================================ */
'use strict';

(() => {
const tokenMap = project => new Map((project.transcript && project.transcript.tokens || []).map(token => [token.id, token]));
const segmentAt = (project, time) => (project.segments || []).find(segment => time >= segment.start && time < segment.end) || null;
// One caption per track can be on screen; primary first, later tracks on top (the z-order is the track order).
const segmentsAt = (project, time) => J.captionSegmentsAt ? J.captionSegmentsAt(project, time) : [segmentAt(project, time)].filter(Boolean);

function captionPhase(segment, time, plan) {
  if (plan.animationDisabled) return { alpha: 1, dy: 0, scale: 1 };
  const edge = Math.min(.18, Math.max(.08, (segment.end - segment.start) * .18));
  const enter = Math.max(0, Math.min(1, (time - segment.start) / edge));
  const exit = Math.max(0, Math.min(1, (segment.end - time) / edge));
  const alpha = Math.min(enter, exit), rise = plan.entrance === 'captionSoftRise' || plan.entrance === 'softRise';
  const scaleIn = plan.entrance === 'captionSoftScale' || plan.entrance === 'softScale';
  return { alpha, dy: rise ? (1 - enter) * 18 : 0, scale: scaleIn ? .94 + enter * .06 : 1 };
}

function drawCaptionOverlay(ctx, project, time, info = {}) {
  const design = { designWidth: info.designWidth || project.media.width, designHeight: info.designHeight || project.media.height };
  if (J.drawVideoOverlays) J.drawVideoOverlays(ctx, project, 'below', design);
  if (J.drawVideoNotes) J.drawVideoNotes(ctx, project, time, design);
  const segments = segmentsAt(project, time);
  let result = null;
  if (segments.length) {
    const map = tokenMap(project), layers = segments.map(segment => drawCaptionSegment(ctx, project, segment, time, info, map));
    // The first layer keeps the old single-caption result shape; `layers` lists every track drawn.
    result = Object.assign({}, layers[0], { layers });
  }
  if (J.drawVideoOverlays) J.drawVideoOverlays(ctx, project, 'above', design);
  return result;
}

function drawCaptionSegment(ctx, project, segment, time, info, map) {
  const tokens = segment.tokenIds.map(id => map.get(id)).filter(Boolean), text = tokens.map(token => token.text).join(' ');
  const stored = project.plans && project.plans[segment.id], plan = J.captionResolvedPlan ? J.captionResolvedPlan(stored) : Object.assign({}, stored && stored.generated, stored && stored.manual);
  const W = Number(info.designWidth) || Number(project.media && project.media.width) || 1080;
  const H = Number(info.designHeight) || Number(project.media && project.media.height) || 1920;
  const sourceWidth = Number(project.media && project.media.width) || W, sourceHeight = Number(project.media && project.media.height) || H;
  // Position is the segment's box (override, else the box it was planned into, else its track's box).
  // Plans saved before boxes existed carry a pixel zone only and keep rendering from it.
  const frame = { width: W, height: H };
  const placed = plan.box || plan.zone ? plan : { box: J.captionEffectiveBox(project, segment, stored) };
  const zone = J.captionPlanZone(placed, frame, { width: sourceWidth, height: sourceHeight })
    || { id: 'caption-preview-bottom', kind: 'bottom', x: W * .08, y: H * .7, width: W * .84, height: H * .2 };
  const roleRender = J.captionRoleRender ? J.captionRoleRender(project, segment, plan, tokens) : { active: {}, emphasis: null };
  // Effect settings chosen in the look panel (Advanced); unset values keep each effect's own behaviour.
  const settingsOf = (stage, id) => J.captionLookSettingsFor ? J.captionLookSettingsFor(plan.lookSettings, stage, id) : {};
  const activeTreatment = roleRender.active.treatment || plan.activeWordTreatment, activeSet = settingsOf('active', activeTreatment);
  // Only an alignment the user set (project or track style) overrides the layout; a profile's default 'center' does not.
  const alignStyle = J.captionTrackProjectStyle ? J.captionTrackProjectStyle(project, J.captionTrack(project, segment.trackId)) : project.style;
  const explicitAlignment = alignStyle && alignStyle.alignment;
  const layout = J.composeCaptionLayout ? J.composeCaptionLayout(plan.layout || 'captionBottomStack', { text, tokens, clockTime: time,
    activeTreatment, accentColor: activeSet.color || roleRender.active.color || plan.accentColor, activeScale: activeSet.scale, activeLift: activeSet.lift, activeWeight: activeSet.weight,
    emphasis: roleRender.emphasis, font: plan.font, fontSize: plan.fontSize,
    zone, box: J.isCaptionBox(placed.box) ? placed.box : undefined, frame, textColor: plan.textColor || '#ffffff', alignment: explicitAlignment }) : null;
  const lines = layout && layout.lines || [text], fontSize = layout && layout.fontSize || Math.max(38, Math.min(74, W / Math.max(10, text.length * .62)));
  const anchor = layout && layout.anchor || { x: zone.x + zone.width / 2, y: zone.y + zone.height / 2, align: 'center' };
  // Use the same item/effect pipeline as Lyric Motion in both preview and export.
  if (J.mainDraw && J.Renderer && layout) {
    const reduced = info.reducedMotion === true || plan.animationDisabled;
    const duration = segment.end - segment.start, motion = plan.motion == null ? .6 : plan.motion;
    const enterSet = settingsOf('enter', plan.entrance), exitSet = settingsOf('exit', plan.exit), holdSet = settingsOf('hold', plan.hold);
    const entranceTime = Number.isFinite(enterSet.duration) ? Math.min(duration * .45, enterSet.duration) : Math.min(duration * .35, .22 + motion * .4);
    const exitTime = Number.isFinite(exitSet.duration) ? Math.min(duration * .45, exitSet.duration) : Math.min(duration * .2, .18);
    const cut = { seed: plan.seed || 1, dur: duration, inDur: reduced ? 0 : entranceTime,
      outDur: reduced ? 0 : exitTime, holdStrength: Number.isFinite(holdSet.strength) ? holdSet.strength : undefined,
      enter: reduced || motion === 0 ? 'cut' : plan.entrance, hold: reduced || motion === 0 ? 'still' : plan.hold,
      exit: reduced || motion === 0 ? 'cut' : plan.exit };
    const treatId = [plan.treatment, plan.textTreatment, plan.treat].find(id => id && id !== 'none' && J.TREAT && Object.prototype.hasOwnProperty.call(J.TREAT, id));
    // The scheme keeps every colour slot an effect may read (accent2, ghost, ...); only fg / bg / accent are the caption's own.
    const baseStyle = J.STYLES && J.STYLE_ORDER && J.STYLES[J.STYLE_ORDER[0]] || null;
    if (treatId) {
      // Treatments read planned params (e.g. splitColor's split point); seed them from the caption so the look is stable.
      cut.treat = treatId;
      const TD = J.TREAT[treatId];
      try { cut.treatP = TD.plan ? TD.plan(J.rng(J.h(cut.seed, J.sid(treatId), 93)), baseStyle || {}) || {} : {}; } catch (e) { cut.treatP = {}; }
      cut.treatP = Object.assign({}, cut.treatP, settingsOf('treat', treatId));
    }
    const sc = Object.assign({}, baseStyle && baseStyle.schemes && baseStyle.schemes[0], { fg: plan.textColor || '#ffffff', bg: plan.backgroundColor || '#111318', accent: plan.accentColor || '#f5a50c' });
    const env = J.Renderer.prototype.makeEnv(ctx, { W, H, fps: 30, style: baseStyle ? { fonts: baseStyle.fonts } : {}, fx: { motion }, }, cut, sc,
      { pass: 'main', t: time, lt: time - segment.start, scale: info.scale || 1, allowFilter: true });
    ctx.save();
    try {
      // Caption effects stay inside their chosen region rather than moving the video.
      ctx.beginPath(); ctx.rect(zone.x, zone.y, zone.width, zone.height); ctx.clip();
      for (const source of layout.items) {
        const item = Object.assign({}, source, { seed: cut.seed, stroke: Math.max(2, fontSize * .065),
          strokeColor: '#080a10', strokeUnder: true, vertical: plan.writingMode === 'vertical' });
        if (reduced && item.captionActive) item.captionActive = Object.assign({}, item.captionActive, { treatment: 'captionActiveColor' });
        const treatment = plan.captionTreatment || 'outline';
        if (treatment === 'neon') item.shadow = { color: sc.accent, blur: 12, dx: 0, dy: 0 };
        if (treatment === 'echo') item.echo = { n: 2, dx: -fontSize * .045, dy: fontSize * .05, a: .35, decay: .55, color: sc.accent };
        if (treatment === 'backplate') {
          const width = Math.max(...lines.map(line => J.measure({ text: line, font: item.font, size: item.size }).w));
          ctx.fillStyle = 'rgba(8,10,16,.82)';
          ctx.fillRect(anchor.x - (anchor.align === 'left' ? 0 : anchor.align === 'right' ? width : width / 2) - 12,
            anchor.y - lines.length * layout.lineHeight / 2 - 7, width + 24, lines.length * layout.lineHeight + 14);
        }
        J.mainDraw(env, item);
      }
    } finally { ctx.restore(); }
    return { segmentId: segment.id, activeTokenId: J.captionTokenStatesAt(tokens, time).activeTokenId, plan };
  }
  const states = J.captionTokenStatesAt(tokens, time), active = tokens.find(token => token.id === states.activeTokenId), phase = captionPhase(segment, time, plan);
  ctx.save(); ctx.globalAlpha *= phase.alpha; ctx.translate(anchor.x, anchor.y + phase.dy); ctx.scale(phase.scale, phase.scale);
  ctx.font = `700 ${fontSize}px sans-serif`; ctx.textAlign = anchor.align || 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
  if (plan.writingMode === 'vertical') {
    const glyphs = Array.from(text.replace(/\s/gu, '')), step = fontSize * 1.05, top = -(glyphs.length - 1) * step / 2;
    glyphs.forEach((glyph, index) => { const y = top + index * step; ctx.lineWidth = Math.max(5, fontSize * .11); ctx.strokeStyle = 'rgba(0,0,0,.88)'; ctx.strokeText(glyph, 0, y); ctx.fillStyle = plan.textColor || '#ffffff'; ctx.fillText(glyph, 0, y); });
    ctx.restore(); return { segmentId: segment.id, activeTokenId: states.activeTokenId, plan };
  }
  const lineHeight = layout && layout.lineHeight || fontSize * 1.18, firstY = -(lines.length - 1) * lineHeight / 2;
  lines.forEach((line, lineIndex) => { const y = firstY + lineIndex * lineHeight; ctx.lineWidth = Math.max(5, fontSize * .11); ctx.strokeStyle = 'rgba(0,0,0,.88)'; ctx.strokeText(line, 0, y); ctx.fillStyle = plan.textColor || '#ffffff'; ctx.fillText(line, 0, y);
    if (active && lines.length === 1) { const beforeIndex = text.indexOf(active.text), before = beforeIndex >= 0 ? text.slice(0, beforeIndex) : '', total = ctx.measureText(text).width;
      const left = (anchor.align === 'left' ? 0 : anchor.align === 'right' ? -total : -total / 2); ctx.textAlign = 'left'; ctx.fillStyle = plan.accentColor || project.style && project.style.accentColor || '#f5a50c'; ctx.fillText(active.text, left + ctx.measureText(before).width, y); ctx.textAlign = anchor.align || 'center'; }
  });
  ctx.restore(); return { segmentId: segment.id, activeTokenId: states.activeTokenId, plan };
}

J.captionSegmentAt = segmentAt;
J.drawCaptionOverlay = drawCaptionOverlay;
})();
