/* ============================================================
   Azuria Sub — Video Captions autosave: the last project is kept in the browser (IndexedDB) and offered back on the next visit
   ============================================================ */
(() => {
'use strict';
if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
const W = J.captionWb;
const { ui, $, status } = W;
const DB_NAME = 'azuria-sub', STORE = 'autosave', KEY = 'last', DELAY = 1500;
let timer = 0, ready = false, saving = null, lastJson = '', lastName = '';

/* One small record: { json, name, savedAt, segments }. The video file is never stored, so a restored project asks for a relink. */
function database() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('no IndexedDB'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function run(mode, action) {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode), request = action(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(request && request.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const readRecord = () => run('readonly', store => store.get(KEY));
const writeRecord = record => run('readwrite', store => store.put(record, KEY));
const clearRecord = () => run('readwrite', store => store.delete(KEY));

function hasContent(project) {
  return !!(project.transcript.tokens.length || project.segments.length || Object.keys(project.media || {}).length || (project.settings && project.settings.videoEdit));
}
const clock = time => new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function showState(text, isError) {
  const node = $('captionSaveState'); if (!node) return;
  node.textContent = text; node.classList.toggle('error', !!isError);
}

async function saveNow() {
  clearTimeout(timer); timer = 0;
  if (!ready || saving) return;
  const project = ui.store.project;
  if (!hasContent(project)) return;
  const json = ui.store.serialize(), name = $('captionProjectName').value;
  if (json === lastJson && name === lastName) return;
  const record = { json, name: $('captionProjectName').value, savedAt: Date.now(), segments: project.segments.length };
  saving = writeRecord(record).then(() => { lastJson = json; lastName = name; showState('自動保存 ' + clock(record.savedAt)); })
    .catch(() => showState('自動保存できません', true))
    .finally(() => { saving = null; });
  await saving;
}
function schedule() {
  if (!ready) return;
  clearTimeout(timer); timer = setTimeout(() => { saveNow(); }, DELAY);
}

/* ---- restore prompt ---- */
function askRestore(record) {
  const dialog = $('captionRestoreDlg');
  $('captionRestoreName').textContent = record.name || '—';
  $('captionRestoreTime').textContent = new Date(record.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  $('captionRestoreCount').textContent = String(record.segments || 0);
  return new Promise(resolve => {
    // A choice is required: Esc must not leave the record in limbo. Chrome ignores preventDefault on `cancel` without user activation, so the key is stopped too.
    dialog.addEventListener('cancel', event => event.preventDefault());
    const noEsc = event => { if (event.key === 'Escape' && dialog.open) event.preventDefault(); };   // focus may be on the page behind the modal
    document.addEventListener('keydown', noEsc, true); dialog.addEventListener('close', () => document.removeEventListener('keydown', noEsc, true), { once: true });
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'restore'), { once: true });
    if (dialog.showModal) { if (!dialog.open) dialog.showModal(); } else dialog.setAttribute('open', '');
  });
}
async function offerRestore(record) {
  const restore = await askRestore(record);
  if (restore) {
    try {
      await W.openProject({ name: (record.name || 'project') + '.json', text: async () => record.json });
      lastJson = record.json; lastName = $('captionProjectName').value; showState('自動保存 ' + clock(record.savedAt));
    } catch (error) { status(J.recoveryForError ? J.recoveryForError(error).display : error.message, true); }
  } else { try { await clearRecord(); } catch (error) { /* nothing to clear */ } }
  ready = true;
}
function whenCaptionsVisible() {
  const workspace = $('videoCaptionsWorkspace');
  return new Promise(resolve => {
    if (!workspace || !workspace.hidden) return resolve();
    $('app').addEventListener('jizura:product-mode', function wait(event) {
      if (event.detail.mode !== 'video-captions') return;
      $('app').removeEventListener('jizura:product-mode', wait); resolve();
    });
  });
}

async function start() {
  let record = null;
  try { record = await readRecord(); } catch (error) { showState('自動保存できません', true); return; }
  if (record && typeof record.json === 'string') { await whenCaptionsVisible(); await offerRestore(record); }
  else ready = true;
}

function init() {
  W.on('project', schedule, 20);
  $('captionProjectName').addEventListener('input', schedule);
  $('captionNew').addEventListener('click', () => { lastJson = ''; showState(''); clearRecord().catch(() => {}); });   // an empty project must not bring the old one back
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveNow(); });
  window.addEventListener('pagehide', () => { saveNow(); });
  start();
}

W.autosave = Object.freeze({ saveNow, readRecord, clearRecord, dbName: DB_NAME, delay: DELAY, isReady: () => ready });
init();   // 12c_caption_workbench.js has already run its init list and bind()
})();
