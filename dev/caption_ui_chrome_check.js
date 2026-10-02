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
    setSnap(on) { if (ui.transport.snap !== on) $('captionSnap').click(); },
    lockTiming(id) { ui.store.execute({ type: 'set-field-lock', segmentId: id, field: 'timing', locked: true }); J.captionWb.emit('project'); ui.store.undoStack.length = 0; },
    lockBadge(id) { const b = document.querySelector('[data-segment-id="' + id + '"] .caption-lock-badge'); return !!b && !b.hidden; },
    status() { return $('captionStatus').textContent; },
    order() { return ui.store.project.tracks.map(item => item.id).join(','); },
    names() { return ui.store.project.tracks.map(item => item.name).join(','); },
    menuItems() { return [...document.querySelectorAll('.caption-menu [role=menuitem]')].map(b => b.textContent + (b.disabled ? '(off)' : '')); },
    addVisible() { return !$('captionTrackAddInline').hidden; },
    removeTrack(id) { ui.store.execute({ type: 'remove-track', trackId: id }); J.captionWb.emit('project'); },
    errors() { return JSON.stringify(ui.errors); },
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

    const problems = log.filter(line => !/favicon|Failed to load resource/.test(line));
    step('no page errors', problems.length === 0, problems.join(' | '));
    console.log(`\n${passed} checks passed.`);
  } finally {
    if (client) client.close(); chrome.kill(); server.close();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) { /* Chrome may still hold files */ }
  }
})().catch(error => { console.error(`FAILED: ${error.stack || error}`); process.exit(1); });
