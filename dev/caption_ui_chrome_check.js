/* Rework plan T3: the timeline drag check in real Google Chrome, with real mouse and key events (DevTools Input domain).

   node caption_ui_chrome_check.js [--chrome PATH] [--headed] [--shots DIR]

   1. Serves the repository on 127.0.0.1 (build first: python build.py).
   2. Launches Chrome with a fresh profile, opens the built app, imports the 15 s portrait fixture and the word-timestamps JSON.
   3. Drives the timeline with the mouse: move, edge trim (word stop, Shift = fit), stop at a neighbour, move to another track (free and
      refused), Esc cancel, locked caption, the `.` nudge key, undo. Each step reads the project from the store.
   Needs: Node 22+ (global WebSocket), Google Chrome, generated fixture portrait-15s-30fps-av.mp4 (fixtures/media/generate.ps1). */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : fallback; };
const flag = name => process.argv.includes(name);
const CHROME = arg('--chrome', process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const SHOTS = arg('--shots', null);
const VIDEO = '/dev/fixtures/media/generated/portrait-15s-30fps-av.mp4', TRANSCRIPT = '/dev/fixtures/captions/word-timestamps.json';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'), file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    const size = fs.statSync(file).size, range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    const headers = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    if (range) {   // <video> asks for byte ranges
      const start = range[1] ? Number(range[1]) : 0, end = range[2] ? Number(range[2]) : size - 1;
      res.writeHead(206, Object.assign(headers, { 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 })); fs.createReadStream(file, { start, end }).pipe(res); return;
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': size })); fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}
async function getJson(url, tries = 100) {
  for (let i = 0; i < tries; i++) { try { const res = await fetch(url); if (res.ok) return await res.json(); } catch (_) { /* not up yet */ } await sleep(100); }
  throw new Error(`No answer from ${url}`);
}
function cdp(wsUrl, log) {
  const ws = new WebSocket(wsUrl), pending = new Map(); let next = 1;
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }
    else if (message.method === 'Runtime.exceptionThrown') log.push(`exception: ${message.params.exceptionDetails.exception && message.params.exceptionDetails.exception.description || message.params.exceptionDetails.text}`);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') log.push(`console.error: ${message.params.args.map(a => a.value || a.description).join(' ')}`);
  };
  const ready = new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const send = (method, params = {}) => new Promise((resolve, reject) => { const id = next++; pending.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception && result.exceptionDetails.exception.description || result.exceptionDetails.text);
    return result.result.value;
  };
  return { ready, send, evaluate, close: () => ws.close() };
}

