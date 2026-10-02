/* ============================================================
   JIZURA — Video Captions workbench: Effects panel
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb;
const { ui, $, status, selectedSegment, segmentTrackId, runCommand, lookLabel, LOOK_FIELD_NAMES, on } = W;
const captionLooks = {
  clean: ['captionSoftRise', 'captionStill', 'captionFadeOut', 'outline'],
  pop: ['captionPop', 'captionStill', 'captionShrinkOut', 'echo'],
  neon: ['captionBlur', 'captionWave', 'captionBlurOut', 'neon'],
  type: ['captionType', 'captionStill', 'captionFadeOut', 'backplate'],
};
const effectControls = ['captionEffect', 'captionHoldEffect', 'captionExitEffect', 'captionTreatment'];
const LOOK_CONTROLS = { layout: 'captionLookLayout', enter: 'captionLookEnter', hold: 'captionLookHold', exit: 'captionLookExit', active: 'captionLookActive' };
/* Effects: what the project / a track / one caption uses for each stage. An empty choice inherits (project: the style's fixed standard). */
function lookScope() {
  const project = ui.store.project, tracks = project.tracks || [], segment = selectedSegment();
  let kind = ui.lookScope;
  if (kind === 'segment' && !segment) kind = 'project';
  const track = kind.startsWith('track:') ? tracks.find(item => `track:${item.id}` === kind) : null;
  if (kind.startsWith('track:') && !track) kind = 'project';
  return { kind, track, segment: kind === 'segment' ? segment : null };
}
function renderLookPanel() {
  const project = ui.store.project, tracks = project.tracks || [], segment = selectedSegment(), scope = lookScope(), select = $('captionLookScope');
  select.replaceChildren();
  const add = (value, text) => { const option = document.createElement('option'); option.value = value; option.textContent = text; select.appendChild(option); };
  add('project', tracks.length > 1 ? '全体（すべてのトラック）' : '全体（すべての字幕）');
  if (tracks.length > 1) for (const track of tracks) add(`track:${track.id}`, `トラック: ${track.name || track.id}`);
  if (segment) add('segment', '選択中の字幕だけ');
  select.value = scope.kind; ui.lookScope = scope.kind;
  const track = scope.track || J.captionTrack(project, segmentTrackId(scope.segment || segment)) || tracks[0];
  const profileId = J.captionStyleProfileId(project, track), projectResolved = J.resolveCaptionLook(project.style, J.captionStyleProfileId(project));
  const trackLook = J.resolveCaptionLook(J.captionTrackProjectStyle(project, track), profileId).look;
  const stored = scope.segment && project.plans[scope.segment.id], manual = stored && stored.manual || {};
  const own = {};
  for (const key of J.CAPTION_LOOK_KEYS) {
    if (scope.segment) own[key] = manual[J.CAPTION_LOOK_FIELDS[key].plan] || null;
    else if (scope.track) own[key] = scope.track.style && scope.track.style.look && scope.track.style.look[key] || null;
    else own[key] = projectResolved.explicit[key] ? projectResolved.look[key] : null;
  }
  const locked = !!(scope.segment && scope.segment.locks && scope.segment.locks.visualPlan);
  const inherit = scope.segment ? { text: 'トラックに合わせる', look: trackLook } : scope.track ? { text: '全体に合わせる', look: projectResolved.look } : { text: '標準', look: J.CAPTION_STANDARD_LOOKS[profileId] || J.CAPTION_STANDARD_LOOKS.creator };
  // Effect settings at this scope, and the values it inherits (a caption: its track + project; a track: the project).
  const projectSettings = project.style && project.style.lookSettings || {};
  inherit.settings = scope.segment ? { own: manual.lookSettings || {}, from: (J.captionTrackProjectStyle(project, track) || {}).lookSettings || {} }
    : scope.track ? { own: scope.track.style && scope.track.style.lookSettings || {}, from: projectSettings } : { own: projectSettings, from: {} };
  for (const [key, id] of Object.entries(LOOK_CONTROLS)) {
    const control = $(id), ids = J.captionLookOptions(J.CAPTION_LOOK_FIELDS[key].group, project);
    for (const extra of [own[key], inherit.look[key]]) if (extra && !ids.includes(extra)) ids.push(extra);
    control.replaceChildren();
    const first = document.createElement('option'); first.value = ''; first.textContent = `${inherit.text}: ${lookLabel(key, inherit.look[key])}`; control.appendChild(first);
    for (const value of ids) { const option = document.createElement('option'); option.value = value; option.textContent = lookLabel(key, value); control.appendChild(option); }
    control.value = own[key] || ''; control.disabled = locked;
  }
  $('captionLookRandom').disabled = locked; $('captionLookReset').disabled = locked;
  renderLookPickers(project, scope, own, inherit, locked);
}

