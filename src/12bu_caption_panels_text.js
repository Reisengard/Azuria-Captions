/* ============================================================
   JIZURA — Video Captions workbench: Style and Word styles panels
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb;
const { ui, $, clone, status, activeTrack, runCommand, lookLabel, on } = W;
/* ---- word styles (roles: base / active / emphasis) ----
   Values are stored on the track. Only the base role re-plans (it changes what fits); the others restyle words in place.
   Unset values show what the track uses instead ("Auto"); every row has its own reset. The spoken word's effect is
   chosen in Effects; a treatment stored on the role by older versions still wins and is shown with a button to remove it. */
const ROLE_CONTROLS = {
  captionRoleBaseFont: ['base', 'font'], captionRoleBaseColor: ['base', 'color'], captionRoleBaseFontSize: ['base', 'fontSize'],
  captionRoleActiveColor: ['active', 'color'],
  captionRoleEmphasisFont: ['emphasis', 'font'], captionRoleEmphasisColor: ['emphasis', 'color'],
  captionRoleEmphasisScale: ['emphasis', 'scale'], captionRoleEmphasisAmount: ['emphasis', 'threshold'],
};
// "How much is emphasised" runs the other way from the stored threshold: more = a lower threshold.
const roleInputValue = (id, value) => id === 'captionRoleEmphasisAmount' ? +(1 - value).toFixed(2) : value;
const roleStoredValue = (id, value) => id === 'captionRoleEmphasisAmount' ? +(1 - value).toFixed(2) : value;
let roleFontsLoaded = '';
const roleTrack = () => activeTrack();

function fillRoleOptions() {
  const option = (value, label) => { const node = document.createElement('option'); node.value = value; node.textContent = label; return node; };
  for (const [id, emptyLabel] of [['captionRoleBaseFont', '自動（スタイルに合わせる）'], ['captionRoleEmphasisFont', '使わない']]) {
    const select = $(id); select.replaceChildren(option('', emptyLabel));
    for (const key of J.CAPTION_FONTS) select.appendChild(option(key, J.FONTS[key] ? J.FONTS[key].label : key));
  }
}

/* What the track draws with when a role leaves a value unset. */
function roleDefaults(project, track) {
  const style = J.captionTrackProjectStyle(project, track) || {}, profile = J.CAPTION_STYLE_PROFILES[J.captionStyleProfileId(project, track)] || {};
  const look = J.resolveCaptionLook(style, J.captionStyleProfileId(project, track)).look;
  return { style, textColor: (profile.textColor || '#ffffff').toLowerCase(), fontSize: profile.fontSize || 76, accentColor: (style.accentColor || profile.accentColor || '#B39D68').toLowerCase(), active: look.active };
}

function roleValueText(id, value, set, count) {
  if (id === 'captionRoleEmphasisAmount') return `${count.count} / ${count.total} 語`;
  if (!set) return id === 'captionRoleEmphasisColor' ? 'なし' : id === 'captionRoleEmphasisScale' ? '同じ' : '自動';
  if (id === 'captionRoleBaseFontSize') return `${value}px`;
  if (id === 'captionRoleEmphasisScale') return `×${Number(value).toFixed(2)}`;
  return String(value);
}

