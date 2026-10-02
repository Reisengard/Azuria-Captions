/* Dependency-free structural tests for Gate 5.4 style, variation, and locks. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
const ui = require('./caption_ui_source').workbenchSource(root);
const store = fs.readFileSync(path.join(root, 'src', '12b_caption_store.js'), 'utf8');

for (const id of ['captionStyle', 'captionIntensity', 'captionMotion', 'captionDensity', 'captionAlignment', 'captionAccent', 'captionWritingMode', 'captionEmphasisStrength', 'captionVariation', 'captionLock', 'captionReroll', 'captionDisableAnimation']) {
  assert.match(body, new RegExp(`id="${id}"`), `G5.4 is missing #${id}`);
}
assert.match(ui, /window\.confirm\('単語数を変えると/, 'segmentation replanning does not warn first');
assert.match(ui, /J\.replanCaptionSegments/, 'density control does not replan segmentation');
assert.match(ui, /randomize-caption-look/, 'randomize is not wired');
assert.match(store, /set-segment-locks/, 'whole-segment locking is not atomic');
assert.match(store, /set-segment-animation-disabled/, 'animation disable is not an undoable command');
assert.match(body, /<button id="captionModeEasy" type="button" aria-pressed="true"[^>]*>かんたん<\/button>\s*<button id="captionModePro" type="button" aria-pressed="false"[^>]*>詳細<\/button>/);
assert.equal(body.includes('id="captionEditor"'), false, 'the editor select was replaced by the bar toggle');
const hostMarkup = body.match(/<div id="captionTechniqueHost" hidden>([\s\S]*?)<\/div>/);
assert.equal(hostMarkup[1], '');
assert.equal(ui.includes('setMode'), false);
assert.equal(ui.includes('renderTech'), false);
assert.match(ui, /layout: false, enter: true, hold: true, exit: true,\s*decor: false, treat: true, bg: false, cam: false, fx: false, trans: false/);

const byId = {};
function matches(node, selector) {
  if (!node || !selector) return false;
  if (selector.includes(',')) return selector.split(',').some(part => matches(node, part.trim()));
  const attrs = [...selector.matchAll(/\[([^\]=\s]+)(?:="([^"]*)")?\]/g)];
  const rest = selector.replace(/\[[^\]]*\]/g, '').trim();
  if (rest.startsWith('.')) { if (!node.classList || !node.classList.contains(rest.slice(1))) return false; }
  else if (rest.startsWith('#')) { if (node.id !== rest.slice(1)) return false; }
  else if (rest && String(node.tagName) !== rest.toUpperCase()) return false;
  for (const [, name, value] of attrs) {
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      if (!node.dataset) return false;
      if (value === undefined ? node.dataset[key] == null : node.dataset[key] !== value) return false;
    } else if (typeof node.getAttribute !== 'function' || (value === undefined ? node.getAttribute(name) == null : node.getAttribute(name) !== value)) return false;
  }
  return true;
}
function queryAll(node, selector, out = []) {
  for (const child of node.children || []) {
    if (matches(child, selector)) out.push(child);
    queryAll(child, selector, out);
  }
  return out;
}
function createElement(tag) {
  const listeners = {};
  const attrs = {};
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    hidden: false,
    value: '',
    checked: false,
    textContent: '',
    className: '',
    style: {},
    dataset: {},
    options: [],
    selectedIndex: 0,
    disabled: false,
    files: [],
    children: [],
    parentNode: null,
    width: 300,
    height: 150,
    tabIndex: 0,
    title: '',
    type: '',
  };
  el.classList = {
    toggle(name, force) {
      const names = new Set(String(el.className || '').split(/\s+/).filter(Boolean));
      const has = names.has(name);
      const next = force === undefined ? !has : !!force;
      if (next) names.add(name); else names.delete(name);
      el.className = [...names].join(' ');
      return next;
    },
    add(name) { el.classList.toggle(name, true); },
    remove(name) { el.classList.toggle(name, false); },
    contains(name) { return String(el.className || '').split(/\s+/).includes(name); },
  };
  el.addEventListener = (type, fn) => { if (typeof fn === 'function') (listeners[type] || (listeners[type] = [])).push(fn); };
  el.removeEventListener = () => {};
  el.dispatchEvent = event => {
    const type = typeof event === 'string' ? event : event && event.type;
    const payload = Object.assign({}, event, { type, target: el, currentTarget: el });
    for (const fn of (listeners[type] || []).slice()) fn(payload);
    if (typeof el['on' + type] === 'function') el['on' + type](payload);
    return true;
  };
  el.setAttribute = (name, value) => {
    attrs[name] = String(value);
    if (name === 'id') { el.id = String(value); if (!byId[el.id]) byId[el.id] = el; }
    if (name === 'class') el.className = String(value);
    if (name === 'value') el.value = String(value);
    if (name === 'hidden') el.hidden = true;
    if (name === 'type') el.type = String(value);
    if ((name === 'width' || name === 'height') && Number.isFinite(Number(value))) el[name] = Number(value);
    if (name.startsWith('data-')) {
      const key = name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      el.dataset[key] = String(value);
    }
  };
  el.getAttribute = name => Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
  el.append = (...nodes) => { for (const node of nodes) { if (node == null || typeof node !== 'object') continue; node.parentNode = el; el.children.push(node); } };
  el.appendChild = node => { el.append(node); return node; };
  el.replaceChildren = (...nodes) => { el.children = []; el.append(...nodes); };
  el.querySelectorAll = selector => queryAll(el, selector, []);
  el.querySelector = selector => {
    const found = queryAll(el, selector, [])[0];
    if (found) return found;
    const edit = String(selector || '').match(/\[data-edit="([^"]+)"\]/);
    if (!edit) return null;
    const child = createElement(edit[1] === 'source' || edit[1] === 'output' ? 'canvas' : 'div');
    child.setAttribute('data-edit', edit[1]);
    el.append(child);
    return child;
  };
  el.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 });
  el.getContext = () => ({
    canvas: el, clearRect() {}, fillRect() {}, strokeRect() {}, drawImage() {}, fillText() {}, strokeText() {},
    save() {}, restore() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc() {}, arcTo() {},
    fill() {}, stroke() {}, clip() {}, translate() {}, scale() {}, rotate() {}, setTransform() {}, transform() {},
    putImageData() {}, measureText() { return { width: 8 }; },
    getImageData(_x, _y, w, h) { const width = w || 1, height = h || 1; return { data: new Uint8ClampedArray(width * height * 4), width, height }; },
    createImageData(w, h) { const width = w || 1, height = h || 1; return { data: new Uint8ClampedArray(width * height * 4), width, height }; },
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    createPattern() { return {}; },
  });
  el.focus = () => {};
  el.setPointerCapture = () => {};
  el.remove = () => {};
  el.closest = selector => { let node = el; while (node) { if (matches(node, selector)) return node; node = node.parentNode; } return null; };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(value) {
      html = String(value ?? '');
      el.children = [];
      const re = /<([a-zA-Z][\w:-]*)([^>]*)>/g;
      let match;
      while ((match = re.exec(html))) {
        const child = createElement(match[1]);
        const attrRe = /([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+)))?/g;
        let attr;
        while ((attr = attrRe.exec(match[2]))) child.setAttribute(attr[1], attr[2] ?? attr[3] ?? attr[4] ?? '');
        el.append(child);
      }
    },
  });
  return el;
}
function getElementById(id) {
  const key = String(id);
  if (!byId[key]) { const el = createElement('div'); el.id = key; byId[key] = el; }
  return byId[key];
}
function documentQuery(selector) {
  for (const node of Object.values(byId)) {
    if (matches(node, selector)) return node;
    const found = queryAll(node, selector)[0];
    if (found) return found;
  }
  return createElement('div');
}
function documentQueryAll(selector) {
  const out = [];
  for (const node of Object.values(byId)) {
    if (matches(node, selector)) out.push(node);
    queryAll(node, selector, out);
  }
  return out;
}
function DomEvent(type, init) { this.type = type; if (init) Object.assign(this, init); }
function DomCustomEvent(type, init) { DomEvent.call(this, type, init); this.detail = init && init.detail; }
const storage = new Map();
global.window = globalThis;
global.Event = DomEvent;
global.CustomEvent = DomCustomEvent;
global.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(String(key), String(value)); },
};
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.document = {
  getElementById,
  createElement,
  createTextNode(text) { return { textContent: String(text), nodeType: 3 }; },
  querySelector: documentQuery,
  querySelectorAll: documentQueryAll,
  addEventListener() {},
  removeEventListener() {},
  fonts: { check: () => true, add() {}, load: () => Promise.resolve([]), ready: Promise.resolve() },
  readyState: 'complete',
  hidden: false,
};
global.document.documentElement = createElement('html');
global.document.head = createElement('head');
global.document.body = createElement('body');
const vm = require('node:vm');
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js').sort()) {
  const filename = path.join(root, 'src', name);
  vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

assert.equal(J.captionWorkbench.store.project.style.editor, 'simple');
assert.equal(document.getElementById('captionModeEasy').getAttribute('aria-pressed'), 'true');
assert.equal(document.getElementById('captionModePro').getAttribute('aria-pressed'), 'false');
assert.equal(document.getElementById('captionTechniqueHost').hidden, true);

// Video settings: a shape tile commits one undoable command at once (no draft / Apply step).
{
  const host = document.getElementById('captionVideoEditor'), wb = J.captionWorkbench;
  assert.equal(fs.readFileSync(path.join(root, 'src', '12a_video_edit_ui.js'), 'utf8').includes('data-action="apply"'), false, 'the Apply button is gone');
  const tiles = host.querySelector('[data-edit="shapes"]').children;
  assert.equal(tiles.length, 4, 'four output shapes (9:16, 4:5, 1:1, 16:9)');
  const before = wb.store.serialize();
  tiles[3].onclick();
  assert.equal(wb.store.project.settings.videoEdit.format, 'youtube');
  assert.equal(host.querySelector('[data-edit="shapes"]').children[3].getAttribute('aria-checked'), 'true');
  wb.store.undo(); assert.equal(wb.store.serialize(), before, 'one undo step restores the project');
}

function domText(node) {
  if (!node) return '';
  if (node.children && node.children.length) return node.children.map(domText).join('');
  return typeof node.textContent === 'string' ? node.textContent : '';
}

(async () => {
  document.getElementById('captionModePro').dispatchEvent(new Event('click'));
  assert.equal(document.getElementById('captionModePro').getAttribute('aria-pressed'), 'true');
  assert.equal(document.getElementById('captionModeEasy').getAttribute('aria-pressed'), 'false');
  assert.equal(document.getElementById('videoCaptionsWorkspace').classList.contains('is-easy'), false);
  assert.equal(document.getElementById('captionTechniqueHost').hidden, true, 'the advanced editor no longer shows the per-technique checklist');
  assert.equal(J.captionWorkbench.store.project.style.editor, 'advanced');
  for (const id of ['captionStyle', 'captionIntensity', 'captionMotion', 'captionDensity', 'captionAlignment', 'captionAccent', 'captionWritingMode', 'captionEmphasisStrength']) {
    const control = document.getElementById(id);
    assert.notEqual(control, null);
    assert.equal(control.hidden, false);
  }
  // Advanced Effects tab: a chip per stage, and the picker offers every effect of the group (not the caption-safe subset) with an example card each.
  const chips = document.querySelectorAll('.caption-look-chip');
  assert.deepStrictEqual(chips.map(chip => chip.dataset.stage), ['layout', 'enter', 'hold', 'exit', 'active', 'treat']);
  const enterChip = chips.find(chip => chip.dataset.stage === 'enter');
  enterChip.dispatchEvent(new Event('click'));
  assert.equal(document.getElementById('captionLookPick').hidden, false, 'clicking a chip opens its picker');
  const cards = document.getElementById('captionLookPickGrid').querySelectorAll('canvas');
  assert.ok(cards.length > 100, `advanced entrance picker lists ${cards.length} effects`);
  assert.ok(cards.some(card => card.dataset.k === 'pop'), 'advanced picker offers the Lyric Motion entrances');
  const lyric = { enabled: { enter: { pop: true } } };
  const lyricBefore = JSON.stringify(lyric);
  J.captionWorkbench.store.execute({ type: 'set-technique', set: 'extra', value: true });
  assert.equal(J.captionWorkbench.store.project.techniques.extra, true);
  assert.equal(J.captionWorkbench.store.project.enabled, undefined);
  assert.equal(J.captionWorkbench.store.project.extra, undefined);
  assert.equal(JSON.stringify(lyric), lyricBefore);
  J.captionWorkbench.store.undo();
  assert.equal(J.captionTechniques(J.captionWorkbench.store.project).extra, false);
  assert.equal(J.captionWorkbench.store.project.techniques, undefined);
  const saved = JSON.parse(JSON.stringify(J.captionWorkbench.store.project));
  delete saved.style.editor;
  const projectFile = document.getElementById('captionProjectFile');
  projectFile.files = [{ name: 'omit.json', text: () => Promise.resolve(JSON.stringify(saved)) }];
  projectFile.dispatchEvent(new Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(document.getElementById('captionModeEasy').getAttribute('aria-pressed'), 'true');
  assert.equal(document.getElementById('captionTechniqueHost').hidden, true);
  assert.equal(J.captionWorkbench.store.project.style.editor, undefined);

  const transcript = J.importWordJson(fs.readFileSync(path.join(root, 'dev', 'fixtures', 'captions', 'word-timestamps.json'), 'utf8'), { duration: 15 });
  const lockedLayout = 'captionBottomStack';
  const captionProject = {
    schemaVersion: 2, generatorVersion: 'caption-mvp-1', mode: 'video-captions', id: 'project_style_techniques',
    media: { duration: 15, width: 1080, height: 1920 }, transcript,
    segments: [
      { id: 'segment_000001', tokenIds: transcript.tokens.slice(0, 5).map(token => token.id), start: 0.4, end: 2.25, boundarySource: 'planner', boundaryReasons: [], locks: { segmentation: false, visualPlan: false, fields: [] } },
      { id: 'segment_000002', tokenIds: transcript.tokens.slice(5, 9).map(token => token.id), start: 3.4, end: 4.7, boundarySource: 'planner', boundaryReasons: [], locks: { segmentation: true, visualPlan: true, fields: [] } },
    ],
    plans: {
      segment_000001: { id: 'plan_segment_000001', segmentId: 'segment_000001', generated: { layout: 'captionBottomStack', seed: 10 }, manual: {}, lockedFields: [] },
      segment_000002: { id: 'plan_segment_000002', segmentId: 'segment_000002', generated: { layout: lockedLayout, seed: 20 }, manual: {}, lockedFields: [] },
    },
    safeZones: [], seed: 77, style: { preset: 'creator', editor: 'advanced' }, settings: {},
    createdAt: '2026-09-27T00:00:00.000Z', updatedAt: '2026-09-27T00:00:00.000Z',
  };
  projectFile.files = [{ name: 'techniques.json', text: () => Promise.resolve(JSON.stringify(captionProject)) }];
  projectFile.dispatchEvent(new Event('change'));
  await new Promise(resolve => setImmediate(resolve));
  const store = J.captionWorkbench.store;
  assert.equal(store.project.segments.length, 2);
  const pool = JSON.parse(JSON.stringify(store.project));
  pool.techniques = { enabled: { layout: { knSlamStack: true } } };
  const planned = J.planCaptions(pool, pool.media);
  for (const stored of Object.values(planned.plans)) {
    const generated = stored.generated || {};
    assert.notEqual(generated.layout, 'knSlamStack');
    assert.notEqual(generated.entrance, 'knSlamStack');
    assert.notEqual(generated.hold, 'knSlamStack');
    assert.notEqual(generated.exit, 'knSlamStack');
  }
  assert.equal(store.project.techniques, undefined);

  document.getElementById('captionModePro').dispatchEvent(new Event('click'));
  assert.equal(store.project.style.editor, 'advanced');
  assert.equal(store.project.plans.segment_000002.generated.layout, lockedLayout);
  store.project.plans.segment_000001.generated.layout = 'SENTINEL_LAYOUT';
  assert.equal(J.captionTechniqueOn(store.project, 'enter', 'captionFade'), true);
  const history = store.undoStack.length;
  store.execute({ type: 'set-technique', group: 'enter', entries: { captionFade: false } });   // an explicit off still wins over "everything is on"
  assert.equal(store.undoStack.length, history + 1);
  assert.equal(store.project.techniques.enabled.enter.captionFade, false);
  assert.notEqual(store.project.plans.segment_000001.generated.layout, 'SENTINEL_LAYOUT');
  assert.equal(store.project.plans.segment_000002.generated.layout, lockedLayout);
  const step = store.undoStack[store.undoStack.length - 1];
  assert.equal(step.command.group, 'enter');
  assert.equal(step.before.plans.segment_000001.generated.layout, 'SENTINEL_LAYOUT');
  assert.notEqual(step.after.plans.segment_000001.generated.layout, 'SENTINEL_LAYOUT');
  assert.equal(store.undo(), true);
  assert.equal(store.project.plans.segment_000001.generated.layout, 'SENTINEL_LAYOUT');
  assert.equal(store.project.techniques && store.project.techniques.enabled && store.project.techniques.enabled.enter && store.project.techniques.enabled.enter.captionFade, undefined);
  document.getElementById('captionAlignment').dispatchEvent(new Event('change'));
  for (const key of ['layout', 'decor', 'bg', 'cam', 'fx', 'trans']) assert.equal(J.CAPTION_TECHNIQUE_DRAW[key], false, key);
  for (const key of ['enter', 'hold', 'exit', 'treat']) assert.equal(J.CAPTION_TECHNIQUE_DRAW[key], true, key);
  const source = require('./caption_ui_source').workbenchSource(root);
  assert.match(source, /layout: false, enter: true, hold: true, exit: true/);
  assert.equal(source.includes('renderTech'), false);
  console.log('Gate 5.4 style, variation, and lock tests passed.');
})().catch(error => { console.error(error); process.exitCode = 1; });