/* ---- effect pickers with animated examples: three rows in Simple, a chip bar plus a full grid in Advanced ---- */
const LOOK_STAGES_SIMPLE = ['enter', 'hold', 'exit', 'treat'];
const LOOK_STAGES_ADVANCED = ['layout', 'enter', 'hold', 'exit', 'active', 'treat'];
function setLook(key, value) { const scope = lookScope(); return runCommand(lookCommand({ look: { [key]: value || null } }), scope.segment && scope.segment.id); }
function lookChoices(key, project, own, inheritLook) {
  const ids = J.captionLookOptions(J.CAPTION_LOOK_FIELDS[key].group, project).slice();
  for (const extra of [own[key], inheritLook[key]]) if (extra && !ids.includes(extra)) ids.push(extra);
  if (key === 'treat' && !ids.includes('captionBackplate')) ids.unshift('captionBackplate');
  return ids;
}
function lookCard(key, id, text, on, disabled, onPick, badge) {
  const button = document.createElement('button'), canvas = document.createElement('canvas'), name = document.createElement('span'), label = document.createElement('span');
  button.type = 'button'; button.className = `tcard caption-look-card${on ? ' is-on' : ''}`; button.disabled = !!disabled; button.title = id;
  button.setAttribute('aria-pressed', String(!!on));
  canvas.width = 176; canvas.height = 99; canvas.dataset.g = J.CAPTION_LOOK_FIELDS[key].group; canvas.dataset.k = id;
  name.className = 'tcard-name'; label.textContent = text; name.appendChild(label);
  if (badge) { const tag = document.createElement('span'); tag.className = 'tcard-badge'; tag.textContent = 'New'; name.appendChild(tag); }
  button.append(canvas, name); button.addEventListener('click', onPick);
  return button;
}
function fillLookGrid(grid, key, project, own, inherit, locked) {
  const group = J.CAPTION_LOOK_FIELDS[key].group;
  grid.appendChild(lookCard(key, inherit.look[key], `${inherit.text}: ${lookLabel(key, inherit.look[key])}`, !own[key], locked, () => setLook(key, null)));
  for (const id of lookChoices(key, project, own, inherit.look)) {
    grid.appendChild(lookCard(key, id, lookLabel(key, id), own[key] === id, locked, () => setLook(key, id), group !== 'layout' && group !== 'active' && /^caption/.test(id)));
  }
}
function renderLookPickers(project, scope, own, inherit, locked) {
  const advanced = project.style && project.style.editor === 'advanced', simple = $('captionLookSimple'), chips = $('captionLookChips'), pick = $('captionLookPick');
  J.captionEffectPreviewMotion = !(project.settings && project.settings.reducedMotionPreview) && !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const stages = advanced ? LOOK_STAGES_ADVANCED : LOOK_STAGES_SIMPLE;
  if (!stages.includes(ui.lookPick)) ui.lookPick = 'enter';   // one sub-tab is always open
  const signature = JSON.stringify([advanced, scope.kind, stages.map(key => [own[key], inherit.look[key]]), locked, ui.lookPick, inherit.text, J.captionEffectPreviewMotion, inherit.settings]);
  if (signature === ui.lookSignature) return;
  ui.lookSignature = signature;
  if (J.resetCaptionEffectWatch) J.resetCaptionEffectWatch();
  simple.replaceChildren(); chips.replaceChildren(); pick.hidden = true; $('captionLookPickGrid').replaceChildren(); $('captionLookSettings').hidden = true;
  const select = key => { ui.lookPick = key; ui.lookSignature = null; renderLookPanel(); };
  if (!advanced) {
    const bar = document.createElement('div'), grid = document.createElement('div');
    bar.className = 'caption-look-subtabs'; bar.setAttribute('role', 'tablist'); grid.className = 'caption-look-grid is-compact';
    for (const key of stages) {
      const tab = document.createElement('button');
      tab.type = 'button'; tab.setAttribute('role', 'tab'); tab.dataset.stage = key; tab.setAttribute('aria-selected', String(ui.lookPick === key)); tab.textContent = LOOK_FIELD_NAMES[key];
      tab.addEventListener('click', () => select(key)); bar.appendChild(tab);
    }
    const settings = document.createElement('div'); settings.className = 'caption-look-settings';
    fillLookGrid(grid, ui.lookPick, project, own, inherit, locked); simple.append(bar, settings, grid);
    renderLookSettings(settings, ui.lookPick, own[ui.lookPick] || inherit.look[ui.lookPick], project, inherit, locked);
  } else {
    for (const key of stages) {
      const chip = document.createElement('button'), name = document.createElement('span'), value = document.createElement('b'), shown = own[key] || inherit.look[key];
      chip.type = 'button'; chip.setAttribute('role', 'tab'); chip.className = `caption-look-chip${own[key] ? ' is-set' : ''}`; chip.dataset.stage = key; chip.setAttribute('aria-pressed', String(ui.lookPick === key));
      name.textContent = LOOK_FIELD_NAMES[key]; value.textContent = lookLabel(key, shown);
      chip.append(name, ' ', value); chip.addEventListener('click', () => select(key));
      chips.appendChild(chip);
    }
    $('captionLookPickTitle').textContent = LOOK_FIELD_NAMES[ui.lookPick]; pick.hidden = false; $('captionLookPickClose').hidden = true;
    fillLookGrid($('captionLookPickGrid'), ui.lookPick, project, own, inherit, locked);
    renderLookSettings($('captionLookSettings'), ui.lookPick, own[ui.lookPick] || inherit.look[ui.lookPick], project, inherit, locked);
  }
  (advanced ? pick : simple).querySelectorAll('canvas[data-g]').forEach(canvas => J.watchCaptionEffect && J.watchCaptionEffect(canvas));
}