function renderRolesPanel() {
  const project = ui.store.project, tracks = project.tracks || [], track = roleTrack(), roles = track && track.roles || {}, enabled = !!track;
  const trackSelect = $('captionRoleTrack'); trackSelect.replaceChildren();
  for (const item of tracks) { const option = document.createElement('option'); option.value = item.id; option.textContent = item.name || item.id; trackSelect.appendChild(option); }
  trackSelect.value = track ? track.id : ''; $('captionRoleTrackField').hidden = tracks.length < 2;
  const defaults = track ? roleDefaults(project, track) : { textColor: '#ffffff', fontSize: 76, accentColor: '#B39D68' };
  const baseColor = roles.base && roles.base.color || defaults.textColor;
  const shown = { captionRoleBaseColor: defaults.textColor, captionRoleBaseFontSize: defaults.fontSize, captionRoleActiveColor: defaults.accentColor,
    captionRoleEmphasisColor: baseColor, captionRoleEmphasisScale: 1, captionRoleEmphasisAmount: J.CAPTION_EMPHASIS_THRESHOLD };
  const count = track ? J.captionEmphasisCount(project, track.id) : { count: 0, total: 0 };
  for (const [id, [role, field]] of Object.entries(ROLE_CONTROLS)) {
    const input = $(id), value = roles[role] && roles[role][field], set = value != null && value !== '';
    input.disabled = !enabled;
    input.value = input.tagName === 'SELECT' ? (set ? value : '') : roleInputValue(id, set ? value : shown[id]);
    const row = input.closest('.caption-role-row'); if (row) row.classList.toggle('is-set', set);
    const out = document.querySelector(`[data-role-value="${id}"]`); if (out) out.textContent = roleValueText(id, value, set, count);
    const clear = document.querySelector(`[data-role-clear="${id}"]`); if (clear) clear.disabled = !enabled || !set;
  }
  $('captionRolesReset').disabled = !enabled || !['base', 'active', 'emphasis'].some(role => Object.keys(roles[role] || {}).length);
  $('captionRoleEmphasisHint').hidden = !enabled || J.captionRoleStylesEmphasis(track);
  renderRoleActiveNotes(project, track, roles, defaults);
  paintRoleSample(project, track, roles, defaults);
  const warnings = $('captionRolesWarnings'); warnings.replaceChildren();
  const used = J.captionRoleFonts(project);
  for (const font of J.captionFontStatus(project).filter(item => used.includes(item.key))) {
    const message = !font.ready ? '指定フォントを読み込めませんでした。ネットワークを確認するか、別のフォントを選んでください。'
      : !font.bundled ? `${font.label}: アプリに同梱されていないため、環境によって文字幅が変わる場合があります。` : null;
    if (message) { const item = document.createElement('div'); item.className = 'caption-warning'; item.textContent = message; warnings.appendChild(item); }
  }
  const signature = used.join(',');
  if (signature !== roleFontsLoaded) {
    roleFontsLoaded = signature;
    if (used.length && J.ensureCaptionFonts) J.ensureCaptionFonts(project).then(() => { if (ui.preview) ui.preview.renderNow(); renderRolesPanel(); }).catch(() => {});
  }
}

/* The spoken word: where its effect is chosen, and the older role override that still wins over Effects. */
function renderRoleActiveNotes(project, track, roles, defaults) {
  const advanced = project.style && project.style.editor === 'advanced', active = roles.active || {}, effect = lookLabel('active', active.treatment || defaults.active) || '—';
  $('captionRoleActiveHint').textContent = advanced ? `動き方は「${effect}」です。エフェクトの「話している単語」で変えられます。`
    : `動き方は「${effect}」です。詳細モードにすると、エフェクトで変えられます。`;
  $('captionRoleActiveOpen').hidden = !advanced || !track;
  $('captionRoleActiveOverride').hidden = !active.treatment;
  $('captionRoleActiveOverrideText').textContent = active.treatment ? `このトラックでは話している単語の動きが「${lookLabel('active', active.treatment)}」に固定され、エフェクトの設定より優先されています。` : '';
  // An effect setting's colour is drawn before the role colour (compositor), so say when the role colour cannot show.
  const effectColor = !!track && J.captionTrackSegments(project, track.id).some(segment => {
    const plan = J.captionResolvedPlan(project.plans[segment.id]);
    return !!J.captionLookSettingsFor(plan.lookSettings, 'active', active.treatment || plan.activeWordTreatment).color;
  });
  $('captionRoleActiveColorNote').hidden = !effectColor;
}

/* A still sample drawn by the caption compositor with what this track resolves to. */
function paintRoleSample(project, track, roles, defaults) {
  const canvas = $('captionRoleSample'); if (!canvas || !J.paintCaptionRoleSample || !canvas.getContext) return;
  const base = roles.base || {}, style = defaults.style || {};
  J.paintCaptionRoleSample(canvas, roles, { font: base.font || style.font, textColor: base.color || defaults.textColor, accentColor: defaults.accentColor,
    activeWordTreatment: defaults.active || 'captionActiveColor', captionTreatment: style.captionTreatment || 'outline' });
}