/* ---- helpers that run in the page ---- */
const IN_PAGE = `(() => {
  const ui = J.captionWorkbench, $ = id => document.getElementById(id);
  const until = async (test, ms, what) => { const end = Date.now() + ms; while (!test()) { if (Date.now() > end) throw new Error('Timed out waiting for ' + what + ' (' + $('captionStatus').textContent + ')'); await new Promise(r => setTimeout(r, 50)); } };
  const setFile = async (id, url, type) => { const blob = await fetch(url).then(r => r.blob()), dt = new DataTransfer(); dt.items.add(new File([blob], url.split('/').pop(), { type })); $(id).files = dt.files; $(id).dispatchEvent(new Event('change', { bubbles: true })); };
  window.__t = {
    async setup(video, transcript) {
      $('productVideoCaptions').click(); $('captionNew').click();
      await setFile('captionVideoFile', video, 'video/mp4'); await until(() => ui.media && ui.media.current && ui.store.project.media.duration > 0, 30000, 'the video import');
      await setFile('captionTranscriptFile', transcript, 'application/json'); await until(() => ui.store.project.segments.length > 0, 60000, 'the transcript import');
      const run = c => ui.store.execute(c);
      run({ type: 'add-track', trackId: 'track_2', name: 'Two' }); run({ type: 'add-track', trackId: 'track_3', name: 'Three' });
      run({ type: 'create-text-block', segmentId: 'blockA', text: 'Alpha', start: 1, end: 3, trackId: 'track_2' });
      run({ type: 'create-text-block', segmentId: 'blockB', text: 'Bravo', start: 4, end: 6, trackId: 'track_2' });
      run({ type: 'create-text-block', segmentId: 'blockR', text: 'Romeo', start: 0.5, end: 3.5, trackId: 'track_3' });
      ui.store.undoStack.length = 0; J.captionWb.emit('project');
      return { segments: ui.store.project.segments.map(s => ({ id: s.id, start: s.start, end: s.end, trackId: s.trackId, tokens: s.tokenIds.length })), duration: ui.store.project.media.duration };
    },
    snapshot() { const p = ui.store.project; return JSON.stringify({ segments: p.segments, tokens: p.transcript.tokens, plans: p.plans }); },
    seg(id) { const s = ui.store.project.segments.find(item => item.id === id); return s && { id: s.id, start: s.start, end: s.end, trackId: s.trackId, tokenIds: s.tokenIds }; },
    tokens(id) { const s = ui.store.project.segments.find(item => item.id === id), map = new Map(ui.store.project.transcript.tokens.map(t => [t.id, t])); return s.tokenIds.map(t => { const k = map.get(t); return { id: k.id, start: k.start, end: k.end, q: k.timingQuality }; }); },
    rect(selector) { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; },
    rowY(trackId) { const el = document.querySelector('.caption-track-row[data-track-id="' + trackId + '"]'), r = el.getBoundingClientRect(); return r.top + r.height / 2; },
    pps() { return ui.timeline.pps; }, undo() { return ui.store.undo(); }, depth() { return ui.store.undoStack.length; },
    ghost() { const g = document.querySelector('.caption-drag-ghost'); return g && { invalid: g.classList.contains('is-invalid'), reason: g.dataset.reason, left: g.style.left, width: g.style.width }; },
    ghostCount() { return document.querySelectorAll('.caption-drag-ghost,.caption-drag-snap,.caption-drag-readout').length; },
    ghostDump() { return [...document.querySelectorAll('.caption-drag-ghost,.caption-drag-snap,.caption-drag-readout')].map(n => n.className + ':' + n.parentNode.id).join(','); },
    snapLine() { const l = document.querySelector('.caption-drag-snap'); return l && !l.hidden ? l.dataset.kind : null; },
    readout() { const r = document.querySelector('.caption-drag-readout'); return r && r.textContent; },
    edges(id) { return ui.store.project.segments.filter(s => s.id !== id).flatMap(s => [s.start, s.end]).concat([0, ui.store.project.media.duration]); },
    select(id) { ui.selectedId = id; },
    emitSelection() { J.captionWb.emit('selection'); return true; },
    activeTool() { return document.activeElement && document.activeElement.dataset && document.activeElement.dataset.tool; },
    waveDrawn() { const c = document.getElementById('captionWaveform'), ctx = c.getContext('2d'), d = ctx.getImageData(0, 0, c.width, c.height).data; let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i]) n++; return { drawn: c.dataset.drawn, painted: n }; },
    setSnap(on) { if (ui.transport.snap !== on) $('captionSnap').click(); },
    lockTiming(id) { ui.store.execute({ type: 'set-field-lock', segmentId: id, field: 'timing', locked: true }); J.captionWb.emit('project'); ui.store.undoStack.length = 0; },
    unlockTiming(id) { ui.store.execute({ type: 'set-field-lock', segmentId: id, field: 'timing', locked: false }); J.captionWb.emit('project'); ui.store.undoStack.length = 0; return true; },
    lockBadge(id) { const b = document.querySelector('[data-segment-id="' + id + '"] .caption-lock-badge'); return !!b && !b.hidden; },
    status() { return $('captionStatus').textContent; },
    order() { return ui.store.project.tracks.map(item => item.id).join(','); },
    names() { return ui.store.project.tracks.map(item => item.name).join(','); },
    menuItems() { return [...document.querySelectorAll('.caption-menu [role=menuitem]')].map(b => b.textContent + (b.disabled ? '(off)' : '')); },
    addVisible() { return !$('captionTrackAddInline').hidden; },
    removeTrack(id) { ui.store.execute({ type: 'remove-track', trackId: id }); J.captionWb.emit('project'); },
    errors() { return JSON.stringify(ui.errors); },
    count() { return ui.store.project.segments.length; },
    sel() { return JSON.stringify([...ui.selection.segmentIds].sort()); },
    undo2() { const ok = ui.store.undo(); J.captionWb.emit('project'); return ok; },
    syncState() { const p = document.getElementById('captionSyncPanel'), v = ui.media.current.video; return { panel: !!p && !p.hidden, speed: ui.transport.speed, paused: v.paused, next: p ? document.getElementById('captionSyncNext').textContent : '' }; },
    syncStart() { return J.captionWb.syncStart(); },
    syncWordsStart() { return J.captionWb.syncWordsStart(); },
    editText(id, text) { ui.store.execute({ type: 'edit-segment-text', segmentId: id, text }); J.captionWb.emit('project'); return true; },
    loopState() { return { on: ui.transport.loopOn, region: ui.transport.region }; },
    seek(time) { J.captionWb.seekTimeline(time); return true; },
    playhead() { return ui.media.current.video.currentTime; },
    focusId() { return document.activeElement && document.activeElement.id; },
    blur() { if (document.activeElement) document.activeElement.blur(); return true; },
    timeX(time) { return document.getElementById('captionTimelineContent').getBoundingClientRect().left + time * ui.timeline.pps; },
    newer(known) { return ui.store.project.segments.filter(item => !known.includes(item.id)).map(item => ({ id: item.id, start: item.start, end: item.end, trackId: item.trackId, text: item.tokenIds.length })); },
    ids() { return ui.store.project.segments.map(item => item.id); },
    marquee() { return !!document.querySelector('.caption-marquee'); },
    toolbar() { const tb = document.getElementById('captionToolbar'); if (!tb || tb.hidden) return null; const r = tb.getBoundingClientRect(), f = document.getElementById('captionPreviewFrame').getBoundingClientRect(); return { r: [r.left, r.top, r.right, r.bottom].map(Math.round), f: [f.left, f.top, f.right, f.bottom].map(Math.round), inside: r.left >= f.left && r.right <= f.right && r.top >= f.top && r.bottom <= f.bottom, buttons: [...tb.querySelectorAll('[data-tool]')].filter(b => !b.hidden).map(b => b.dataset.tool).join(',') }; },
    toast() { const el = document.querySelector('.caption-toast'); return el && { text: el.textContent, action: !!el.querySelector('button') }; },
    toolRect(key) { const b = document.querySelector('[data-tool=' + key + ']'); const r = b.getBoundingClientRect(); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; },
    edit() { const pop = document.querySelector('.caption-edit-popover'), f = document.getElementById('captionEditText'); return { open: !!pop && !pop.hidden, focus: document.activeElement && document.activeElement.id, value: f.value, details: document.getElementById('captionDetails').open, chips: document.querySelectorAll('#captionTokenList [data-word-id]').length, cuts: document.querySelectorAll('#captionTokenList [data-split-before]').length, wordEditor: !document.getElementById('captionWordEditor').hidden, inViewport: !!pop && pop.getBoundingClientRect().bottom <= innerHeight && pop.getBoundingClientRect().right <= innerWidth }; },
    textOf(id) { const s = ui.store.project.segments.find(item => item.id === id); const map = new Map(ui.store.project.transcript.tokens.map(token => [token.id, token])); return s.tokenIds.map(tid => map.get(tid).text).join(' '); },
    warnBadge(id) { const b = document.querySelector('[data-segment-id="' + id + '"] .caption-warn-badge'); return !!b && !b.hidden; },
  };
  return true;
})()`;