/* ---- settings of the effect shown in the sub-tab, Simple and Advanced (colours, lengths, sizes); unset values stay automatic ---- */
const LOOK_SETTING_LABELS = {
  'all.duration': '長さ（秒）',
  'all.strength': '動きの強さ',
  'color': '色',
  'colorA': '上の色',
  'colorB': '下の色',
  'splitColor.sp': '色の境目',
  'k': '線の太さ',
  'doubleOutline.a': '内側の縁の太さ',
  'doubleOutline.b': '外側の縁の太さ',
  'doubleOutline.color': '外側の縁の色',
  'extrude.d': '奥行き',
  'extrude.color': '側面の色',
  'longShadow.L': '影の長さ',
  'longShadow.ang': '影の角度',
  'hardShadow.d': '影のずれ',
  'softShadow.b': '影のぼかし',
  'softShadow.dy': '影の下へのずれ',
  'longShadow.color': '影の色',
  'hardShadow.color': '影の色',
  'softShadow.color': '影の色',
  'glow.b': '光の広がり',
  'glow.color': '光の色',
  'outline.color': '線の色',
  'outlineFill.color': '縁の色',
  'captionOutlined.color': '縁の色',
  'captionActiveScale.scale': '拡大',
  'captionActiveLift.lift': '持ち上げ',
  'captionActiveWeight.weight': '太さ（ウェイト）',
};
const lookSettingLabel = (scope, key) => LOOK_SETTING_LABELS[`${scope}.${key}`] || LOOK_SETTING_LABELS[key] || key;
const lookSettingText = (key, value) => key === 'duration' ? `${value.toFixed(2)} s` : key === 'strength' ? `×${value.toFixed(2)}` : key === 'scale' ? `×${value.toFixed(3)}`
  : key === 'ang' ? `${Math.round(value)}°` : key === 'weight' || key === 'lift' ? String(Math.round(value * 10) / 10) : `${Math.round(value * 1000) / 10}%`;