function applyRoleInput(input) {
  const track = roleTrack(); if (!track) return;
  const [role, field] = ROLE_CONTROLS[input.id];
  const value = input.value === '' ? null : input.type === 'range' ? roleStoredValue(input.id, Number(input.value)) : input.value;
  runCommand({ type: 'set-track-roles', trackId: track.id, roles: { [role]: { [field]: value } } });
}

/* While a slider moves, only its readout follows (the command runs on release). */
function previewRoleInput(input) {
  const track = roleTrack(), out = document.querySelector(`[data-role-value="${input.id}"]`); if (!track || !out) return;
  const value = roleStoredValue(input.id, Number(input.value));
  out.textContent = roleValueText(input.id, value, true, input.id === 'captionRoleEmphasisAmount' ? J.captionEmphasisCount(ui.store.project, track.id, value) : null);
}

function openActiveEffect() {
  const track = roleTrack(), tracks = ui.store.project.tracks || [];
  ui.lookScope = tracks.length > 1 && track ? `track:${track.id}` : 'project'; ui.lookPick = 'active'; ui.lookSignature = null;
  W.selectStyleTab('effects'); W.renderLookPanel();
}

function clearRoleInput(button) {
  const track = roleTrack(), [role, field] = ROLE_CONTROLS[button.dataset.roleClear] || []; if (!track || !role) return;
  runCommand({ type: 'set-track-roles', trackId: track.id, roles: { [role]: { [field]: null } } });
}
function replanStyle(event) {
  const project = clone(ui.store.project), motion = Number($('captionMotion').value) / 100, intensity = Number($('captionIntensity').value) / 100;
  project.style = Object.assign({}, project.style, { preset: $('captionStyle').value, effect: $('captionEffect').value, holdEffect: $('captionHoldEffect').value, exitEffect: $('captionExitEffect').value, captionTreatment: $('captionTreatment').value, intensity, motion, accentColor: $('captionAccent').value,
    editor: $('captionModePro').getAttribute('aria-pressed') === 'true' ? 'advanced' : 'simple',
    writingMode: $('captionWritingMode').value,
    emphasisStrength: Number($('captionEmphasisStrength').value) / 100,
    motionBudget: { maxIntensity: Math.max(0, Math.round(intensity * 3)), maxMotionCost: .25 + motion * .9, maxAttentionCost: .3 + intensity * .8 } });
  // Alignment is only stored once the user picks one, so untouched projects keep each layout's own alignment.
  if (event && event.target && event.target.id === 'captionAlignment') project.style.alignment = $('captionAlignment').value;
  if (runCommand({ type: 'set-caption-style', style: project.style })) status('スタイルを更新しました。');
}

function changeDensity() {
  const maxWords = Number($('captionDensity').value); $('captionDensityValue').value = maxWords;
  if (!ui.store.project.transcript.tokens.length) { ui.store.project.style.segmentation = { maxWords, targetWords: Math.max(1, maxWords - 2) }; return; }
  const unlocked = ui.store.project.segments.some(segment => !(segment.locks && segment.locks.segmentation));
  if (unlocked && !window.confirm('単語数を変えると、ロックされていない字幕の区切りが変わることがあります。続けますか？')) { W.renderActions(); return; }
  const project = clone(ui.store.project); project.style = Object.assign({}, project.style, { segmentation: Object.assign({}, project.style && project.style.segmentation, { maxWords, targetWords: Math.max(1, maxWords - 2) }) });
  project.segments = J.replanCaptionSegments(project, project.style.segmentation).segments;
  const planned = J.planCaptions(project, project.media); project.plans = planned.plans; W.setProject(project, true); status('字幕の密度と区切りを更新しました。');
}