(async () => {
  const video = path.join(root, VIDEO.slice(1));
  if (!fs.existsSync(video)) throw new Error('Missing fixture portrait-15s-30fps-av.mp4: run dev/fixtures/media/generate.ps1');
  if (!fs.existsSync(path.join(root, 'index.html'))) throw new Error('Run python build.py first.');
  const server = await startServer(), port = server.address().port, log = [];
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jizura-ui-')), debugPort = 9800 + Math.floor(Math.random() * 400);
  const chrome = spawn(CHROME, [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--window-size=1500,1000', ...(flag('--headed') ? [] : ['--headless=new']), 'about:blank'], { stdio: 'ignore' });
  let client, passed = 0;
  const step = (name, ok, detail) => { if (!ok) throw new Error(`${name}${detail ? ` — ${detail}` : ''}`); passed++; console.log(`  ok  ${name}`); };
  try {
    await getJson(`http://127.0.0.1:${debugPort}/json/version`);
    const page = (await getJson(`http://127.0.0.1:${debugPort}/json/list`)).find(target => target.type === 'page');
    client = cdp(page.webSocketDebuggerUrl, log); await client.ready;
    await client.send('Runtime.enable'); await client.send('Page.enable');
    await client.send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
    await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    for (let i = 0; i < 300; i++) { if (await client.evaluate('document.readyState === "complete" && !!(window.J && J.captionWorkbench)').catch(() => false)) break; await sleep(100); }
    await client.evaluate(IN_PAGE);
    const t = (fn, ...args) => client.evaluate(`window.__t.${fn}(${args.map(a => JSON.stringify(a)).join(',')})`);
    const mouse = (type, x, y, extra = {}) => client.send('Input.dispatchMouseEvent', Object.assign({ type, x, y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 }, extra));
    const key = async (name, code, extra = {}) => { await client.send('Input.dispatchKeyEvent', Object.assign({ type: 'keyDown', key: name, code, windowsVirtualKeyCode: extra.vk || 0, text: extra.text }, extra)); await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code, windowsVirtualKeyCode: extra.vk || 0 }); };
    const shot = async name => { if (!SHOTS) return; fs.mkdirSync(SHOTS, { recursive: true }); const { data } = await client.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(data, 'base64')); };
    /* A drag with real events: down on (x, y), moves in steps, optional hold before release. */
    const drag = async (from, to, { modifiers = 0, release = true } = {}) => {
      await mouse('mouseMoved', from.x, from.y); await mouse('mousePressed', from.x, from.y, { modifiers });
      for (let i = 1; i <= 8; i++) await mouse('mouseMoved', from.x + (to.x - from.x) * i / 8, from.y + (to.y - from.y) * i / 8, { modifiers });
      if (release) { await mouse('mouseReleased', to.x, to.y, { modifiers }); await sleep(80); }
    };
    const center = async id => { const r = await t('rect', `#captionSegmentTrack [data-segment-id="${id}"]`); return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2, r }; };
    const edge = async (id, which) => { const r = await t('rect', `#captionSegmentTrack [data-segment-id="${id}"]`); return { x: which === 'end' ? r.right - 3 : r.left + 3, y: (r.top + r.bottom) / 2 }; };
    const near = (a, b, tol, what) => step(what, Math.abs(a - b) <= tol, `${a} vs ${b}`);

    console.log('Importing the fixture …');
    const setup = await t('setup', VIDEO, TRANSCRIPT);
    const pps = await t('pps'); await t('setSnap', false);
    const first = setup.segments.find(s => s.id !== 'blockA' && s.trackId !== 'track_2' && s.trackId !== 'track_3');
    step('timeline shows blocks for every caption', (await t('rect', '#captionSegmentTrack [data-segment-id="blockA"]')).width > 20);
    await shot('01-loaded');

    // 1. move a block by +1 s (snapping off): same length, lands within a pixel of the target
    const base = await t('snapshot'); let c = await center('blockA');
    await drag(c, { x: c.x + pps, y: c.y });
    let a = await t('seg', 'blockA'); near(a.start, 2, 1.5 / pps, 'move: start follows the pointer'); near(a.end - a.start, 2, 1e-6, 'move: length unchanged');
    step('move: one undo step', (await t('depth')) === 1); await t('undo'); step('move: undo restores everything', (await t('snapshot')) === base);

    // 2. the live ghost, snap line and readout exist during the drag and are gone after it
    c = await center('blockA'); await drag(c, { x: c.x + pps * .5, y: c.y }, { release: false });
    const ghost = await t('ghost'); step('drag: ghost shown', !!ghost && !ghost.invalid); step('drag: time readout shown', /\d\d:\d\d\.\d\d–/.test(await t('readout')));
    await shot('02-dragging');
    await mouse('mouseReleased', c.x + pps * .5, c.y); await sleep(80); step('drag: ghost, line and readout removed after drop', (await t('ghostCount')) === 0, await t('ghostDump')); await t('undo');

    // 3. no pushing: dragging into the neighbour stops edge to edge on the same track
    c = await center('blockA'); await drag(c, { x: c.x + pps * 5, y: c.y });
    a = await t('seg', 'blockA'); near(a.end, 4, 1e-6, 'neighbour: stops edge to edge'); step('neighbour: the other caption did not move', (await t('seg', 'blockB')).start === 4); await t('undo');

    // 4. Esc cancels the drag with no command and no leftovers
    const before = await t('snapshot'), depth = await t('depth'); c = await center('blockA');
    await drag(c, { x: c.x + pps, y: c.y }, { release: false }); step('esc: drag is live', (await t('ghostCount')) > 0);
    await key('Escape', 'Escape', { vk: 27 }); await mouse('mouseReleased', c.x + pps, c.y); await sleep(80);
    step('esc: nothing left on screen', (await t('ghostCount')) === 0); step('esc: project untouched', (await t('snapshot')) === before && (await t('depth')) === depth);

    // 5. another track: refused where the space is taken (red ghost with the reason), allowed where it is free
    c = await center('blockA'); const rowThree = await t('rowY', 'track_3');
    await drag(c, { x: c.x, y: rowThree }, { release: false });
    const refused = await t('ghost'); step('track: taken space shows a red ghost with a reason', refused.invalid && /重なります/.test(refused.reason), JSON.stringify(refused)); await shot('03-refused');
    await mouse('mouseReleased', c.x, rowThree); await sleep(80);
    step('track: refused drop changes nothing', (await t('snapshot')) === before && /重なります/.test(await t('status')));
    c = await center('blockA'); await drag(c, { x: c.x + pps * 7, y: rowThree });
    a = await t('seg', 'blockA'); step('track: free drop moves to the other row', a.trackId === 'track_3' && Math.abs(a.start - 8) < 1.5 / pps, JSON.stringify(a)); await t('undo');
    step('track: undo brings it back to its row', (await t('seg', 'blockA')).trackId === 'track_2');

    // 6. trim an end: words stop the edge, Shift fits them
    const spoken = first.id, words = await t('tokens', spoken), lastEnd = words[words.length - 1].end;
    let e = await edge(spoken, 'end'); await drag(e, { x: e.x - pps * 3, y: e.y });
    let s = await t('seg', spoken); near(s.end, lastEnd, 1e-6, 'trim: the edge stops at the last word'); step('trim: words untouched', JSON.stringify(await t('tokens', spoken)) === JSON.stringify(words)); await t('undo');
    e = await edge(spoken, 'end'); await drag(e, { x: e.x - pps * 3, y: e.y }, { modifiers: 8 });   // Shift
    s = await t('seg', spoken); const fitted = await t('tokens', spoken);
    step('trim: Shift fits the words into the new window', s.end < lastEnd - .2 && fitted.every(k => k.end <= s.end + 1e-6 && k.q === 'estimated'), JSON.stringify({ s, fitted: fitted.slice(-1) })); await t('undo');
    e = await edge('blockB', 'end'); await drag(e, { x: e.x + pps, y: e.y });
    a = await t('seg', 'blockB'); near(a.end, 7, 1.5 / pps, 'trim: a block grows its end'); near(a.start, 4, 1e-6, 'trim: start unchanged'); await t('undo');
    e = await edge('blockB', 'start'); await drag(e, { x: e.x - pps * 5, y: e.y });
    a = await t('seg', 'blockB'); near(a.start, 3, 1.5 / pps, 'trim: start grows left'); step('trim: the left caption is not pushed', (await t('seg', 'blockA')).end === 3 && a.start >= 3 - 1e-6); await t('undo');

    // 7. snapping: with snap on, the end lands exactly on another caption's edge when close
    await t('setSnap', true); c = await center('blockA'); await drag(c, { x: c.x + pps * 0.97, y: c.y }, { release: false });
    step('snap: a vertical line marks what it snapped to', (await t('snapLine')) !== null); await shot('04-snapped');
    await mouse('mouseReleased', c.x + pps * 0.97, c.y); await sleep(80); a = await t('seg', 'blockA');
    const edges = await t('edges', 'blockA'); step('snap: an edge lands exactly on another caption edge, length kept', edges.some(time => Math.abs(time - a.start) < 1e-6 || Math.abs(time - a.end) < 1e-6) && Math.abs(a.end - a.start - 2) < 1e-6, JSON.stringify(a)); await t('undo');
    await t('setSnap', false);

    // 8. a timing-locked caption shows a lock badge and does not drag
    await t('lockTiming', 'blockB'); step('lock: badge visible', await t('lockBadge', 'blockB'));
    const lockedBase = await t('snapshot'); c = await center('blockB'); await drag(c, { x: c.x + pps, y: c.y });
    step('lock: drag does nothing', (await t('snapshot')) === lockedBase && (await t('ghostCount')) === 0);

    // 9. keys: `.` and `,` nudge the selected caption by 0.05 s; Esc handling does not break them
    await t('select', 'blockA'); c = await center('blockA'); await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await mouse('mouseReleased', c.x, c.y);   // click selects and focuses
    await key('.', 'Period', { text: '.', vk: 190 }); a = await t('seg', 'blockA'); near(a.start, 1.05, 1e-6, 'nudge: . moves later by 0.05 s');
    await key(',', 'Comma', { text: ',', vk: 188 }); await key(',', 'Comma', { text: ',', vk: 188 }); a = await t('seg', 'blockA'); near(a.start, .95, 1e-6, 'nudge: , moves earlier'); near(a.end - a.start, 2, 1e-6, 'nudge: length unchanged');

    // 10. tracks (T4): Alt+arrows retrack the selected caption, headers rename / reorder / menu, + track
    await t('select', 'blockB'); c = await center('blockB'); await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await mouse('mouseReleased', c.x, c.y);
    const depth10 = await t('depth');
    await key('ArrowDown', 'ArrowDown', { vk: 40, modifiers: 1 }); a = await t('seg', 'blockB');
    step('alt+down: the caption moves to the track below, same time', a.trackId === 'track_3' && Math.abs(a.start - 4) < 1e-6 && Math.abs(a.end - 6) < 1e-6, JSON.stringify(a) + ' ' + await t('status'));
    step('alt+down: it is one undo step', (await t('depth')) === depth10 + 1);
    await key('ArrowDown', 'ArrowDown', { vk: 40, modifiers: 1 }); step('alt+down at the last track says so and changes nothing', (await t('seg', 'blockB')).trackId === 'track_3' && /下のトラック/.test(await t('status')));
    await key('ArrowUp', 'ArrowUp', { vk: 38, modifiers: 1 }); step('alt+up: back to the track above', (await t('seg', 'blockB')).trackId === 'track_2');
    await t('select', 'blockA'); const refusedBase = await t('snapshot');
    await key('ArrowDown', 'ArrowDown', { vk: 40, modifiers: 1 }); step('alt+down onto a taken slot is refused', (await t('snapshot')) === refusedBase && /重なります/.test(await t('status')));

    let name = await t('rect', '[data-track-head="track_3"] [data-track-select]'); const names0 = await t('names');
    await mouse('mouseMoved', name.left + 8, (name.top + name.bottom) / 2); await mouse('mousePressed', name.left + 8, (name.top + name.bottom) / 2, { clickCount: 2 }); await mouse('mouseReleased', name.left + 8, (name.top + name.bottom) / 2, { clickCount: 2 });
    await sleep(80); step('rename: double-click opens an inline field', (await t('rect', '.caption-track-rename')) !== null);
    await client.send('Input.insertText', { text: 'Zed' }); await key('Enter', 'Enter', { vk: 13, text: '\r' }); await sleep(80);
    step('rename: Enter commits the name', /,Zed$/.test(await t('names')) && (await t('rect', '.caption-track-rename')) === null, await t('names'));
    await t('undo'); step('rename: undo restores it', (await t('names')) === names0);
    name = await t('rect', '[data-track-head="track_3"] [data-track-select]');
    await mouse('mousePressed', name.left + 8, (name.top + name.bottom) / 2, { clickCount: 2 }); await mouse('mouseReleased', name.left + 8, (name.top + name.bottom) / 2, { clickCount: 2 }); await sleep(80);
    await client.send('Input.insertText', { text: 'Nope' }); await key('Escape', 'Escape', { vk: 27 }); await sleep(80);
    step('rename: Esc cancels without a command', (await t('names')) === names0 && (await t('rect', '.caption-track-rename')) === null);

    const grip = await t('rect', '[data-track-head="track_3"] .caption-track-grip'), upper = await t('rect', '[data-track-head="track_2"]'), orderBefore = await t('order');
    await drag({ x: (grip.left + grip.right) / 2, y: (grip.top + grip.bottom) / 2 }, { x: (grip.left + grip.right) / 2, y: (upper.top + upper.bottom) / 2 - 2 }, { release: false });
    step('reorder: a drop line shows where the track lands', (await t('rect', '.caption-track-drop')) !== null); await shot('05-reorder');
    await key('Escape', 'Escape', { vk: 27 }); await mouse('mouseReleased', (grip.left + grip.right) / 2, (upper.top + upper.bottom) / 2); await sleep(80);
    step('reorder: Esc leaves the order alone', (await t('order')) === orderBefore && (await t('rect', '.caption-track-drop')) === null);
    await drag({ x: (grip.left + grip.right) / 2, y: (grip.top + grip.bottom) / 2 }, { x: (grip.left + grip.right) / 2, y: (upper.top + upper.bottom) / 2 - 2 });
    step('reorder: dropping the grip on the row above swaps them', (await t('order')) === 'track_main,track_3,track_2', await t('order'));
    await t('undo'); step('reorder: undo restores the order', (await t('order')) === orderBefore);
    const primaryGrip = await t('rect', '[data-track-head="track_main"] .caption-track-grip'); step('reorder: the primary track has no grip', primaryGrip === null || primaryGrip.width === 0 || (await client.evaluate('getComputedStyle(document.querySelector(\'[data-track-head="track_main"] .caption-track-grip\')).visibility')) === 'hidden');

    const more = await t('rect', '[data-track-head="track_2"] .caption-track-more'); await mouse('mouseMoved', (more.left + more.right) / 2, (more.top + more.bottom) / 2); await mouse('mousePressed', (more.left + more.right) / 2, (more.top + more.bottom) / 2); await mouse('mouseReleased', (more.left + more.right) / 2, (more.top + more.bottom) / 2); await sleep(80);
    const items = await t('menuItems'); step('menu: opens with rename / up / down / randomize / delete', items.length === 5 && /名前/.test(items[0]) && /削除/.test(items[4]), JSON.stringify(items)); await shot('06-track-menu');
    await key('Escape', 'Escape', { vk: 27 }); await sleep(50); step('menu: Esc closes it', (await t('menuItems')).length === 0);
    const moreMain = await t('rect', '[data-track-head="track_main"] .caption-track-more'); await mouse('mousePressed', (moreMain.left + moreMain.right) / 2, (moreMain.top + moreMain.bottom) / 2); await mouse('mouseReleased', (moreMain.left + moreMain.right) / 2, (moreMain.top + moreMain.bottom) / 2); await sleep(80);
    step('menu: the primary track cannot move or be deleted', (await t('menuItems')).filter(label => /\(off\)/.test(label)).length === 3, JSON.stringify(await t('menuItems')));
    await mouse('mousePressed', 700, 900); await mouse('mouseReleased', 700, 900); await sleep(50); step('menu: a click outside closes it', (await t('menuItems')).length === 0);

    step('+ track: hidden while three tracks exist', (await t('addVisible')) === false);
    await t('removeTrack', 'track_3'); step('+ track: shown again after a track is removed', (await t('addVisible')) === true);
    const add = await t('rect', '#captionTrackAddInline'); await mouse('mousePressed', (add.left + add.right) / 2, (add.top + add.bottom) / 2); await mouse('mouseReleased', (add.left + add.right) / 2, (add.top + add.bottom) / 2); await sleep(80);
    step('+ track: the button adds a track', (await t('order')).split(',').length === 3 && (await t('addVisible')) === false, await t('order'));

    // 11. create and multi-select (T5)
    const tolerance = 1.5 / pps, ids0 = await t('ids'), tracks11 = (await t('order')).split(','), trackTwo = 'track_2', trackNew = tracks11[2];
    await t('setSnap', false);
    // double-click on an empty part of a row: a 2 s block there, selected, text field focused for typing
    let rowY = await t('rowY', trackTwo), at = x => ({ x, y: rowY });
    let timeX = await t('timeX', 8); await mouse('mouseMoved', timeX, rowY);
    for (const count of [1, 2]) { await mouse('mousePressed', timeX, rowY, { clickCount: count }); await mouse('mouseReleased', timeX, rowY, { clickCount: count }); }
    await sleep(120); let made = await t('newer', ids0);
    step('create: double-click on an empty row makes a block', made.length === 1 && made[0].trackId === trackTwo && Math.abs(made[0].start - 8) <= tolerance && Math.abs(made[0].end - made[0].start - 2) < 1e-6, JSON.stringify(made));
    step('create: it is selected and its text field has focus', JSON.parse(await t('sel')).join() === made[0].id && (await t('focusId')) === 'captionEditText' && (await t('edit')).open, await t('focusId'));
    await t('undo2'); step('create: undo removes it', (await t('count')) === ids0.length); await t('blur');
    // drag on an empty part of a row: a block for exactly that range, with a ghost while dragging
    rowY = await t('rowY', trackNew); const from = await t('timeX', 2), to = await t('timeX', 5);
    await drag({ x: from, y: rowY }, { x: to, y: rowY }, { release: false });
    const ghost11 = await t('ghost'); step('create: dragging shows a ghost for the range', !!ghost11 && !ghost11.invalid && (await t('readout')) !== null, JSON.stringify(ghost11)); await shot('07-create-drag');
    await mouse('mouseReleased', to, rowY); await sleep(120); made = await t('newer', ids0);
    step('create: releasing makes the block on that row', made.length === 1 && made[0].trackId === trackNew && Math.abs(made[0].start - 2) <= tolerance && Math.abs(made[0].end - 5) <= tolerance && (await t('ghostCount')) === 0, JSON.stringify(made));
    await t('undo2'); await t('blur');
    // Esc during the drag creates nothing; a drag that is too short creates nothing; a drag starting inside a caption is a caption drag, not a create
    await drag({ x: from, y: rowY }, { x: to, y: rowY }, { release: false }); await key('Escape', 'Escape', { vk: 27 }); await mouse('mouseReleased', to, rowY); await sleep(80);
    step('create: Esc cancels the drag, nothing is made', (await t('count')) === ids0.length && (await t('ghostCount')) === 0);
    await drag({ x: from, y: rowY }, { x: from + 3, y: rowY }); step('create: a 3 px drag is just a click', (await t('count')) === ids0.length);
    // N: a block at the playhead on the active track
    await t('seek', 9); await sleep(300); await key('n', 'KeyN', { text: 'n', vk: 78 }); await sleep(120); made = await t('newer', ids0);
    step('N: a 2 s block at the playhead', made.length === 1 && Math.abs(made[0].start - (await t('playhead'))) < 1e-6 && Math.abs(made[0].end - made[0].start - 2) < 1e-6, JSON.stringify(made));
    await t('undo2'); await t('blur');

    // multi-select: click + Shift-click, then one drag moves both, as one undo step
    c = await center('blockA'); await mouse('mouseMoved', c.x, c.y); await mouse('mousePressed', c.x, c.y); await mouse('mouseReleased', c.x, c.y);
    let cb = await center('blockB'); await mouse('mousePressed', cb.x, cb.y, { modifiers: 8 }); await mouse('mouseReleased', cb.x, cb.y, { modifiers: 8 }); await sleep(60);
    step('select: Shift-click adds a caption to the selection', (await t('sel')) === JSON.stringify(['blockA', 'blockB']), await t('sel'));
    await mouse('mousePressed', cb.x, cb.y, { modifiers: 8 }); await mouse('mouseReleased', cb.x, cb.y, { modifiers: 8 }); await sleep(60);
    step('select: Shift-click on a selected caption removes it', (await t('sel')) === JSON.stringify(['blockA']), await t('sel'));
    await mouse('mousePressed', cb.x, cb.y, { modifiers: 8 }); await mouse('mouseReleased', cb.x, cb.y, { modifiers: 8 }); await sleep(60);
    const lockedGroup = await t('snapshot'); c = await center('blockA'); await drag(c, { x: c.x + pps * .5, y: c.y });
    step('group: a locked member stops the whole drag', (await t('snapshot')) === lockedGroup && /ロック/.test(await t('status')) && (await t('ghostCount')) === 0, await t('status'));
    await t('unlockTiming', 'blockB'); await mouse('mousePressed', cb.x, cb.y, { modifiers: 8 }); await mouse('mouseReleased', cb.x, cb.y, { modifiers: 8 }); await mouse('mousePressed', cb.x, cb.y, { modifiers: 8 }); await mouse('mouseReleased', cb.x, cb.y, { modifiers: 8 }); await sleep(60);
    step('group: both are selected again', (await t('sel')) === JSON.stringify(['blockA', 'blockB']), await t('sel'));
    const beforeGroup = { a: await t('seg', 'blockA'), b: await t('seg', 'blockB') }, depth11 = await t('depth'); c = await center('blockA');
    await drag(c, { x: c.x + pps * .5, y: c.y }, { release: false }); const groupGhosts = await client.evaluate('document.querySelectorAll(".caption-drag-ghost").length');
    step('group: dragging one member shows a ghost for each', groupGhosts === 2 && /^\+0\.\d\ds$/.test(await t('readout')), groupGhosts + ' ' + await t('readout'));
    await mouse('mouseReleased', c.x + pps * .5, c.y); await sleep(100);
    const afterGroup = { a: await t('seg', 'blockA'), b: await t('seg', 'blockB') };
    step('group: both moved by the same amount', Math.abs(afterGroup.a.start - beforeGroup.a.start - .5) <= tolerance && Math.abs((afterGroup.a.start - beforeGroup.a.start) - (afterGroup.b.start - beforeGroup.b.start)) < 1e-6, JSON.stringify(afterGroup));
    step('group: the selection survives the drag and it is one undo step', (await t('sel')) === JSON.stringify(['blockA', 'blockB']) && (await t('depth')) === depth11 + 1, await t('sel'));
    await t('undo2'); step('group: undo puts both back', JSON.stringify(await t('seg', 'blockA')) === JSON.stringify(beforeGroup.a) && JSON.stringify(await t('seg', 'blockB')) === JSON.stringify(beforeGroup.b));
    await key('.', 'Period', { text: '.', vk: 190 }); step('group: the nudge key moves the whole selection', Math.abs((await t('seg', 'blockA')).start - beforeGroup.a.start - .05) < 1e-6 && Math.abs((await t('seg', 'blockB')).start - beforeGroup.b.start - .05) < 1e-6); await t('undo2');

    // marquee: Shift + drag across a row selects what it touches; Esc cancels
    await key('Escape', 'Escape', { vk: 27 }); step('select: Esc clears the selection', (await t('sel')) === '[]', await t('sel'));
    rowY = await t('rowY', trackTwo);
    await drag({ x: await t('timeX', .3), y: rowY - 6 }, { x: await t('timeX', 6.8), y: rowY + 6 }, { modifiers: 8, release: false });
    step('marquee: a box is drawn while dragging', await t('marquee')); await shot('08-marquee');
    await mouse('mouseReleased', await t('timeX', 6.8), rowY + 6, { modifiers: 8 }); await sleep(80);
    step('marquee: releasing selects the captions it touched', (await t('sel')) === JSON.stringify(['blockA', 'blockB']) && !(await t('marquee')), await t('sel'));
    await key('Escape', 'Escape', { vk: 27 });
    await drag({ x: await t('timeX', .3), y: rowY - 6 }, { x: await t('timeX', 6.8), y: rowY + 6 }, { modifiers: 8, release: false }); await key('Escape', 'Escape', { vk: 27 });
    await mouse('mouseReleased', await t('timeX', 6.8), rowY + 6, { modifiers: 8 }); await sleep(80);
    step('marquee: Esc cancels it and selects nothing', !(await t('marquee')) && (await t('sel')) === '[]', await t('sel'));

    // right-click menu: duplicate a selection, split at the playhead, delete
    c = await center('blockA'); await mouse('mousePressed', c.x, c.y); await mouse('mouseReleased', c.x, c.y);
    cb = await center('blockB'); await mouse('mousePressed', cb.x, cb.y, { modifiers: 8 }); await mouse('mouseReleased', cb.x, cb.y, { modifiers: 8 });
    await mouse('mousePressed', c.x, c.y, { button: 'right', buttons: 2 }); await mouse('mouseReleased', c.x, c.y, { button: 'right', buttons: 0 }); await sleep(100);
    let menu = await t('menuItems'); step('menu: right-click on a selected caption opens the caption menu', menu.length === 5 && /2/.test(menu[3]) && /2/.test(menu[4]) && /\(off\)/.test(menu[0]), JSON.stringify(menu)); await shot('09-caption-menu');
    const dup = await t('rect', '.caption-menu .caption-menu-item:nth-child(4)'); await mouse('mousePressed', (dup.left + dup.right) / 2, (dup.top + dup.bottom) / 2); await mouse('mouseReleased', (dup.left + dup.right) / 2, (dup.top + dup.bottom) / 2); await sleep(120);
    made = await t('newer', ids0); step('menu: duplicate copies both captions and selects the copies', made.length === 2 && JSON.parse(await t('sel')).every(id => made.some(item => item.id === id)) && (await t('depth')) === depth11 + 1, JSON.stringify(made));
    await t('undo2'); step('menu: one undo removes both copies', (await t('count')) === ids0.length);
    const spoken11 = first.id, words11 = await t('tokens', spoken11), gap = (words11[1].end + words11[2].start) / 2;
    await t('select', spoken11); await t('seek', gap); await sleep(300); const playhead11 = await t('playhead');
    await key('s', 'KeyS', { text: 's', vk: 83 }); await sleep(120);
    step('S: splits the selected caption at the playhead', (await t('count')) === ids0.length + 1 && Math.abs((await t('seg', spoken11)).end - playhead11) < .06, `${await t('count')} ${JSON.stringify(await t('seg', spoken11))} ${playhead11}`);
    await t('undo2'); step('S: undo joins it again', (await t('count')) === ids0.length && JSON.stringify((await t('seg', spoken11)).end) === JSON.stringify(first.end));
    await t('select', 'blockB'); const countBefore = await t('count'); await key('Delete', 'Delete', { vk: 46 }); await sleep(100);
    step('Delete: removes the selected caption', (await t('count')) === countBefore - 1 && (await t('seg', 'blockB')) === undefined, await t('status'));
    await t('undo2'); step('Delete: undo brings it back', (await t('seg', 'blockB')) !== undefined && (await t('count')) === countBefore);
    await t('blur');

    // C1: floating toolbar, result toasts with Undo, shared menu helper
    await t('select', 'blockA'); await t('emitSelection'); await sleep(120);
    let bar = await t('toolbar'); step('toolbar: shown under the selected caption, inside the preview', !!bar && bar.inside && /text,split,start,end,look,more/.test(bar.buttons), JSON.stringify(bar)); await shot('10-toolbar');
    await key('Escape', 'Escape', { vk: 27 }); await sleep(100); step('toolbar: hidden when nothing is selected', (await t('toolbar')) === null);
    await t('select', 'blockB'); await t('emitSelection'); await key('Delete', 'Delete', { vk: 46 }); await sleep(100);
    let toast = await t('toast'); step('toast: deleting shows a message with an Undo button', !!toast && toast.action, JSON.stringify(toast));
    const undo = await t('rect', '.caption-toast-action'); await mouse('mousePressed', (undo.left + undo.right) / 2, (undo.top + undo.bottom) / 2); await mouse('mouseReleased', (undo.left + undo.right) / 2, (undo.top + undo.bottom) / 2); await sleep(100);
    step('toast: Undo brings the caption back and closes the toast', (await t('seg', 'blockB')) !== undefined && (await t('toast')) === null);
    await t('select', 'blockB'); await t('emitSelection'); await sleep(80); await key('Delete', 'Delete', { vk: 46 }); await sleep(80); await t('undo2'); await sleep(80);
    step('toast: any other project change closes it', (await t('toast')) === null);
    await t('select', first.id); await t('emitSelection'); await t('seek', gap); await sleep(250);
    const splitBtn = await t('toolRect', 'split'); await mouse('mousePressed', splitBtn.x, splitBtn.y); await mouse('mouseReleased', splitBtn.x, splitBtn.y); await sleep(120);
    step('toolbar: Split cuts at the playhead and offers Undo', (await t('count')) === ids0.length + 1 && !!(await t('toast')), `${await t('count')} ${JSON.stringify(await t('toast'))}`);
    await t('undo2'); await sleep(80); await t('select', 'blockA'); await t('emitSelection'); await sleep(100);
    const moreBtn = await t('toolRect', 'more'); await mouse('mousePressed', moreBtn.x, moreBtn.y); await mouse('mouseReleased', moreBtn.x, moreBtn.y); await sleep(100);
    menu = await t('menuItems'); step('toolbar: ⋯ opens a menu (merge, move, lock, delete)', menu.length >= 5 && /^(削除|Delete)$/.test(menu[menu.length - 1].replace('(off)', '')), JSON.stringify(menu));
    await key('Escape', 'Escape', { vk: 27 }); await sleep(80);
    step('toolbar: Esc closes the menu and returns focus to ⋯', (await t('menuItems')).length === 0 && (await t('activeTool')) === 'more', await t('activeTool'));
    await t('blur');

    // C2: text editing in place (popover from the toolbar, a double-click on the preview or timeline, Enter), word chips, details fold
    await t('select', 'blockA'); await t('emitSelection'); await sleep(100);
    const oldText = await t('textOf', 'blockA'), textBtn = await t('toolRect', 'text'); await mouse('mousePressed', textBtn.x, textBtn.y); await mouse('mouseReleased', textBtn.x, textBtn.y); await sleep(120);
    let ed = await t('edit'); step('edit: ✎ Text opens a popover with the text field focused and filled', ed.open && ed.focus === 'captionEditText' && ed.value === oldText && ed.inViewport && !ed.details, JSON.stringify(ed));
    await client.send('Input.insertText', { text: 'Edited in place' }); await key('Enter', 'Enter', { vk: 13, text: '\r' }); await sleep(120);
    step('edit: Enter commits the whole text and closes the popover', (await t('textOf', 'blockA')) === 'Edited in place' && !(await t('edit')).open, await t('textOf', 'blockA'));
    await t('undo2'); await sleep(60); step('edit: undo restores the text in one step', (await t('textOf', 'blockA')) === oldText);
    await t('select', 'blockA'); await t('emitSelection'); await sleep(80); await mouse('mousePressed', textBtn.x, textBtn.y); await mouse('mouseReleased', textBtn.x, textBtn.y); await sleep(100);
    await client.send('Input.insertText', { text: 'Dropped' }); await key('Escape', 'Escape', { vk: 27 }); await sleep(100);
    step('edit: Esc cancels (text unchanged) and returns focus to ✎', (await t('textOf', 'blockA')) === oldText && !(await t('edit')).open && (await t('activeTool')) === 'text', `${await t('textOf', 'blockA')} ${await t('activeTool')}`);
    await t('blur'); await key('Enter', 'Enter', { vk: 13, text: '\r' }); await sleep(120);
    step('edit: Enter on a selected caption opens the editor', (await t('edit')).open && (await t('edit')).focus === 'captionEditText');
    await key('Escape', 'Escape', { vk: 27 }); await sleep(80);
    const blockBox = await t('rect', '#captionSegmentTrack [data-segment-id="blockA"]'), bx = (blockBox.left + blockBox.right) / 2, by = (blockBox.top + blockBox.bottom) / 2;
    for (const count of [1, 2]) { await mouse('mousePressed', bx, by, { clickCount: count }); await mouse('mouseReleased', bx, by, { clickCount: count }); } await sleep(150);
    step('edit: double-click on a timeline block opens it in place', (await t('edit')).open && (await t('sel')) === JSON.stringify(['blockA']), JSON.stringify(await t('edit')));
    await key('Escape', 'Escape', { vk: 27 }); await sleep(80);
    const boxRect = await t('rect', '#captionBoxEditor'), px = (boxRect.left + boxRect.right) / 2, py = (boxRect.top + boxRect.bottom) / 2;
    for (const count of [1, 2]) { await mouse('mousePressed', px, py, { clickCount: count }); await mouse('mouseReleased', px, py, { clickCount: count }); } await sleep(150);
    step('edit: double-click on the caption in the preview opens it', (await t('edit')).open, JSON.stringify(await t('edit')));
    await key('Escape', 'Escape', { vk: 27 }); await sleep(80);
    await t('select', first.id); await t('emitSelection'); await sleep(100); await key('Enter', 'Enter', { vk: 13, text: '\r' }); await sleep(120);
    ed = await t('edit'); step('edit: a spoken caption shows its words as chips with ✂ between them', ed.open && ed.chips > 1 && ed.cuts === ed.chips - 1, JSON.stringify(ed));
    const chip = await t('rect', '#captionTokenList [data-word-id]'); await mouse('mousePressed', (chip.left + chip.right) / 2, (chip.top + chip.bottom) / 2); await mouse('mouseReleased', (chip.left + chip.right) / 2, (chip.top + chip.bottom) / 2); await sleep(100);
    step('edit: pressing a chip opens the word editor (text, emphasis)', (await t('edit')).wordEditor && (await t('edit')).open);
    const summary = await t('rect', '#captionDetails > summary'); await mouse('mousePressed', summary.left + 10, (summary.top + summary.bottom) / 2); await mouse('mouseReleased', summary.left + 10, (summary.top + summary.bottom) / 2); await sleep(100);
    step('edit: Details folds timing, track, look and locks (opens on demand, stays on screen)', (await t('edit')).details && (await t('edit')).inViewport && (await t('rect', '#captionSelectedStart')).width > 0, JSON.stringify(await t('edit')));
    await key('Escape', 'Escape', { vk: 27 }); await sleep(80); await key('Escape', 'Escape', { vk: 27 }); await sleep(80); await t('blur');

    // C3: one-press sync (I / O)
    {
      const before = await t('seg', first.id), words = await t('tokens', first.id), mid = (words[1].start + words[1].end) / 2, depth = await t('depth');
      await t('select', first.id); await t('emitSelection'); await t('seek', mid); await sleep(250); await key('i', 'KeyI', { text: 'i', vk: 73 }); await sleep(150);
      const after = await t('seg', first.id), toast3 = await t('toast');
      step('I: start goes to the playhead, words fitted, toast says so', after.start > before.start + .01 && Math.abs(after.start - mid) < .06 && (await t('depth')) === depth + 1 && !!toast3, JSON.stringify({ before, after, toast3 }));
      await t('undo2'); step('I: one undo restores the caption', JSON.stringify(await t('seg', first.id)) === JSON.stringify(before));
      await t('select', first.id); await t('emitSelection'); await t('seek', before.end + .05); await sleep(250); await key('o', 'KeyO', { text: 'o', vk: 79 }); await sleep(150);
      const grown3 = await t('seg', first.id); step('O: end goes to the playhead (or is refused by a neighbour)', Math.abs(grown3.end - (before.end + .05)) < .06 || grown3.end === before.end, JSON.stringify(grown3));
      await t('undo2'); await t('blur');
    }

    // C4: tap sync for captions (Space taps, Enter confirms, one undo, Esc discards)
    {
      const beforeA = await t('seg', 'blockA'), beforeB = await t('seg', 'blockB'), depth4 = await t('depth');
      await t('select', 'blockA'); await t('emitSelection'); await sleep(100);
      const syncBtn = await t('rect', '#captionSync'); await mouse('mousePressed', (syncBtn.left + syncBtn.right) / 2, (syncBtn.top + syncBtn.bottom) / 2); await mouse('mouseReleased', (syncBtn.left + syncBtn.right) / 2, (syncBtn.top + syncBtn.bottom) / 2); await sleep(300);
      const started = await t('syncState'); step('sync: the Sync button starts a pass (panel shown, 0.75x, playing, next caption named)', started.panel && started.speed === .75 && !started.paused && /Alpha|Bravo|Next|次/.test(started.next), JSON.stringify(started));
      const waitFor = async time => { for (let i = 0; i < 200 && (await t('playhead')) < time; i++) await sleep(50); };
      await waitFor(beforeA.start - .1); const t1 = await t('playhead'); await key(' ', 'Space', { text: ' ', vk: 32 }); await sleep(60);
      step('sync: Space taps (the video keeps playing, a ghost shows the new time, nothing committed yet)', (await t('ghostCount')) >= 1 && JSON.stringify(await t('seg', 'blockA')) === JSON.stringify(beforeA) && !(await t('syncState')).paused, JSON.stringify(await t('syncState')));
      await waitFor(beforeB.start - .1); const t2 = await t('playhead'); await key(' ', 'Space', { text: ' ', vk: 32 }); await sleep(60);
      await key('Enter', 'Enter', { vk: 13, text: String.fromCharCode(13) }); await sleep(200);
      const a = await t('seg', 'blockA'), b = await t('seg', 'blockB'), done = await t('syncState');
      step('sync: Enter commits both captions, offset subtracted, a tap ends where the next starts', !done.panel && Math.abs(a.start - (t1 - .12)) < .3 && Math.abs(a.end - b.start) < 1e-6 && Math.abs(b.start - (t2 - .12)) < .3 && Math.abs((b.end - b.start) - (beforeB.end - beforeB.start)) < 1e-6, JSON.stringify({ a, b, t1, t2 }));
      step('sync: the whole pass is one undo step, speed restored', (await t('depth')) === depth4 + 1 && done.speed === 1 && done.paused, JSON.stringify({ depth: await t('depth'), done }));
      await t('undo2'); step('sync: one undo restores both', JSON.stringify(await t('seg', 'blockA')) === JSON.stringify(beforeA) && JSON.stringify(await t('seg', 'blockB')) === JSON.stringify(beforeB));
      await t('select', 'blockA'); await t('emitSelection'); await sleep(100); await t('syncStart'); await sleep(200);
      await key(' ', 'Space', { text: ' ', vk: 32 }); await sleep(60); await key('Escape', 'Escape', { vk: 27 }); await sleep(150);
      step('sync: Esc discards the pass (nothing changed, panel and ghosts gone)', !(await t('syncState')).panel && JSON.stringify(await t('seg', 'blockA')) === JSON.stringify(beforeA) && (await t('depth')) === depth4 && (await t('ghostCount')) === 0, JSON.stringify(await t('syncState')));
      await t('blur');
    }

    // C5: tap sync for words (loop, Space taps word starts, Enter commits one retime, one undo)
    {
      await t('editText', 'blockA', 'Alpha Beta Gamma'); const depth5 = await t('depth'), segA = await t('seg', 'blockA'), words0 = await t('tokens', 'blockA');
      await t('select', 'blockA'); await t('emitSelection'); await sleep(100);
      await t('syncWordsStart'); await sleep(300);
      const ws = await t('syncState'), lp = await t('loopState'); step('word sync: starts looping the caption at 0.75x with the first word named', ws.panel && ws.speed === .75 && lp.on && lp.region.start <= segA.start && lp.region.end >= segA.end && /Alpha|Next|次/.test(ws.next), JSON.stringify({ ws, lp }));
      const waitFor5 = async time => { for (let i = 0; i < 200 && (await t('playhead')) < time; i++) await sleep(50); };
      const marks = [];
      for (const at of [segA.start + .2, segA.start + .8, segA.start + 1.4]) { await waitFor5(at); marks.push(await t('playhead')); await key(' ', 'Space', { text: ' ', vk: 32 }); await sleep(40); }
      await key('Enter', 'Enter', { vk: 13, text: String.fromCharCode(13) }); await sleep(250);
      const words1 = await t('tokens', 'blockA'), after = await t('syncState');
      step('word sync: Enter retimes the three words from the taps (offset subtracted), inside the caption', !after.panel && words1.length === 3 && Math.abs(words1[0].start - (marks[0] - .12)) < .3 && Math.abs(words1[1].start - (marks[1] - .12)) < .3 && Math.abs(words1[2].start - (marks[2] - .12)) < .3 && words1[0].end <= words1[1].start + 1e-6 && words1[2].end <= segA.end + 1e-6, JSON.stringify({ words1, marks, segA }));
      step('word sync: one undo step; speed and loop restored', (await t('depth')) === depth5 + 1 && after.speed === 1 && !(await t('loopState')).on, JSON.stringify({ depth: await t('depth'), after }));
      await t('undo2'); step('word sync: one undo restores the word times', JSON.stringify(await t('tokens', 'blockA')) === JSON.stringify(words0));
      await t('undo2'); await t('blur');
    }

    // T6: waveform behind the VIDEO row, resizable and collapsible strip
    let wave = { drawn: '0', painted: 0 }; for (let i = 0; i < 40 && wave.drawn !== '1'; i++) { await sleep(100); wave = await t('waveDrawn'); }
    step('waveform: drawn behind the VIDEO row from the decoded audio', wave.drawn === '1' && wave.painted > 200, JSON.stringify(wave));
    const stripH = (await t('rect', '#captionStrip')).height, gripBox = await t('rect', '#captionStripGrip'), gx = (gripBox.left + gripBox.right) / 2, gy = (gripBox.top + gripBox.bottom) / 2;
    await drag({ x: gx, y: gy }, { x: gx, y: gy - 60 }); await sleep(100);
    const grown = (await t('rect', '#captionStrip')).height; step('strip: dragging the top edge up makes it taller', grown > stripH + 40, `${stripH} -> ${grown}`);
    const g2 = await t('rect', '#captionStripGrip'); await mouse('mousePressed', gx, (g2.top + g2.bottom) / 2, { clickCount: 1 }); await mouse('mouseReleased', gx, (g2.top + g2.bottom) / 2);
    await mouse('mousePressed', gx, (g2.top + g2.bottom) / 2, { clickCount: 2 }); await mouse('mouseReleased', gx, (g2.top + g2.bottom) / 2, { clickCount: 2 }); await sleep(100);
    step('strip: double-click collapses it to the transport line', (await t('rect', '#captionTimeline')).height === 0 && (await t('rect', '#captionStrip')).height < stripH, JSON.stringify(await t('rect', '#captionTimeline')));
    const g3 = await t('rect', '#captionStripGrip'); await mouse('mousePressed', gx, (g3.top + g3.bottom) / 2, { clickCount: 2 }); await mouse('mouseReleased', gx, (g3.top + g3.bottom) / 2, { clickCount: 2 }); await sleep(150);
    step('strip: double-click expands it again, keeping its height', (await t('rect', '#captionTimeline')).height > 50 && Math.abs((await t('rect', '#captionStrip')).height - grown) < 2);

    const problems = log.filter(line => !/favicon|Failed to load resource/.test(line));
    step('no page errors', problems.length === 0, problems.join(' | '));
    console.log(`\n${passed} checks passed.`);
  } finally {
    if (client) client.close(); chrome.kill(); server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* Chrome may still hold files */ }
  }
})().catch(error => { console.error(`FAILED: ${error.stack || error}`); process.exit(1); });