function setLookSetting(stage, scope, key, value) {
  const scopeState = lookScope();
  return runCommand(lookCommand({ lookSettings: { [stage]: { [scope]: { [key]: value } } } }), scopeState.segment && scopeState.segment.id);
}
function renderLookSettings(host, stage, effectId, project, inherit, locked) {
  const spec = J.captionLookSettingsSpec(stage, effectId);
  host.replaceChildren(); host.hidden = false;
  const title = document.createElement('h4'); title.textContent = `${lookLabel(stage, effectId)} の設定`; host.appendChild(title);
  if (!spec.length) { const note = document.createElement('p'); note.className = 'muted'; note.textContent = 'このエフェクトには調整できる設定がありません。'; host.appendChild(note); return; }
  const at = (settings, scope, key) => settings && settings[stage] && settings[stage][scope] && settings[stage][scope][key];
  for (const { scope, key, def } of spec) {
    const own = at(inherit.settings.own, scope, key), from = at(inherit.settings.from, scope, key), set = own != null;
    const fallback = def.type === 'color' && stage === 'active' ? (project.style && project.style.accentColor || def.def) : def.def;
    const value = set ? own : from != null ? from : fallback;
    const row = document.createElement('label'), name = document.createElement('span'), input = document.createElement('input'), out = document.createElement('output'), reset = document.createElement('button');
    row.className = `caption-look-setting${set ? ' is-set' : ''}`; row.dataset.setting = `${scope}.${key}`;
    name.textContent = lookSettingLabel(scope, key);
    input.type = def.type; input.disabled = locked;
    const unsetText = from != null ? inherit.text : '自動';
    if (def.type === 'range') {
      input.min = def.min; input.max = def.max; input.step = def.step; input.value = value;
      out.textContent = set || from != null ? lookSettingText(key, value) : unsetText;
      input.addEventListener('input', () => { out.textContent = lookSettingText(key, Number(input.value)); });
      input.addEventListener('change', () => setLookSetting(stage, scope, key, Number(input.value)));
    } else {
      input.value = value;
      out.textContent = set ? value : unsetText;
      input.addEventListener('change', () => setLookSetting(stage, scope, key, input.value.toLowerCase()));
    }
    reset.type = 'button'; reset.className = 'ghost small'; reset.textContent = '↺'; reset.title = '自動に戻す'; reset.setAttribute('aria-label', '自動に戻す'); reset.disabled = locked || !set;
    reset.addEventListener('click', event => { event.preventDefault(); setLookSetting(stage, scope, key, null); });
    row.append(name, input, out, reset); host.appendChild(row);
  }
}

function lookCommand(look) {
  const scope = lookScope();
  if (scope.segment) return Object.assign({ type: 'set-segment-look', segmentId: scope.segment.id }, look);
  return Object.assign({ type: 'set-caption-look' }, scope.track ? { trackId: scope.track.id } : {}, look);
}
function randomLook(scope) {
  ui.variation += 1;
  const command = { type: 'randomize-caption-look', variation: ui.variation };
  if (scope.segment) command.segmentId = scope.segment.id; else if (scope.track) command.trackId = scope.track.id;
  return command;
}
const CAPTION_TECHNIQUE_GROUPS = {
  layout: 'レイアウト',
  enter: '登場',
  hold: '保持',
  exit: '退場',
  decor: '装飾',
  treat: '文字の加工',
  bg: '背景',
  cam: 'カメラ',
  fx: '画面効果',
  trans: 'カット間のつなぎ',
};
const CAPTION_TECHNIQUE_SET_LABELS = [
  ['extra', '追加分の演出も使う'],
  ['wa', '和風の演出も使う'],
  ['typo', '文字PV系の部品を使う'],
  ['kinetic', 'キネティックの部品を使う'],
  ['horror', 'ホラーの演出も使う'],
];
J.CAPTION_TECHNIQUE_DRAW = {
  layout: false, enter: true, hold: true, exit: true,
  decor: false, treat: true, bg: false, cam: false, fx: false, trans: false,
};
const captionTechMemory = { open: new Set(), filters: Object.create(null) };

function captionTechniqueParts(group) {
  const registry = J.registry(group);
  return J.order(group).filter(id => registry[id] && !registry[id].special);
}

function captionTechniqueShown(group, query) {
  const registry = J.registry(group);
  const q = String(query == null ? captionTechMemory.filters[group] || '' : query).trim().toLowerCase();
  return captionTechniqueParts(group).filter(id => !q || (registry[id].name + ' ' + id).trim().toLowerCase().includes(q));
}

function rememberCaptionTechniques(host) {
  if (typeof host.querySelectorAll !== 'function') return;
  host.querySelectorAll('[data-caption-group]').forEach(group => {
    const name = group.dataset.captionGroup;
    if (!name) return;
    if (group.open) captionTechMemory.open.add(name); else captionTechMemory.open.delete(name);
    const filter = typeof group.querySelector === 'function' ? group.querySelector('[data-caption-filter]') : null;
    if (filter) captionTechMemory.filters[name] = filter.value;
  });
}