function renderStyleControls() {
  $('captionStyle').value = ui.store.project.style && ui.store.project.style.preset || 'creator';
  const style = ui.store.project.style || {}, segmentation = style.segmentation || {};
  const editor = style.editor === 'advanced' ? 'advanced' : 'simple';
  $('captionModeEasy').setAttribute('aria-pressed', String(editor === 'simple')); $('captionModePro').setAttribute('aria-pressed', String(editor === 'advanced'));
  $('videoCaptionsWorkspace').classList.toggle('is-easy', editor !== 'advanced');
  $('captionIntensity').value = Math.round((style.intensity == null ? .5 : style.intensity) * 100);
  $('captionMotion').value = Math.round((style.motion == null ? .45 : style.motion) * 100);
  $('captionDensity').value = segmentation.maxWords || 6; $('captionDensityValue').value = $('captionDensity').value;
  $('captionAlignment').value = style.alignment || 'center'; $('captionAccent').value = style.accentColor || '#B39D68';
  $('captionWritingMode').value = style.writingMode || 'horizontal'; $('captionEmphasisStrength').value = Math.round((style.emphasisStrength == null ? 1 : style.emphasisStrength) * 100);
  $('captionReducedMotion').checked = !!(ui.store.project.settings && ui.store.project.settings.reducedMotionPreview);
  $('captionPreviewFrame').dataset.reducedMotion = String($('captionReducedMotion').checked);
  $('captionProfileNote').textContent = style.preset === 'jizura-mv' ? '動きと注目度が高いスタイルです。必要に応じて「プレビューの動きを減らす」を有効にしてください。'
    : style.preset === 'punchy' ? '強調をはっきり見せる、中程度の動きのスタイルです。' : '読みやすさを優先した標準スタイルです。';
}

function init() {
  /* Simple / Advanced changes which techniques the planner may pick, so it stays project state (undoable, saved), not a view preference. */
  for (const [id, mode] of [['captionModeEasy', 'simple'], ['captionModePro', 'advanced']]) $(id).addEventListener('click', () => {
    if ($('captionModePro').getAttribute('aria-pressed') === String(mode === 'advanced')) return;
    $('captionModeEasy').setAttribute('aria-pressed', String(mode === 'simple')); $('captionModePro').setAttribute('aria-pressed', String(mode === 'advanced'));
    replanStyle(); W.renderActions();
  });
  $('captionTreatment').addEventListener('change', replanStyle);
  $('captionStyle').addEventListener('change', () => { $('captionEffect').value = 'auto'; $('captionHoldEffect').value = 'auto'; $('captionExitEffect').value = 'auto'; replanStyle(); }); $('captionIntensity').addEventListener('change', replanStyle); $('captionMotion').addEventListener('change', replanStyle); $('captionAccent').addEventListener('change', replanStyle);
  fillRoleOptions();
  for (const id of Object.keys(ROLE_CONTROLS)) {
    $(id).addEventListener('change', () => applyRoleInput($(id)));
    if ($(id).type === 'range') $(id).addEventListener('input', () => previewRoleInput($(id)));
  }
  document.querySelectorAll('[data-role-clear]').forEach(button => button.addEventListener('click', event => { event.preventDefault(); clearRoleInput(button); }));
  $('captionRoleTrack').addEventListener('change', event => W.selectTrack(event.target.value));
  $('captionRoleActiveOpen').addEventListener('click', event => { event.preventDefault(); openActiveEffect(); });
  $('captionRoleActiveOverrideClear').addEventListener('click', () => { const track = roleTrack(); if (track) runCommand({ type: 'set-track-roles', trackId: track.id, roles: { active: { treatment: null } } }); });
  $('captionRolesReset').addEventListener('click', () => { const track = roleTrack(); if (track) runCommand({ type: 'set-track-roles', trackId: track.id, reset: true }); });
  $('captionAlignment').addEventListener('change', replanStyle); $('captionWritingMode').addEventListener('change', replanStyle); $('captionEmphasisStrength').addEventListener('change', replanStyle);
  $('captionReducedMotion').addEventListener('change', event => { runCommand({ type: 'set-project-setting', field: 'reducedMotionPreview', value: event.target.checked }, ui.selectedId); status(event.target.checked ? 'プレビューの動きを減らしました。' : '通常のプレビュー動作に戻しました。'); });
  $('captionDensity').addEventListener('input', () => { $('captionDensityValue').value = $('captionDensity').value; }); $('captionDensity').addEventListener('change', changeDensity);
  on('project', () => { renderRolesPanel(); renderStyleControls(); }); on('selection', renderRolesPanel);
}
Object.assign(W, { ROLE_CONTROLS, applyRoleInput, changeDensity, clearRoleInput, fillRoleOptions, openActiveEffect, paintRoleSample, previewRoleInput, renderRoleActiveNotes, renderRolesPanel, renderStyleControls, replanStyle, roleDefaults, roleInputValue, roleStoredValue, roleTrack, roleValueText });
W.inits.push(init);
})();
