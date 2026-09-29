/* Video-edit controls, using the same project history as caption changes. */
(() => {
'use strict';
J.mountVideoEditor = ({ host, project, video, commit, status }) => {
  host.innerHTML = `<details open><summary>Video editing</summary>
    <label class="field">Post format<select data-edit="format"></select></label>
    <p class="muted" data-edit="duration"></p>
    <details><summary>Trim & cut</summary><p>Times are seconds in the original video. Kept sections play in order; gaps are removed from the export.</p>
      <div data-edit="clips"></div><button type="button" data-action="keep">Add kept section</button>
      <button type="button" data-action="full">Restore full video</button>
      <div class="video-edit-grid"><label>Cut from<input data-edit="cutStart" type="number" min="0" step="0.01" value="0"></label><label>Cut to<input data-edit="cutEnd" type="number" min="0" step="0.01" value="1"></label><button type="button" data-action="markCutStart">Remove from here</button><button type="button" data-action="markCutEnd">Remove to here</button></div>
      <button type="button" data-action="cut">Remove this time range</button>
    </details>
    <details><summary>Crop & rearrange</summary><p>Add panels, then drag a rectangle on the source below. Set where each panel appears in the output using percentages. Panels fill their area with a centered crop.</p>
      <div class="video-edit-buttons"><button type="button" data-action="stack">Two stacked panels</button><button type="button" data-action="pip">Picture in picture</button><button type="button" data-action="panel">Add panel</button><button type="button" data-action="resetPanels">Full frame</button></div>
      <label class="field">Selected panel<select data-edit="panel"></select></label>
      <div class="video-edit-canvases"><div><p>Source · drag to crop</p><canvas data-edit="source" width="640" height="360" aria-label="Source crop selection; use percentage fields below for keyboard editing"></canvas></div>
      <div><p>Output · drag to move panel</p><canvas data-edit="output" width="360" height="640" aria-label="Output panel placement; use percentage fields below for keyboard editing"></canvas></div></div>
      <div data-edit="rects"></div><button type="button" data-action="removePanel">Remove selected panel</button>
    </details>
    <details><summary>Overlays & templates</summary><p>Add a PNG with transparent areas (a frame, logo or template) on top of the video. Position and size are percentages of the output frame. Overlays are saved with the project; use Save template / Load template to reuse a set in other projects.</p>
      <div data-edit="overlays"></div>
      <div class="video-edit-buttons"><label class="button-like">Add PNG overlay<input data-edit="overlayFile" type="file" accept="image/png,image/webp" hidden></label>
        <button type="button" data-action="saveTemplate">Save template</button>
        <label class="button-like">Load template<input data-edit="templateFile" type="file" accept="application/json,.json" hidden></label></div>
    </details>
    <details><summary>Extra captions & notes</summary><p>Each note has its own timing and position and can overlap subtitles or other notes.</p>
      <div data-edit="notes"></div><button type="button" data-action="note">Add note</button>
    </details>
    <button type="button" class="primary" data-action="apply">Apply video edits</button><span role="status" data-edit="message"></span>
  </details>`;
  const el = name => host.querySelector(`[data-edit="${name}"]`);
  let draft, selected = 0, saved = '', mediaDuration = -1, drag = null, move = null;
  Object.entries(J.videoFormats).forEach(([key, format]) => { const option = document.createElement('option'); option.value = key; option.textContent = format.label; el('format').append(option); });
  const input = (label, value, change, options = {}) => {
    const wrapper = document.createElement('label'); wrapper.textContent = label;
    const control = document.createElement(options.type === 'textarea' ? 'textarea' : 'input');
    if (options.type !== 'textarea') control.type = options.type || 'number';
    if (control.type === 'number') { control.step = '.01'; control.min = options.min == null ? 0 : options.min; if (options.max != null) control.max = options.max; }
    control.value = value; control.addEventListener('input', () => { change(control.type === 'number' ? Number(control.value) : control.value); el('message').textContent = 'Unapplied changes'; paint(); });
    wrapper.append(control); return wrapper;
  };
  const button = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = fn; return b; };
  function paint() {
    const source = video(), canvas = el('source'), ctx = canvas.getContext('2d');
    if (!source || source.readyState < 2) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    const height = Math.round(canvas.width * source.videoHeight / source.videoWidth);
    if (canvas.height !== height) canvas.height = height;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    draft.panels.forEach((panel, i) => { const r = panel.source; ctx.strokeStyle = i === selected ? '#f5a50c' : '#49d9ef'; ctx.lineWidth = 3; ctx.strokeRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height); ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 20px sans-serif'; ctx.fillText(String(i + 1), r.x * canvas.width + 6, r.y * canvas.height + 24); });
    const output = el('output'), format = J.videoFormats[draft.format], out = output.getContext('2d');
    output.height = Math.round(output.width * format.height / format.width);
    // Invalid intermediate field values should never break the live preview.
    try {
      J.validateVideoEdits(draft, project().media.duration);
      J.drawVideoEdit(out, source, output.width, output.height, { ...project(), settings: { ...project().settings, videoEdit: draft } });
      J.drawVideoOverlays(out, { ...project(), settings: { ...project().settings, videoEdit: draft } }, 'all', { designWidth: output.width, designHeight: output.height });
      const panel = draft.panels[selected];
      if (panel) { const t = panel.target; out.strokeStyle = '#f5a50c'; out.lineWidth = 3; out.strokeRect(t.x * output.width, t.y * output.height, t.w * output.width, t.h * output.height); }
    } catch (_) { out.fillStyle = '#111'; out.fillRect(0, 0, output.width, output.height); }
  }
  function render() {
    el('format').value = draft.format;
    const clips = draft.clips.length ? draft.clips : [{ start: 0, end: Number(project().media.duration) || 0 }];
    el('duration').textContent = `Output: ${J.videoEditDuration(clips).toFixed(2)} seconds · ${J.videoFormats[draft.format].width} × ${J.videoFormats[draft.format].height}`;
    el('clips').replaceChildren();
    clips.forEach((clip, i) => {
      const row = document.createElement('div'); row.className = 'video-edit-grid';
      const set = (key, value) => { if (!draft.clips.length) draft.clips = clips.map(c => ({ ...c })); draft.clips[i][key] = value; };
      row.append(input(`Section ${i + 1} start`, clip.start, value => set('start', value)), input('End', clip.end, value => set('end', value)));
      for (const [label, action] of [['Start here', 'markStart'], ['End here', 'markEnd']]) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.dataset.action = action; b.dataset.index = i; row.append(b); }
      if (draft.clips.length > 1) row.append(button('Remove section', () => { draft.clips.splice(i, 1); render(); }));
      el('clips').append(row);
    });
    el('panel').replaceChildren();
    selected = Math.min(selected, Math.max(0, draft.panels.length - 1));
    draft.panels.forEach((panel, i) => { const option = document.createElement('option'); option.value = i; option.textContent = `Panel ${i + 1}`; el('panel').append(option); });
    el('panel').value = selected; el('rects').replaceChildren();
    const panel = draft.panels[selected];
    if (panel) for (const [key, title] of [['source', 'Source crop'], ['target', 'Output placement']]) {
      const group = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = title + ' (%)'; group.append(legend); group.className = 'video-edit-grid';
      for (const [field, label] of [['x', 'Left'], ['y', 'Top'], ['w', 'Width'], ['h', 'Height']]) group.append(input(label, +(panel[key][field] * 100).toFixed(2), value => { panel[key][field] = value / 100; }, { max: 100 }));
      el('rects').append(group);
    }
    el('overlays').replaceChildren();
    (draft.overlays || []).forEach((overlay, i) => {
      const row = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = `Overlay ${i + 1} · ${overlay.name}`; row.append(legend); row.className = 'video-edit-grid';
      for (const [key, label] of [['x', 'Left (%)'], ['y', 'Top (%)'], ['w', 'Width (%)'], ['h', 'Height (%)']]) row.append(input(label, +(overlay[key] * 100).toFixed(2), value => { overlay[key] = value / 100; }, { min: -200, max: 400 }));
      row.append(input('Opacity (%)', Math.round(overlay.opacity * 100), value => { overlay.opacity = value / 100; }, { max: 100 }));
      const layer = document.createElement('label'); layer.textContent = 'Layer'; const select = document.createElement('select');
      for (const [value, text] of [['below', 'Under captions'], ['above', 'Over captions']]) { const option = document.createElement('option'); option.value = value; option.textContent = text; select.append(option); }
      select.value = overlay.layer; select.onchange = () => { overlay.layer = select.value; el('message').textContent = 'Unapplied changes'; paint(); }; layer.append(select);
      row.append(layer, button('Fit to frame', () => { Object.assign(overlay, { x: 0, y: 0, w: 1, h: 1 }); render(); el('message').textContent = 'Unapplied changes'; }), button('Delete overlay', () => { draft.overlays.splice(i, 1); render(); el('message').textContent = 'Unapplied changes'; }));
      el('overlays').append(row);
    });
    el('notes').replaceChildren();
    draft.notes.forEach((note, i) => {
      const row = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = `Note ${i + 1}`; row.append(legend); row.className = 'video-edit-grid';
      row.append(input('Text', note.text, value => note.text = value, { type: 'textarea' }));
      for (const [key, label] of [['start', 'Start (s)'], ['end', 'End (s)'], ['x', 'Horizontal (%)'], ['y', 'Vertical (%)'], ['size', 'Text size (%)']]) row.append(input(label, ['x', 'y'].includes(key) ? note[key] * 100 : note[key], value => note[key] = ['x', 'y'].includes(key) ? value / 100 : value));
      row.append(input('Color', note.color, value => note.color = value, { type: 'color' }), button('Delete note', () => { draft.notes.splice(i, 1); render(); })); el('notes').append(row);
    });
    paint();
  }
  function refresh() {
    const value = JSON.stringify(J.videoEditSettings(project()));
    if (value !== saved || mediaDuration !== project().media.duration) { saved = value; mediaDuration = project().media.duration; draft = JSON.parse(value); render(); }
  }
  const readDataUrl = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Could not read the image.')); reader.readAsDataURL(file); });
  const decode = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('That file is not a readable image.')); image.src = src; });
  const nextOverlayId = () => { const used = new Set((draft.overlays || []).map(overlay => overlay.id)); let n = 1; while (used.has(`overlay_${n}`)) n++; return `overlay_${n}`; };
  const addOverlay = async (file, template) => {
    try {
      draft.overlays = draft.overlays || [];
      if (draft.overlays.length >= J.VIDEO_OVERLAY_LIMIT) throw new Error(`Use at most ${J.VIDEO_OVERLAY_LIMIT} overlays.`);
      if (!/^image\/(png|webp)$/.test(file.type)) throw new Error('Choose a PNG (or WebP) image with transparency.');
      const src = await readDataUrl(file); if (src.length > J.VIDEO_OVERLAY_MAX_CHARS) throw new Error('Overlay image is too large (limit about 6 MB).');
      const image = await decode(src), format = J.videoFormats[draft.format];
      // Contain-fit at full width or height; a frame the same shape as the output fills it exactly.
      const scale = Math.min(format.width / image.naturalWidth, format.height / image.naturalHeight), w = image.naturalWidth * scale / format.width, h = image.naturalHeight * scale / format.height;
      draft.overlays.push({ id: nextOverlayId(), name: file.name.slice(0, 200), src, x: (1 - w) / 2, y: (1 - h) / 2, w, h, opacity: 1, layer: 'below' });
      await J.preloadVideoOverlays({ settings: { videoEdit: draft } }); render(); el('message').textContent = 'Unapplied changes';
    } catch (error) { el('message').textContent = error.message; status(error.message, true); }
  };
  el('overlayFile').onchange = () => { const file = el('overlayFile').files[0]; el('overlayFile').value = ''; if (file) addOverlay(file); };
  el('templateFile').onchange = async () => {
    const file = el('templateFile').files[0]; el('templateFile').value = ''; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.kind !== 'jizura-overlay-template' || !Array.isArray(data.overlays)) throw new Error('That is not a JIZURA overlay template.');
      J.validateVideoOverlays(data.overlays); draft.overlays = data.overlays;
      await J.preloadVideoOverlays({ settings: { videoEdit: draft } }); render(); el('message').textContent = 'Unapplied changes';
    } catch (error) { el('message').textContent = error.message; status(error.message, true); }
  };
  const whole = () => ({ x: 0, y: 0, w: 1, h: 1 });
  host.addEventListener('click', event => {
    const action = event.target.dataset.action; if (!action) return;
    try {
      const duration = Number(project().media.duration) || 0;
      if (action === 'apply') {
        J.validateVideoEdits(draft, duration);
        if (commit(JSON.parse(JSON.stringify(draft)))) { el('message').textContent = 'Edits applied'; status('Video edits saved.'); }
        return;
      }
      if (action === 'keep') { const end = draft.clips.length ? draft.clips[draft.clips.length - 1].end : 0; if (end >= duration) throw new Error('Shorten the last section before adding another.'); draft.clips.push({ start: end, end: duration }); }
      if (action === 'full') draft.clips = [];
      if (action === 'cut') {
        const start = Number(el('cutStart').value), end = Number(el('cutEnd').value);
        if (!(start >= 0 && end > start && end <= duration)) throw new Error('Enter a cut range inside the video.');
        const kept = [];
        for (const clip of draft.clips.length ? draft.clips : [{ start: 0, end: duration }]) {
          if (end <= clip.start || start >= clip.end) kept.push(clip);
          else { if (start > clip.start) kept.push({ start: clip.start, end: start }); if (end < clip.end) kept.push({ start: end, end: clip.end }); }
        }
        if (!kept.length) throw new Error('Keep at least one section of the video.');
        draft.clips = kept;
      }
      if (action === 'stack') draft.panels = [{ source: whole(), target: { x: 0, y: 0, w: 1, h: .5 } }, { source: { x: .6, y: .2, w: .4, h: .8 }, target: { x: 0, y: .5, w: 1, h: .5 } }];
      if (action === 'pip') draft.panels = [{ source: whole(), target: whole() }, { source: { x: .6, y: .2, w: .4, h: .8 }, target: { x: .62, y: .62, w: .35, h: .35 } }];
      if (action === 'panel') { draft.panels.push({ source: whole(), target: whole() }); selected = draft.panels.length - 1; }
      if (action === 'resetPanels') draft.panels = [];
      if (action === 'removePanel') draft.panels.splice(selected, 1);
      if (action === 'saveTemplate') {
        if (!(draft.overlays || []).length) throw new Error('Add an overlay first.');
        J.saveFile('jizura-overlay-template.json', JSON.stringify({ kind: 'jizura-overlay-template', version: 1, overlays: draft.overlays }));
        return;
      }
      if (action === 'note') { if (!duration) throw new Error('Load a video first.'); const start = Math.min(video() && video().currentTime || 0, Math.max(0, duration - .1)); draft.notes.push({ text: 'New note', start, end: Math.min(duration, start + 3), x: .5, y: .18 + (draft.notes.length % 5) * .12, size: 4, color: '#ffffff' }); }
      if (action === 'markStart' || action === 'markEnd') {
        const source = video();
        if (!duration || !source || !Number.isFinite(source.duration)) throw new Error('Load a video first.');
        const time = Math.round(source.currentTime * 100) / 100, next = (draft.clips.length ? draft.clips : [{ start: 0, end: duration }]).map(c => ({ ...c }));
        next[Number(event.target.dataset.index)][action === 'markStart' ? 'start' : 'end'] = time;
        let previousEnd = 0;
        for (const clip of next) {
          if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < previousEnd || clip.end <= clip.start || !(clip.end <= duration + .001)) throw new Error('Kept sections must be in source order, inside the video, and must not overlap.');
          previousEnd = clip.end;
        }
        draft.clips = next;
      }
      if (action === 'markCutStart' || action === 'markCutEnd') {
        const source = video();
        if (!duration || !source || !Number.isFinite(source.duration)) throw new Error('Load a video first.');
        const time = Math.round(source.currentTime * 100) / 100;
        el(action === 'markCutStart' ? 'cutStart' : 'cutEnd').value = time;
        return;
      }
      render(); el('message').textContent = 'Unapplied changes';
    } catch (error) { el('message').textContent = error.message; status(error.message, true); }
  });
  el('format').onchange = () => { draft.format = el('format').value; render(); el('message').textContent = 'Unapplied changes'; };
  el('panel').onchange = () => { selected = Number(el('panel').value); render(); };
  const point = event => { const rect = el('source').getBoundingClientRect(); return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }; };
  el('source').onpointerdown = event => { if (!draft.panels[selected]) return; drag = point(event); el('source').setPointerCapture(event.pointerId); };
  el('source').onpointermove = event => { if (!drag) return; const p = point(event), w = Math.abs(p.x - drag.x), h = Math.abs(p.y - drag.y); if (w > .005 && h > .005) draft.panels[selected].source = { x: Math.min(p.x, drag.x), y: Math.min(p.y, drag.y), w, h }; paint(); };
  el('source').onpointerup = () => { if (!drag) return; drag = null; render(); el('message').textContent = 'Unapplied changes'; };
  el('source').onpointercancel = () => { drag = null; };
  const outputPoint = event => { const rect = el('output').getBoundingClientRect(); return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }; };
  el('output').onpointerdown = event => {
    const p = outputPoint(event);
    const index = draft.panels.findLastIndex(panel => { const t = panel.target; return p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h; });
    if (index < 0) return;
    selected = index; move = { point: p, target: { ...draft.panels[index].target } }; el('output').setPointerCapture(event.pointerId); paint();
  };
  el('output').onpointermove = event => {
    if (!move) return; const p = outputPoint(event), t = draft.panels[selected].target;
    t.x = Math.max(0, Math.min(1 - t.w, move.target.x + p.x - move.point.x));
    t.y = Math.max(0, Math.min(1 - t.h, move.target.y + p.y - move.point.y)); paint();
  };
  el('output').onpointerup = () => { if (!move) return; move = null; render(); el('message').textContent = 'Unapplied changes'; };
  el('output').onpointercancel = () => { move = null; };
  refresh(); return { refresh, paint };
};
})();