function fillCaptionTechniqueParts(list, group) {
  list.replaceChildren();
  const registry = J.registry(group);
  const drawn = J.CAPTION_TECHNIQUE_DRAW[group] === true;
  for (const id of captionTechniqueShown(group)) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('type', 'checkbox');
    input.setAttribute('data-technique-id', id);
    input.checked = J.captionTechniqueOn(ui.store.project, group, id);
    input.disabled = !drawn;
    input.addEventListener('change', () => {
      if (J.CAPTION_TECHNIQUE_DRAW[group] !== true) return;
      const next = input.checked === true;
      if (J.captionTechniqueOn(ui.store.project, group, id) === next) return;
      runCommand({ type: 'set-technique', group, entries: { [id]: next } });
    });
    const name = document.createElement('span');
    name.textContent = registry[id].name;
    label.append(input, name);
    list.append(label);
  }
}

function renderCaptionTechniqueSets(project) {
  const box = document.createElement('div');
  box.className = 'caption-tech-sets';
  const flags = J.captionTechniques(project);
  for (const [set, labelText] of CAPTION_TECHNIQUE_SET_LABELS) {
    const label = document.createElement('label');
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('type', 'checkbox');
    input.setAttribute('data-caption-set', set);
    input.checked = flags[set] === true;
    input.disabled = false;
    input.addEventListener('change', () => {
      const value = input.checked === true;
      if (J.captionTechniques(ui.store.project)[set] === value) return;
      runCommand({ type: 'set-technique', set, value });
    });
    const text = document.createElement('span');
    text.textContent = labelText;
    label.append(input, text);
    box.append(label);
  }
  return box;
}

function renderCaptionTechniqueGroup(group, labelText) {
  const details = document.createElement('details');
  details.className = 'caption-tech-group';
  details.setAttribute('data-caption-group', group);
  details.open = captionTechMemory.open.has(group);
  const summary = document.createElement('summary');
  const name = document.createElement('span');
  name.className = 'caption-tech-name';
  name.textContent = labelText;
  const count = document.createElement('span');
  count.className = 'caption-tech-count';
  const parts = captionTechniqueParts(group);
  count.textContent = `${parts.filter(id => J.captionTechniqueOn(ui.store.project, group, id)).length}/${parts.length}`;
  summary.append(name, count);
  const filter = document.createElement('input');
  filter.type = 'search';
  filter.setAttribute('type', 'search');
  filter.className = 'caption-tech-filter';
  filter.setAttribute('data-caption-filter', group);
  filter.placeholder = '手法を名前で絞り込み';
  filter.setAttribute('placeholder', '手法を名前で絞り込み');
  filter.setAttribute('aria-label', '手法を名前で絞り込み');
  filter.value = captionTechMemory.filters[group] || '';
  const drawn = J.CAPTION_TECHNIQUE_DRAW[group] === true;
  const tools = document.createElement('div');
  tools.className = 'caption-tech-tools';
  for (const [action, text] of [['on', 'すべてON'], ['off', 'すべてOFF'], ['flip', '反転']]) {
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('type', 'button');
    button.className = 'ghost small';
    button.textContent = text;
    button.disabled = !drawn;
    button.addEventListener('click', () => {
      if (J.CAPTION_TECHNIQUE_DRAW[group] !== true) return;
      captionTechMemory.filters[group] = filter.value;
      const entries = {};
      for (const id of captionTechniqueShown(group, filter.value)) {
        const current = J.captionTechniqueOn(ui.store.project, group, id);
        const next = action === 'on' ? true : action === 'off' ? false : !current;
        if (next !== current) entries[id] = next;
      }
      if (!Object.keys(entries).length) return;
      runCommand({ type: 'set-technique', group, entries });
    });
    tools.append(button);
  }
  const note = document.createElement('p');
  note.className = 'caption-tech-note';
  note.textContent = 'This group is not drawn on the video yet.';
  note.hidden = drawn;
  const list = document.createElement('div');
  list.className = 'caption-tech-parts';
  fillCaptionTechniqueParts(list, group);
  filter.addEventListener('input', () => {
    captionTechMemory.filters[group] = filter.value;
    fillCaptionTechniqueParts(list, group);
  });
  details.append(summary, tools, filter, note, list);
  return details;
}

