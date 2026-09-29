/* Step 8: export check in real Google Chrome (H.264), release matrix for Video Captions.

   node export_chrome_check.js [--chrome PATH] [--headed | --minimize-export] [--only NAME] [--out DIR] [--stall SECONDS] [--long]
   (--minimize-export: a normal window, minimized while each export runs, as when the user switches away;
    Chrome defers <video> loading in hidden pages, so import and the playback check run while it is visible;
    Edge does not report a minimized page as hidden, so use this flag with Chrome)

   1. Serves the repository on 127.0.0.1 (build first: python build.py).
   2. Launches Google Chrome with a fresh temporary profile and drives the built app over the
      DevTools protocol (no Playwright). Each scenario imports a generated fixture video, sets up
      captions (tracks, text blocks, video edits) through the caption store, and exports with
      J.CaptionVideoExporter, the exporter the Export button uses (in-memory target, so no save dialog).
   3. Checks each MP4 in Chrome (<video> metadata, seek to the end) and with ffprobe/ffmpeg
      (codec, size, 30 fps, exact frame count, start at zero, duration, audio, loudness, AAC passthrough).
   --long adds the 3-minute file-backed scenario (needs generated/portrait-180s-30fps-av.mp4, see the release checklist).
   Outputs and a JSON report go to dev/fixtures/media/generated/export-check/ (gitignored).
   Needs: Node 22+ (global WebSocket), ffmpeg + ffprobe on PATH, generated fixtures (fixtures/media/generate.ps1). */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { spawn, execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const arg = (name, fallback) => { const index = process.argv.indexOf(name); return index > 0 ? process.argv[index + 1] : fallback; };
const flag = name => process.argv.includes(name);
const CHROME = arg('--chrome', process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe');
const OUT = path.resolve(arg('--out', path.join(__dirname, 'fixtures', 'media', 'generated', 'export-check')));
const ONLY = arg('--only', null);
const MINIMIZE = flag('--minimize-export');
const FIX = '/dev/fixtures/media/generated/';
const TRANSCRIPT = '/dev/fixtures/captions/word-timestamps.json';
const EPS_FRAME = 1 / 30;

/* ---- scenarios (the release matrix) ---- */
const block = (text, start, end, extra = {}) => Object.assign({ type: 'create-text-block', text, start, end }, extra);
const edits = (format, more = {}) => ({ type: 'set-video-edits', value: Object.assign({ format, clips: [], panels: [], notes: [] }, more) });
const SCENARIOS = [
  { name: 'portrait15-shorts-tracks', video: 'portrait-15s-30fps-av.mp4', transcript: true, hasAudio: true, cancelAt: 0.35, repeat: 2, passthrough: true,
    commands: [{ type: 'add-track', trackId: 'track_2', name: 'Titles' },
      block('Keep going, it is worth it', 0.9, 3.9, { trackId: 'track_2', box: { x: 0.08, y: 0.08, width: 0.84, height: 0.14 }, animation: { enter: 'captionSoftRise' } }),
      block('Chapter one', 2.3, 3.35)],
    frames: [1.6, 2.8, 14.0] },
  { name: 'landscape10-youtube', video: 'landscape-10s-30fps-av.mp4', hasAudio: true, passthrough: true,
    commands: [edits('youtube'), block('Landscape stays supported', 0.5, 4), block('Second line of text', 4.5, 9.5)], frames: [2] },
  { name: 'portrait5-24fps-reels', video: 'portrait-5s-24fps-av.mp4', hasAudio: true, passthrough: true,
    commands: [edits('reels'), block('Twenty-four in, thirty out', 0.3, 4.6)], frames: [2] },
  { name: 'portrait5-60fps-portrait45', video: 'portrait-5s-60fps-av.mp4', hasAudio: true, passthrough: true,
    commands: [edits('portrait'), block('Sixty in, thirty out', 0.3, 4.6)], frames: [2] },
  { name: 'portrait5-silent-square', video: 'portrait-5s-30fps-silent.mp4', hasAudio: false,
    commands: [edits('square'), block('No audio track', 0.3, 4.6)], frames: [2] },
  { name: 'portrait15-edited-square', video: 'portrait-15s-30fps-av.mp4', transcript: true, hasAudio: true, passthrough: false,
    commands: [edits('square', { clips: [{ start: 0, end: 4.8 }, { start: 6, end: 12.3 }], notes: [{ text: 'NOTE', start: 1, end: 3, x: 0.5, y: 0.08, size: 6, color: '#ffde59' }] })],
    frames: [1.6, 5.5] },
  // Over 30 s an in-memory export is refused; the file-backed writer is used (OPFS stands in for the save dialog).
  // The transcript is the fixture's words repeated 12 times (3 minutes), imported through the UI to time planning.
  { name: 'portrait180-file-backed', video: 'portrait-180s-30fps-av.mp4', transcript: true, transcriptRepeat: 12, hasAudio: true, passthrough: true, fileBacked: true, optional: true,
    commands: [{ type: 'add-track', trackId: 'track_2' }, block('Three minutes, one file', 0.9, 3.9, { trackId: 'track_2' }), block('Near the end', 170, 175, { trackId: 'track_2' })],
    frames: [1.6, 172] },
].filter(item => ONLY ? item.name === ONLY : !item.optional || flag('--long'));

/* ---- local server: static files + upload of the exported bytes ---- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (req.method === 'POST' && url.pathname === '/upload') {
      const name = path.basename(url.searchParams.get('name') || 'upload.bin'), file = fs.createWriteStream(path.join(OUT, name));
      req.pipe(file); file.on('finish', () => { res.writeHead(204); res.end(); }); return;
    }
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname));
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

/* ---- Chrome over the DevTools protocol ---- */
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function getJson(url, tries = 100) {
  for (let i = 0; i < tries; i++) { try { const res = await fetch(url); if (res.ok) return await res.json(); } catch (_) {} await sleep(100); }
  throw new Error(`No answer from ${url}`);
}
function cdp(wsUrl, log, onEvent) {
  const ws = new WebSocket(wsUrl), pending = new Map(); let next = 1;
  ws.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { const { resolve, reject } = pending.get(message.id); pending.delete(message.id); message.error ? reject(new Error(message.error.message)) : resolve(message.result); }
    else if (message.method && onEvent && onEvent(message)) {}
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

/* A scenario that makes no progress for STALL_MS is reported with the step it stopped at (the page is then reloaded). */
const STALL_MS = Number(arg('--stall', 120)) * 1000;
async function watch(client, work) {
  let timer, stalled = false;
  const guard = new Promise((_, reject) => {
    timer = setInterval(async () => {
      const state = await client.evaluate('window.__check || null').catch(() => null);
      if (state && Date.now() - state.at > STALL_MS && !stalled) { stalled = true; reject(new Error(`Stalled for ${STALL_MS / 1000}s at "${state.step}"${state.detail ? ` (${state.detail})` : ''}; page hidden: ${state.hidden}`)); }
    }, 5000);
  });
  try { return await Promise.race([work, guard]); }
  finally { clearInterval(timer); if (stalled) { await client.send('Page.reload', { ignoreCache: true }).catch(() => {}); await sleep(3000); } }
}

/* ---- the in-page scenario (runs in Chrome) ---- */
const PAGE_RUN = async scenario => {
  const ui = J.captionWorkbench, $ = id => document.getElementById(id), wait = ms => new Promise(r => setTimeout(r, ms));
  const until = async (test, ms = 30000, what = 'the app') => { const end = Date.now() + ms; while (!test()) { if (Date.now() > end) { const c = ui.media && ui.media._candidate && ui.media._candidate.video; throw new Error(`Timed out waiting for ${what} (status: ${$('captionStatus').textContent}${c ? `; video readyState ${c.readyState}, networkState ${c.networkState}, error ${c.error && c.error.code}` : ui.media && ui.media._pending ? '' : '; no pending video (fingerprint?)'}; hidden ${document.hidden})`); } await wait(50); } };
  const heap = () => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
  const mark = (step, detail) => { window.__check = { step, detail: detail == null ? null : detail, at: Date.now(), hidden: document.hidden }; };
  const hiddenSeen = { visible: 0, hidden: 0 };
  const onProgress = label => event => { hiddenSeen[document.hidden ? 'hidden' : 'visible']++; mark(label, `${event.phase} ${Math.round(event.progress * 100)}%`); };
  const setWindow = async state => { if (!scenario.minimize) return; window.jizuraWindow(state); await until(() => document.hidden === (state === 'minimized'), 15000, `the window to become ${state}`); };
  const setFile = async (id, url, type) => { const blob = await fetch(url).then(r => r.blob()), dt = new DataTransfer(); dt.items.add(new File([blob], url.split('/').pop(), { type })); $(id).files = dt.files; $(id).dispatchEvent(new Event('change', { bubbles: true })); };
  $('productVideoCaptions').click(); $('captionNew').click();
  mark('import video');
  await setFile('captionVideoFile', scenario.videoUrl, 'video/mp4');
  await until(() => ui.media && ui.media.current && ui.store.project.media.duration > 0, 30000, 'the video import');
  let transcriptSeconds = null;
  if (scenario.transcriptUrl) {
    mark('import transcript'); let url = scenario.transcriptUrl;
    if (scenario.transcriptRepeat) { // the fixture's words, repeated every 15 s with fresh ids
      const base = await fetch(url).then(r => r.json()), tokens = [];
      for (let k = 0; k < scenario.transcriptRepeat; k++) for (const token of base.tokens) tokens.push(Object.assign({}, token, { id: `${token.id}_r${k}`, start: +(token.start + 15 * k).toFixed(6), end: +(token.end + 15 * k).toFixed(6) }));
      url = URL.createObjectURL(new Blob([JSON.stringify(Object.assign({}, base, { tokens }))], { type: 'application/json' }));
    }
    const started = performance.now();
    await setFile('captionTranscriptFile', url, 'application/json'); await until(() => ui.store.project.segments.length > 0, 120000, 'the transcript import');
    transcriptSeconds = +((performance.now() - started) / 1000).toFixed(3);
  }
  mark('commands'); for (const command of scenario.commands) ui.store.execute(command);
  const project = JSON.parse(JSON.stringify(ui.store.project)), file = ui.media.current.file, size = J.videoOutputSize(project);
  const out = { segmentCount: project.segments.length, transcriptSeconds, heapAfterImportMB: heap(), output: size,
    support: await J.checkCaptionExportSupport({ outputWidth: size.width, outputHeight: size.height }), runs: [] };
  if (scenario.cancelAt) {
    const abort = new AbortController(); let code = null; const started = performance.now();
    const progressed = onProgress('cancel run');
    try { await new J.CaptionVideoExporter().export(file, project, { signal: abort.signal, onProgress: e => { progressed(e); if (e.phase === 'video' && e.progress >= scenario.cancelAt) abort.abort(); } }); }
    catch (error) { code = error.code || error.message; }
    out.cancel = { code, seconds: +((performance.now() - started) / 1000).toFixed(2), heapMB: heap() };
  }
  for (let run = 1; run <= (scenario.repeat || 1); run++) {
    await setWindow('minimized'); hiddenSeen.visible = hiddenSeen.hidden = 0;
    let writable = null, handle = null, opfs = null;
    if (scenario.fileBacked) {
      if (run === 1) try { await new J.CaptionVideoExporter().export(file, project, {}); out.blobGate = 'not refused'; } catch (error) { out.blobGate = error.code; }
      opfs = await navigator.storage.getDirectory(); handle = await opfs.getFileHandle(`${scenario.name}-${run}.mp4`, { create: true }); writable = await handle.createWritable();
    }
    const result = await new J.CaptionVideoExporter().export(file, project, { writable, onProgress: onProgress(`export ${run}`) });
    const progressWhileHidden = Object.assign({}, hiddenSeen);
    await setWindow('normal');
    if (handle) result.blob = await handle.getFile();
    mark(`chrome playback ${run}`);
    const url = URL.createObjectURL(result.blob), video = document.createElement('video'); video.muted = true; video.preload = 'auto'; video.src = url;
    await new Promise((resolve, reject) => { video.onloadedmetadata = resolve; video.onerror = () => reject(new Error('Chrome could not open the export')); });
    const playback = { duration: video.duration, width: video.videoWidth, height: video.videoHeight };
    mark(`chrome seek ${run}`);
    await new Promise(resolve => { video.onseeked = resolve; video.currentTime = Math.max(0, video.duration - 0.02); });
    playback.seekedToEnd = video.currentTime; playback.readyState = video.readyState;
    URL.revokeObjectURL(url);
    const name = `${scenario.name}-${run}.mp4`; mark(`upload ${run}`);
    await fetch(`/upload?name=${encodeURIComponent(name)}`, { method: 'POST', body: result.blob });
    if (opfs) await opfs.removeEntry(name);
    out.runs.push({ file: name, bytes: result.blob.size, frameCount: result.frameCount, duration: result.duration, width: result.width, height: result.height,
      fileBacked: result.fileBacked, audio: result.audio, metrics: result.metrics, heapMB: heap(), chrome: playback, progressEvents: progressWhileHidden });
  }
  return out;
};

/* ---- ffprobe / ffmpeg verification (an independent decoder) ---- */
const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const runErr = (cmd, args) => { try { const { spawnSync } = require('node:child_process'); return spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).stderr; } catch (error) { return String(error); } };
function probe(file) {
  const json = JSON.parse(run('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,profile,width,height,pix_fmt,r_frame_rate,avg_frame_rate,nb_read_frames,start_time,duration,sample_rate,channels:format=duration,start_time', '-of', 'json', file]));
  return { video: json.streams.find(s => s.codec_type === 'video'), audio: json.streams.find(s => s.codec_type === 'audio'), format: json.format };
}
const audioHash = file => run('ffmpeg', ['-v', 'error', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'md5', '-']).trim();
const meanVolume = file => { const match = runErr('ffmpeg', ['-hide_banner', '-i', file, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-']).match(/mean_volume:\s*(-?[\d.]+|-inf) dB/); return match ? Number(match[1]) : null; };

function verify(scenario, page, runInfo) {
  const file = path.join(OUT, runInfo.file), p = probe(file), checks = [], expectFrames = Math.ceil(runInfo.duration * 30 - 1e-9);
  const check = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  check('h264 video', p.video && p.video.codec_name === 'h264', p.video && `${p.video.codec_name} ${p.video.profile} ${p.video.pix_fmt}`);
  check('output size', p.video && p.video.width === page.output.width && p.video.height === page.output.height, p.video && `${p.video.width}x${p.video.height}`);
  check('30 fps', p.video && p.video.r_frame_rate === '30/1', p.video && `${p.video.r_frame_rate} avg ${p.video.avg_frame_rate}`);
  check('frame count', p.video && Number(p.video.nb_read_frames) === expectFrames && runInfo.frameCount === expectFrames, p.video && `${p.video.nb_read_frames} decoded, ${runInfo.frameCount} encoded, ${expectFrames} expected`);
  check('starts at zero', p.video && Math.abs(Number(p.video.start_time)) < 1e-3, p.video && `video ${p.video.start_time}${p.audio ? `, audio ${p.audio.start_time}` : ''}`);
  check('duration', p.video && Math.abs(Number(p.video.duration) - runInfo.duration) <= EPS_FRAME + 1e-3, `video ${p.video && p.video.duration}s, expected ${runInfo.duration}s, container ${p.format.duration}s`);
  check('chrome playback', Math.abs(runInfo.chrome.duration - runInfo.duration) <= 0.1 && runInfo.chrome.width === page.output.width && runInfo.chrome.readyState >= 1, `${runInfo.chrome.width}x${runInfo.chrome.height} ${runInfo.chrome.duration.toFixed(3)}s, seeked to ${runInfo.chrome.seekedToEnd.toFixed(3)}`);
  if (scenario.hasAudio) {
    check('aac audio', p.audio && p.audio.codec_name === 'aac', p.audio && `${p.audio.codec_name} ${p.audio.sample_rate} Hz ${p.audio.channels} ch, mode ${runInfo.audio.mode}`);
    check('audio length', p.audio && Math.abs(Number(p.audio.duration) - runInfo.duration) <= 0.05, p.audio && `audio ${p.audio.duration}s`);
    const volume = p.audio ? meanVolume(file) : null; check('audible', volume != null && volume > -50, `mean ${volume} dB`);
    if (scenario.passthrough) check('aac passthrough (bit-exact packets)', audioHash(file) === audioHash(path.join(root, FIX.slice(1), scenario.video)), `mode ${runInfo.audio.mode}`);
    else check('audio re-encoded for edits', runInfo.audio.mode !== 'passthrough', `mode ${runInfo.audio.mode}`);
  } else check('no audio track', !p.audio, p.audio ? p.audio.codec_name : 'none');
  for (const time of scenario.frames || []) {
    const png = path.join(OUT, `${runInfo.file.replace(/\.mp4$/, '')}-t${time}.png`);
    run('ffmpeg', ['-v', 'error', '-y', '-ss', String(time), '-i', file, '-frames:v', '1', png]);
  }
  return { probe: { video: p.video, audio: p.audio || null, format: p.format }, checks };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const scenario of SCENARIOS) if (!fs.existsSync(path.join(root, FIX.slice(1), scenario.video))) throw new Error(`Missing fixture ${scenario.video}: run dev/fixtures/media/generate.ps1`);
  const server = await startServer(), port = server.address().port, log = [];
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'jizura-chrome-')), debugPort = 9300 + Math.floor(Math.random() * 500);
  const args = [`--user-data-dir=${profile}`, `--remote-debugging-port=${debugPort}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--window-size=1400,1000', ...(flag('--headed') || MINIMIZE ? [] : ['--headless=new']), 'about:blank'];
  const chrome = spawn(CHROME, args, { stdio: 'ignore' });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { chrome.kill(); process.exit(1); });
  const mode = MINIMIZE ? 'headed, minimized during export' : flag('--headed') ? 'headed' : 'headless';
  const report = { startedAt: new Date().toISOString(), chromePath: CHROME, mode, freshProfile: profile, scenarios: [] };
  try {
    const version = await getJson(`http://127.0.0.1:${debugPort}/json/version`);
    report.browser = version.Browser; report.userAgent = version['User-Agent'];
    const page = (await getJson(`http://127.0.0.1:${debugPort}/json/list`)).find(target => target.type === 'page');
    let client;
    // The page asks for its window to be minimized / restored through a binding (Browser.setWindowBounds).
    client = cdp(page.webSocketDebuggerUrl, log, message => {
      if (message.method !== 'Runtime.bindingCalled' || message.params.name !== 'jizuraWindow') return false;
      client.send('Browser.getWindowForTarget').then(({ windowId }) => client.send('Browser.setWindowBounds', { windowId, bounds: { windowState: message.params.payload } })).catch(error => log.push(`window: ${error.message}`));
      return true;
    });
    await client.ready;
    await client.send('Runtime.enable');
    await client.send('Runtime.addBinding', { name: 'jizuraWindow' });
    await client.send('Page.navigate', { url: `http://127.0.0.1:${port}/index.html` });
    for (let i = 0; i < 300; i++) { if (await client.evaluate('document.readyState === "complete" && !!(window.J && J.captionWorkbench)').catch(() => false)) break; await sleep(100); }
    report.gpu = await client.evaluate(`(() => { try { const gl = document.createElement('canvas').getContext('webgl'), ext = gl && gl.getExtension('WEBGL_debug_renderer_info'); return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : null; } catch (e) { return String(e); } })()`);
    report.hardwareConcurrency = await client.evaluate('navigator.hardwareConcurrency');
    report.pageHiddenAtStart = await client.evaluate('document.hidden');
    report.deviceMemoryGB = await client.evaluate('navigator.deviceMemory || null');
    for (const scenario of SCENARIOS) {
      process.stdout.write(`${scenario.name} … `);
      const input = Object.assign({}, scenario, { minimize: MINIMIZE, videoUrl: FIX + scenario.video, transcriptUrl: scenario.transcript ? TRANSCRIPT : null });
      const entry = { name: scenario.name, video: scenario.video };
      try {
        entry.page = await watch(client, client.evaluate(`(${PAGE_RUN.toString()})(${JSON.stringify(input)})`));
        entry.runs = entry.page.runs.map(info => Object.assign({ file: info.file }, verify(scenario, entry.page, info)));
        if (scenario.cancelAt) entry.cancelOk = entry.page.cancel && entry.page.cancel.code === 'MEDIA_EXPORT_CANCELLED';
        if (scenario.fileBacked) entry.fileBackedOk = entry.page.blobGate === 'MEDIA_FILE_SAVE_REQUIRED' && entry.page.runs.every(item => item.fileBacked);
        entry.ok = entry.runs.every(item => item.checks.every(c => c.ok)) && (!scenario.cancelAt || entry.cancelOk) && (!scenario.fileBacked || entry.fileBackedOk);
      } catch (error) { entry.ok = false; entry.error = String(error && error.stack || error); }
      report.scenarios.push(entry);
      console.log(entry.ok ? 'PASS' : 'FAIL');
      if (!entry.ok) for (const r of entry.runs || []) for (const c of r.checks) if (!c.ok) console.log(`   ${r.file}: ${c.name} — ${c.detail}`);
      if (entry.error) console.log(`   ${entry.error.split('\n')[0]}`);
    }
    client.close();
  } finally {
    report.pageErrors = log; report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
    chrome.kill(); server.close();
    await sleep(500); try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {}
  }
  const failed = report.scenarios.filter(item => !item.ok).length;
  console.log(`${report.browser} (${report.mode}): ${report.scenarios.length - failed}/${report.scenarios.length} scenarios passed. Report: ${path.relative(process.cwd(), path.join(OUT, 'report.json'))}`);
  if (log.length) console.log(`Page errors:\n  ${log.join('\n  ')}`);
  process.exitCode = failed ? 1 : 0;
})().catch(error => { console.error(error); process.exitCode = 1; });