function renderCaptionTechniques() {
  const host = $('captionTechniqueHost');
  if (!host || typeof host.append !== 'function' || typeof host.replaceChildren !== 'function' || typeof J.order !== 'function' || typeof J.captionTechniques !== 'function') return;
  rememberCaptionTechniques(host);
  const groups = Object.entries(CAPTION_TECHNIQUE_GROUPS).map(([group, label]) => renderCaptionTechniqueGroup(group, label));
  host.replaceChildren(renderCaptionTechniqueSets(ui.store.project), ...groups);
}

function renderEffectControls() {
  const style = ui.store.project.style || {};
  $('captionTechniqueHost').hidden = true;   // the advanced editor now offers every effect in the Effects tab
  $('captionHoldEffect').value = style.holdEffect || 'auto'; $('captionExitEffect').value = style.exitEffect || 'auto';
  $('captionEffect').value = style.effect || 'auto'; $('captionTreatment').value = style.captionTreatment || 'outline';
  document.querySelectorAll('[data-caption-look]').forEach(button => {
    button.setAttribute('aria-pressed', String(captionLooks[button.dataset.captionLook].every((value, i) => $(effectControls[i]).value === value)));
  });
  const simplified = Object.values(ui.store.project.plans || {}).filter(stored => J.captionResolvedPlan(stored).fallback).length;
  $('captionEffectsSummary').textContent = effectControls.map(id => {
    const control = $(id); return control.options[control.selectedIndex]?.text || 'Match style';
  }).join(' / ') + (simplified ? ` · ${simplified} simplified for readability` : '');
}

function init() {
  $('captionEffect').addEventListener('change', () => {
    if ($('captionEffect').value !== 'auto') {
      $('captionStyle').value = 'jizura-mv';
      $('captionIntensity').value = Math.max(70, Number($('captionIntensity').value));
      $('captionMotion').value = Math.max(65, Number($('captionMotion').value));
    }
    W.replanStyle();
  });
  for (const id of ['captionHoldEffect', 'captionExitEffect']) $(id).addEventListener('change', () => {
    $('captionStyle').value = 'jizura-mv'; W.replanStyle();
  });
  document.querySelectorAll('[data-caption-look]').forEach(button => button.addEventListener('click', () => {
    captionLooks[button.dataset.captionLook].forEach((value, i) => { $(effectControls[i]).value = value; });
    $('captionStyle').value = 'jizura-mv'; $('captionIntensity').value = 70; $('captionMotion').value = 65;
    W.replanStyle();
  }));
  $('captionLookPickAuto').addEventListener('click', () => { if (ui.lookPick) setLook(ui.lookPick, null); });
  $('captionLookPickClose').addEventListener('click', () => { ui.lookPick = null; ui.lookSignature = null; renderLookPanel(); });
  $('captionLookScope').addEventListener('change', event => { ui.lookScope = event.target.value; renderLookPanel(); });
  for (const [key, id] of Object.entries(LOOK_CONTROLS)) $(id).addEventListener('change', event => { const scope = lookScope(); runCommand(lookCommand({ look: { [key]: event.target.value || null } }), scope.segment && scope.segment.id); });
  $('captionLookRandom').addEventListener('click', () => { const scope = lookScope(); if (runCommand(randomLook(scope), scope.segment && scope.segment.id)) status('エフェクトをランダムに決めました。決めた内容は固定され、元に戻すで戻せます。'); });
  $('captionLookReset').addEventListener('click', () => { const scope = lookScope(); runCommand(lookCommand({ reset: true }), scope.segment && scope.segment.id); });
  on('project', () => { renderLookPanel(); renderEffectControls(); });
}
Object.assign(W, { CAPTION_TECHNIQUE_GROUPS, CAPTION_TECHNIQUE_SET_LABELS, LOOK_CONTROLS, LOOK_SETTING_LABELS, LOOK_STAGES_ADVANCED, LOOK_STAGES_SIMPLE, captionLooks, captionTechMemory, captionTechniqueParts, captionTechniqueShown, effectControls, fillCaptionTechniqueParts, fillLookGrid, lookCard, lookChoices, lookCommand, lookScope, lookSettingLabel, lookSettingText, randomLook, rememberCaptionTechniques, renderCaptionTechniqueGroup, renderCaptionTechniqueSets, renderCaptionTechniques, renderEffectControls, renderLookPanel, renderLookPickers, renderLookSettings, setLook, setLookSetting });
W.inits.push(init);
})();
