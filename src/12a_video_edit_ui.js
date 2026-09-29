/* Video settings: output shape and fill, trim, layout (crop panels), image overlays and text notes.
   Every change is one undoable set-video-edits command on the caption project's history (no draft / Apply step).
   Drags show a working copy on the small canvases and the trim bar, and commit once on release. */
(() => {
'use strict';
const SHAPES = [
  { keys: ['shorts', 'reels'], ratio: '9:16', name: 'ショート・リール' },
  { keys: ['portrait'], ratio: '4:5', name: '縦長の投稿' },
  { keys: ['square'], ratio: '1:1', name: '正方形' },
  { keys: ['youtube'], ratio: '16:9', name: 'YouTube（横）' },
];
const FITS = [
  { id: 'contain', name: '全体を表示', hint: '動画全体が見え、余白は指定の色になります。' },
  { id: 'cover', name: '画面を埋める', hint: '画面いっぱいに拡大し、はみ出た端は切り取られます。' },
  { id: 'blur', name: 'ぼかし背景', hint: '動画全体が見え、余白には同じ動画をぼかして敷きます。' },
];
const whole = () => ({ x: 0, y: 0, w: 1, h: 1 });
const SIDE_CROP = { x: .6, y: .2, w: .4, h: .8 };
const LAYOUTS = [
  { id: 'full', name: '全体', targets: [] },
  { id: 'stack', name: '上下に分割', targets: [{ x: 0, y: 0, w: 1, h: .5 }, { x: 0, y: .5, w: 1, h: .5 }] },
  { id: 'side', name: '左右に分割', targets: [{ x: 0, y: 0, w: .5, h: 1 }, { x: .5, y: 0, w: .5, h: 1 }] },
  { id: 'pip', name: 'ワイプ', targets: [whole(), { x: .62, y: .62, w: .35, h: .35 }] },
];
const MIN_CLIP = .1;
const round2 = value => Math.round(value * 100) / 100;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const pct = value => `${(value * 100).toFixed(3)}%`;
const sec = value => { const t = Math.max(0, Number(value) || 0), m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(1).padStart(4, '0')}`; };
const sameRect = (a, b) => !!a && !!b && ['x', 'y', 'w', 'h'].every(key => Math.abs(a[key] - b[key]) < 1e-6);
const layoutOf = panels => (LAYOUTS.find(layout => layout.targets.length === panels.length && layout.targets.every((target, i) => sameRect(target, panels[i].target))) || { id: 'custom' }).id;
const ratioName = (w, h) => { if (!(w > 0 && h > 0)) return ''; const known = [[9, 16], [4, 5], [1, 1], [16, 9], [4, 3], [3, 4]].find(([a, b]) => Math.abs(w / h - a / b) < .02); return known ? `${known[0]}:${known[1]}` : `${w} × ${h}`; };

function make(tag, props, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props || {})) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'className') node.className = value;
    else if (key.startsWith('on')) node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) if (child != null) node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}

J.mountVideoEditor = ({ host, project, video, commit, status }) => {
  host.innerHTML = `<section class="vs-section" data-section="shape">
      <h3 class="vs-title">出力の形</h3>
      <div class="vs-shapes" data-edit="shapes" role="radiogroup" aria-label="出力の形"></div>
      <p class="vs-note" data-edit="summary"></p>
      <div class="vs-fit" data-edit="fitRow">
        <h4 class="vs-subtitle">動画の形が出力と違うとき</h4>
        <div class="vs-seg" data-edit="fits" role="radiogroup" aria-label="動画の収め方"></div>
        <label class="vs-inline" data-edit="barRow">余白の色<input data-edit="bars" type="color" value="#000000"></label>
        <p class="vs-note" data-edit="fitNote"></p>
      </div>
    </section>
    <details class="vs-section" data-section="trim" open><summary>トリム</summary>
      <p class="vs-note">明るい部分が書き出されます。端をドラッグして長さを変え、再生位置で分割して不要な区間を削除します。時間は元の動画の時間です。</p>
      <div class="vs-trim" data-edit="trim" aria-label="残す区間"></div>
      <div class="vs-trim-scale"><span>0:00.0</span><strong data-edit="trimTotal"></strong><span data-edit="trimEnd"></span></div>
      <div class="video-edit-buttons">
        <button type="button" class="small" data-action="split">✂ 再生位置で分割</button>
        <button type="button" class="small" data-action="startHere">区間の開始を再生位置に</button>
        <button type="button" class="small" data-action="endHere">区間の終了を再生位置に</button>
        <button type="button" class="small" data-action="removeClip">選択した区間を削除</button>
        <button type="button" class="small" data-action="restoreGap">削除した部分を戻す</button>
        <button type="button" class="small" data-action="full">全体に戻す</button>
      </div>
      <details class="vs-exact"><summary>正確な時間（秒）</summary><div data-edit="clips"></div></details>
    </details>
    <details class="vs-section" data-section="layout"><summary>レイアウトと切り抜き</summary>
      <p class="vs-note">画面を分けて、元の動画の一部を並べます。各パネルは選んだ範囲で画面を埋めます。</p>
      <div class="vs-layouts" data-edit="layouts" role="radiogroup" aria-label="レイアウト"></div>
      <div class="vs-panels" data-edit="panelTools">
        <div class="vs-chips" data-edit="panels" role="toolbar" aria-label="パネル"></div>
        <div class="video-edit-canvases">
          <figure><figcaption>元の動画 · ドラッグで範囲を選ぶ</figcaption><canvas data-edit="source" width="480" height="270" aria-label="切り抜く範囲。キーボードでは下の正確な値を使います"></canvas></figure>
          <figure><figcaption>出力 · ドラッグで移動</figcaption><canvas data-edit="output" width="240" height="426" aria-label="パネルの配置。キーボードでは下の正確な値を使います"></canvas></figure>
        </div>
        <details class="vs-exact"><summary>正確な値（%）</summary><div data-edit="rects"></div></details>
      </div>
    </details>
    <details class="vs-section" data-section="overlays"><summary>画像の重ね合わせ</summary>
      <p class="vs-note">透明部分のある PNG（フレーム・ロゴ・テンプレート）を重ねます。最大4枚。プロジェクトに保存され、テンプレートとして他のプロジェクトでも使えます。</p>
      <div data-edit="overlays"></div>
      <div class="video-edit-buttons"><label class="button-like">PNG を追加<input data-edit="overlayFile" type="file" accept="image/png,image/webp" hidden></label>
        <button type="button" class="small" data-action="saveTemplate">テンプレートを保存</button>
        <label class="button-like">テンプレートを読込<input data-edit="templateFile" type="file" accept="application/json,.json" hidden></label></div>
    </details>
    <details class="vs-section" data-section="notes"><summary>テキストメモ</summary>
      <p class="vs-note">字幕とは別の、シンプルな文字です。それぞれ表示時間と位置を持ち、字幕や他のメモと重なってもかまいません。</p>
      <div data-edit="notes"></div>
      <button type="button" class="small" data-action="note">再生位置にメモを追加</button>
    </details>
    <p class="vs-message" role="status" data-edit="message"></p>`;
  const el = name => host.querySelector(`[data-edit="${name}"]`);
  const section = name => host.querySelector(`[data-section="${name}"]`);
  let selectedClip = 0, selectedPanel = 0, saved = '', mediaDuration = -1, trimDrag = null, crop = null, move = null, working = null, refocus = null;
  const playhead = make('div', { className: 'vs-trim-playhead', 'aria-hidden': 'true' });
  const duration = () => Number(project().media.duration) || 0;
  const now = () => { const source = video(); return source && Number.isFinite(source.currentTime) ? round2(source.currentTime) : 0; };
  // view() is read-only and cheap (overlays can hold megabytes of image data); current() is a deep copy for a command.
  const view = () => { const edit = J.videoEditSettings(project()); return { ...edit, clips: edit.clips || [], panels: edit.panels || [], notes: edit.notes || [] }; };
  const current = () => {
    const edit = JSON.parse(JSON.stringify(J.videoEditSettings(project())));
    for (const key of ['clips', 'panels', 'notes']) if (!Array.isArray(edit[key])) edit[key] = [];
    return edit;
  };
  const withPanels = edit => ({ ...edit, panels: JSON.parse(JSON.stringify(edit.panels)) });
  const clipsOf = edit => edit.clips.length ? edit.clips.map(clip => ({ ...clip })) : [{ start: 0, end: duration() }];
  const say = (text, error) => { const message = el('message'); message.textContent = text || ''; message.classList.toggle('is-error', !!error); if (text && error) status(text, true); };
  /* One command per change. mutate() may throw (shown to the user) or return false (nothing to do). */
  const change = (mutate, done) => {
    const next = current();
    try { if (mutate(next) === false) return false; J.validateVideoEdits(next, duration()); }
    catch (error) { say(error.message, true); render(); return false; }
    working = null;
    if (JSON.stringify(next) === JSON.stringify(J.videoEditSettings(project()))) { render(); return false; }   // nothing changed: no undo step
    if (!commit(next)) { render(); return false; }
    say(''); if (done) status(done);
    return true;
  };
  const needVideo = () => { if (!duration()) throw new Error('先に動画を読み込んでください。'); };
  const capture = (node, event) => { try { node.setPointerCapture(event.pointerId); } catch (_) { /* synthetic or already released pointer */ } };
  const seek = time => { const source = video(); if (source && Number.isFinite(source.duration)) source.currentTime = clamp(time, 0, source.duration); };
  const numberInput = (label, value, onCommit, options = {}) => make('label', {}, label, make('input', { type: 'number', step: options.step || '.01', min: options.min == null ? 0 : options.min, max: options.max, value: String(value),
    onchange: event => { const number = Number(event.target.value); if (event.target.value === '' || !Number.isFinite(number)) { say('数値を入力してください。', true); render(); return; } onCommit(number); } }));

  /* ---------- Output shape and fill ---------- */
  function renderShape(edit) {
    const out = J.videoFormats[edit.format] || J.videoFormats.shorts, media = project().media || {};
    el('shapes').replaceChildren(...SHAPES.map(shape => {
      const on = shape.keys.includes(edit.format), format = J.videoFormats[shape.keys[0]], frame = make('span', { className: 'vs-shape-frame', 'aria-hidden': 'true' });
      frame.style.aspectRatio = `${format.width} / ${format.height}`;
      return make('button', { type: 'button', className: 'vs-shape', role: 'radio', 'aria-checked': String(on), title: `${format.width} × ${format.height}`,
        onclick: () => { if (!on) change(next => { next.format = shape.keys[0]; }, `出力の形を ${shape.ratio} にしました。`); } },
      frame, make('strong', { text: shape.ratio }), make('small', { text: shape.name }));
    }));
    const clips = clipsOf(edit), source = media.width > 0 && media.height > 0 ? `元の動画 ${media.width} × ${media.height}（${ratioName(media.width, media.height)}）· ` : '';
    el('summary').textContent = `${source}出力 ${out.width} × ${out.height} · ${sec(J.videoEditDuration(clips))}`;
    const fit = J.videoEditFit(project()), panels = edit.panels.length > 0;
    const matches = media.width > 0 && media.height > 0 && Math.abs(media.width / media.height - out.width / out.height) < .01;
    el('fitRow').hidden = panels || matches && fit === 'contain';   // nothing to choose when the video already has the output's shape
    el('fits').replaceChildren(...FITS.map(item => make('button', { type: 'button', className: 'small', role: 'radio', 'aria-checked': String(fit === item.id), title: item.hint,
      onclick: () => { if (fit !== item.id) change(next => { next.fit = item.id; }, `動画の収め方を「${item.name}」にしました。`); } }, item.name)));
    el('barRow').hidden = fit !== 'contain'; el('bars').value = edit.background || '#000000';
    el('fitNote').textContent = matches ? '動画はすでに出力と同じ形なので、この設定は変化しません。' : (FITS.find(item => item.id === fit) || FITS[0]).hint;
  }
  el('bars').onchange = event => change(next => { next.background = event.target.value.toLowerCase(); }, '余白の色を変えました。');

  /* ---------- Trim ---------- */
  const handle = (index, side, time) => make('span', { className: `vs-trim-handle is-${side}`, role: 'slider', tabindex: '0', 'data-clip': index, 'data-side': side,
    'aria-label': side === 'start' ? `区間${index + 1}の開始` : `区間${index + 1}の終了`, 'aria-valuemin': '0', 'aria-valuemax': duration().toFixed(2), 'aria-valuenow': time.toFixed(2), 'aria-valuetext': sec(time) });
  function renderTrim(edit) {
    const total = duration(), clips = working && working.clips || clipsOf(edit), bar = el('trim');
    selectedClip = clamp(selectedClip, 0, Math.max(0, clips.length - 1));
    if (!total) {
      bar.replaceChildren(make('span', { className: 'vs-trim-empty', text: '動画を読み込むとトリムできます。' }));
    } else {
      bar.replaceChildren(...clips.map((clip, i) => {
        const block = make('div', { className: 'vs-trim-clip' + (i === selectedClip ? ' is-selected' : ''), 'data-clip': i, title: `区間${i + 1}: ${sec(clip.start)}–${sec(clip.end)}` });
        block.style.left = pct(clip.start / total); block.style.width = pct((clip.end - clip.start) / total);
        block.append(handle(i, 'start', clip.start), make('span', { className: 'vs-trim-label', text: String(i + 1) }), handle(i, 'end', clip.end));
        return block;
      }), playhead);
    }
    const kept = J.videoEditDuration(clips), removed = Math.max(0, total - kept);
    el('trimTotal').textContent = total ? [`書き出し ${sec(kept)}`, clips.length > 1 ? `${clips.length}区間` : '', removed > .005 ? `${sec(removed)} を削除` : ''].filter(Boolean).join(' · ') : '';
    el('trimEnd').textContent = sec(total);
    for (const action of ['split', 'startHere', 'endHere', 'removeClip', 'restoreGap', 'full']) host.querySelector(`[data-action="${action}"]`).disabled = !total;
    host.querySelector('[data-action="removeClip"]').disabled = !total || clips.length < 2;
    host.querySelector('[data-action="full"]').disabled = !edit.clips.length;
    el('clips').replaceChildren(...(total ? clips.map((clip, i) => make('div', { className: 'video-edit-grid' },
      numberInput(`区間${i + 1} 開始`, clip.start, value => setEdge(i, 'start', value), { max: total }),
      numberInput('終了', clip.end, value => setEdge(i, 'end', value), { max: total }))) : []));
    if (refocus) { const target = bar.querySelector(`.vs-trim-handle[data-clip="${refocus.clip}"][data-side="${refocus.side}"]`); refocus = null; if (target && target.focus) target.focus(); }
    paintPlayhead();
  }
  function paintPlayhead() {
    const total = duration(), time = now(), edit = working || view(), clips = clipsOf(edit);
    playhead.style.left = pct(total ? clamp(time / total, 0, 1) : 0);
    const inside = clips.some(clip => time > clip.start + .05 && time < clip.end - .05);
    const split = host.querySelector('[data-action="split"]'), gap = host.querySelector('[data-action="restoreGap"]');
    if (split) split.disabled = !total || !inside;
    if (gap) gap.disabled = !total || !edit.clips.length || clips.some(clip => time >= clip.start && time < clip.end);
  }
  const barTime = event => { const rect = el('trim').getBoundingClientRect(); return rect.width ? clamp((event.clientX - rect.left) / rect.width, 0, 1) * duration() : 0; };
  /* Limits for one edge: never past the other edge (minus MIN_CLIP) or into the neighbouring section. */
  const edgeLimits = (clips, index, side) => side === 'start'
    ? [index ? clips[index - 1].end : 0, clips[index].end - MIN_CLIP]
    : [clips[index].start + MIN_CLIP, index < clips.length - 1 ? clips[index + 1].start : duration()];
  const setEdge = (index, side, value) => change(next => {
    const clips = clipsOf(next), [low, high] = edgeLimits(clips, index, side);
    if (value < low - 1e-6 || value > high + 1e-6) throw new Error(`区間${index + 1}の${side === 'start' ? '開始' : '終了'}時刻は ${sec(low)}〜${sec(high)} の範囲にしてください。`);
    clips[index][side] = round2(value); next.clips = clips;
  }, 'トリムを更新しました。');
  const trim = el('trim');
  trim.onpointerdown = event => {
    if (!duration()) return;
    const knob = event.target.closest && event.target.closest('.vs-trim-handle'), block = event.target.closest && event.target.closest('.vs-trim-clip');
    if (knob) {
      const clips = clipsOf(view()), index = Number(knob.dataset.clip);
      trimDrag = { index, side: knob.dataset.side, clips }; working = { ...view(), clips }; selectedClip = index;
      capture(trim, event);
      if (event.preventDefault) event.preventDefault();
      return;
    }
    if (block) { selectedClip = Number(block.dataset.clip); renderTrim(view()); }
    seek(barTime(event));
  };
  trim.onpointermove = event => {
    if (!trimDrag) return;
    const { clips, index, side } = trimDrag, [low, high] = edgeLimits(clips, index, side);
    clips[index][side] = round2(clamp(barTime(event), low, high));
    renderTrim(view()); seek(clips[index][side]);
  };
  const endTrimDrag = cancel => {
    if (!trimDrag) return;
    const { clips } = trimDrag; trimDrag = null; working = null;
    if (cancel) { renderTrim(view()); return; }
    change(next => { if (JSON.stringify(clipsOf(next)) === JSON.stringify(clips)) return false; next.clips = clips; }, 'トリムを更新しました。');
    renderTrim(view());
  };
  trim.onpointerup = () => endTrimDrag(false);
  trim.onpointercancel = () => endTrimDrag(true);
  trim.onkeydown = event => {
    const knob = event.target.closest && event.target.closest('.vs-trim-handle');
    if (!knob || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = Number(knob.dataset.clip), side = knob.dataset.side, clips = clipsOf(view()), [low, high] = edgeLimits(clips, index, side);
    const step = event.shiftKey ? 1 : .1, value = event.key === 'Home' ? low : event.key === 'End' ? high : clips[index][side] + (event.key === 'ArrowLeft' ? -step : step);
    clips[index][side] = round2(clamp(value, low, high)); selectedClip = index; refocus = { clip: index, side };
    if (change(next => { next.clips = clips; })) seek(clips[index][side]); else refocus = null;
  };

  /* ---------- Layout and crop ---------- */
  function layoutIcon(targets) {
    const icon = make('span', { className: 'vs-layout-icon', 'aria-hidden': 'true' });
    for (const target of targets.length ? targets : [whole()]) {
      const cell = make('span'); cell.style.left = pct(target.x); cell.style.top = pct(target.y); cell.style.width = pct(target.w); cell.style.height = pct(target.h); icon.append(cell);
    }
    return icon;
  }
  function renderLayout(edit) {
    const panels = working && working.panels || edit.panels, active = layoutOf(panels), out = J.videoFormats[edit.format] || J.videoFormats.shorts;
    el('layouts').replaceChildren(...LAYOUTS.map(layout => {
      const icon = layoutIcon(layout.targets); icon.style.aspectRatio = `${out.width} / ${out.height}`;
      return make('button', { type: 'button', className: 'vs-layout', role: 'radio', 'aria-checked': String(active === layout.id),
        onclick: () => { if (active !== layout.id) change(next => {
          // Keep the crops the user already chose when switching between split layouts.
          next.panels = layout.targets.map((target, i) => ({ source: next.panels[i] ? next.panels[i].source : i ? { ...SIDE_CROP } : whole(), target: { ...target } }));
          selectedPanel = 0;
        }, `レイアウトを「${layout.name}」にしました。`); } }, icon, make('small', { text: layout.name }));
    }), ...(active === 'custom' ? [make('span', { className: 'vs-layout is-custom', role: 'radio', 'aria-checked': 'true' }, layoutIcon(panels.map(panel => panel.target)), make('small', { text: 'カスタム' }))] : []));
    el('panelTools').hidden = !panels.length;
    selectedPanel = clamp(selectedPanel, 0, Math.max(0, panels.length - 1));
    el('panels').replaceChildren(...panels.map((_, i) => make('button', { type: 'button', className: 'small', 'aria-pressed': String(i === selectedPanel), onclick: () => { selectedPanel = i; renderLayout(view()); } }, `パネル${i + 1}`)),
      make('button', { type: 'button', className: 'small', onclick: () => change(next => { next.panels.push({ source: whole(), target: { x: .25, y: .25, w: .5, h: .5 } }); selectedPanel = next.panels.length - 1; }, 'パネルを追加しました。') }, '＋ パネル'),
      make('button', { type: 'button', className: 'small danger', disabled: !panels.length, onclick: () => change(next => { next.panels.splice(selectedPanel, 1); selectedPanel = Math.max(0, selectedPanel - 1); }, 'パネルを削除しました。') }, '選択したパネルを削除'));
    const panel = panels[selectedPanel];
    el('rects').replaceChildren(...(panel ? [['source', '切り抜く範囲'], ['target', '出力での位置']].map(([key, title]) => make('fieldset', { className: 'video-edit-grid' }, make('legend', { text: `${title}（%）` }),
      ...[['x', '左'], ['y', '上'], ['w', '幅'], ['h', '高さ']].map(([field, label]) => numberInput(label, +(panel[key][field] * 100).toFixed(2),
        value => change(next => { next.panels[selectedPanel][key][field] = value / 100; }, 'パネルを更新しました。'), { max: 100, step: '.5' })))) : []));
    paint();
  }
  function paint() {
    paintPlayhead();
    const layout = section('layout');
    if (!layout || !layout.open) return;
    const edit = working || view(), source = video(), canvas = el('source'), ctx = canvas.getContext && canvas.getContext('2d');
    if (!ctx || !edit.panels.length) return;
    if (!source || source.readyState < 2) { ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
    const height = Math.round(canvas.width * source.videoHeight / source.videoWidth);
    if (canvas.height !== height) canvas.height = height;
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    edit.panels.forEach((panel, i) => {
      const r = panel.source; ctx.strokeStyle = i === selectedPanel ? '#f5a50c' : '#49d9ef'; ctx.lineWidth = 2;
      ctx.strokeRect(r.x * canvas.width, r.y * canvas.height, r.w * canvas.width, r.h * canvas.height);
      ctx.fillStyle = ctx.strokeStyle; ctx.font = 'bold 16px sans-serif'; ctx.fillText(String(i + 1), r.x * canvas.width + 5, r.y * canvas.height + 18);
    });
    const output = el('output'), format = J.videoFormats[edit.format] || J.videoFormats.shorts, out = output.getContext('2d');
    const outHeight = Math.round(output.width * format.height / format.width); if (output.height !== outHeight) output.height = outHeight;
    // Invalid intermediate values must never break the live preview.
    try {
      const draft = { ...project(), settings: { ...project().settings, videoEdit: edit } };
      J.drawVideoEdit(out, source, output.width, output.height, draft);
      J.drawVideoOverlays(out, draft, 'all', { designWidth: output.width, designHeight: output.height });
      const panel = edit.panels[selectedPanel];
      if (panel) { const t = panel.target; out.strokeStyle = '#f5a50c'; out.lineWidth = 2; out.strokeRect(t.x * output.width, t.y * output.height, t.w * output.width, t.h * output.height); }
    } catch (_) { out.fillStyle = '#111'; out.fillRect(0, 0, output.width, output.height); }
  }
  section('layout').ontoggle = () => paint();
  const unit = (canvas, event, bounded) => {
    const rect = canvas.getBoundingClientRect(); if (!(rect.width > 0 && rect.height > 0)) return null;   // not laid out (hidden tab)
    const x = (event.clientX - rect.left) / rect.width, y = (event.clientY - rect.top) / rect.height; return bounded ? { x: clamp(x, 0, 1), y: clamp(y, 0, 1) } : { x, y };
  };
  const commitDrag = done => { const panels = working && working.panels; working = null; if (panels) change(next => { next.panels = panels; }, done); };
  el('source').onpointerdown = event => {
    const edit = view(); if (!edit.panels[selectedPanel]) return;
    crop = unit(el('source'), event, true); if (!crop) return; working = withPanels(edit); capture(el('source'), event);
  };
  el('source').onpointermove = event => {
    if (!crop || !working) return;
    const p = unit(el('source'), event, true); if (!p) return;
    const w = Math.abs(p.x - crop.x), h = Math.abs(p.y - crop.y);
    if (w > .01 && h > .01) working.panels[selectedPanel].source = { x: Math.min(p.x, crop.x), y: Math.min(p.y, crop.y), w, h };
    paint();
  };
  el('source').onpointerup = () => { if (!crop) return; crop = null; commitDrag('切り抜く範囲を更新しました。'); };
  el('source').onpointercancel = () => { crop = null; working = null; paint(); };
  el('output').onpointerdown = event => {
    const edit = view(), p = unit(el('output'), event, false); if (!p) return;
    const index = edit.panels.findLastIndex(panel => { const t = panel.target; return p.x >= t.x && p.x <= t.x + t.w && p.y >= t.y && p.y <= t.y + t.h; });
    if (index < 0) return;
    if (index !== selectedPanel) { selectedPanel = index; renderLayout(edit); }
    move = { point: p, target: { ...edit.panels[index].target } }; working = withPanels(edit); capture(el('output'), event); paint();
  };
  el('output').onpointermove = event => {
    if (!move || !working) return;
    const p = unit(el('output'), event, false); if (!p) return;
    const t = working.panels[selectedPanel].target;
    t.x = clamp(move.target.x + p.x - move.point.x, 0, 1 - t.w); t.y = clamp(move.target.y + p.y - move.point.y, 0, 1 - t.h); paint();
  };
  el('output').onpointerup = () => { if (!move) return; move = null; commitDrag('パネルを移動しました。'); };
  el('output').onpointercancel = () => { move = null; working = null; paint(); };

  /* ---------- Overlays ---------- */
  function renderOverlays(edit) {
    const overlays = edit.overlays || [];
    el('overlays').replaceChildren(...overlays.map((overlay, i) => {
      const set = (fields, done) => change(next => { Object.assign(next.overlays[i], fields); }, done);
      const opacity = make('input', { type: 'range', min: '0', max: '100', value: String(Math.round(overlay.opacity * 100)), 'aria-label': '不透明度',
        onchange: event => set({ opacity: Number(event.target.value) / 100 }, '不透明度を変えました。') });
      return make('div', { className: 'vs-overlay' },
        make('img', { src: overlay.src, alt: '' }),
        make('div', { className: 'vs-overlay-body' },
          make('strong', { text: overlay.name || `画像${i + 1}` }),
          make('label', { className: 'vs-inline' }, '不透明度', opacity),
          make('div', { className: 'vs-seg', role: 'radiogroup', 'aria-label': '重ねる順番' }, ...[['below', '字幕の下', '画像を字幕の下にしました。'], ['above', '字幕の上', '画像を字幕の上にしました。']].map(([layer, name, done]) =>
            make('button', { type: 'button', className: 'small', role: 'radio', 'aria-checked': String(overlay.layer === layer), onclick: () => { if (overlay.layer !== layer) set({ layer }, done); } }, name))),
          make('div', { className: 'video-edit-buttons' },
            make('button', { type: 'button', className: 'small', onclick: () => set({ x: 0, y: 0, w: 1, h: 1 }, '画像を画面いっぱいにしました。') }, '画面いっぱいに'),
            make('button', { type: 'button', className: 'small danger', onclick: () => change(next => { next.overlays.splice(i, 1); }, '画像を削除しました。') }, '削除')),
          make('details', { className: 'vs-exact' }, make('summary', { text: '位置と大きさ（%）' }), make('div', { className: 'video-edit-grid' },
            ...[['x', '左'], ['y', '上'], ['w', '幅'], ['h', '高さ']].map(([key, label]) => numberInput(label, +(overlay[key] * 100).toFixed(2), value => set({ [key]: value / 100 }, '画像の位置を更新しました。'), { min: -200, max: 400, step: '.5' }))))));
    }));
  }
  const readDataUrl = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('画像を読み込めませんでした。')); reader.readAsDataURL(file); });
  const decode = src => new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('読み込める画像ではありません。')); image.src = src; });
  const nextOverlayId = overlays => { const used = new Set(overlays.map(overlay => overlay.id)); let n = 1; while (used.has(`overlay_${n}`)) n++; return `overlay_${n}`; };
  el('overlayFile').onchange = async () => {
    const file = el('overlayFile').files[0]; el('overlayFile').value = ''; if (!file) return;
    try {
      const overlays = view().overlays || [];
      if (overlays.length >= J.VIDEO_OVERLAY_LIMIT) throw new Error(`画像は${J.VIDEO_OVERLAY_LIMIT}枚までです。`);
      if (!/^image\/(png|webp)$/.test(file.type)) throw new Error('透明部分のある PNG（または WebP）を選んでください。');
      const src = await readDataUrl(file); if (src.length > J.VIDEO_OVERLAY_MAX_CHARS) throw new Error('画像が大きすぎます（約6 MBまで）。');
      const image = await decode(src), format = J.videoOutputSize(project());
      // Contain-fit at full width or height; a frame the same shape as the output fills it exactly.
      const scale = Math.min(format.width / image.naturalWidth, format.height / image.naturalHeight), w = image.naturalWidth * scale / format.width, h = image.naturalHeight * scale / format.height;
      await J.preloadVideoOverlays({ settings: { videoEdit: { overlays: [{ src }] } } });
      change(next => { next.overlays = next.overlays || []; next.overlays.push({ id: nextOverlayId(next.overlays), name: file.name.slice(0, 200), src, x: (1 - w) / 2, y: (1 - h) / 2, w, h, opacity: 1, layer: 'below' }); }, '画像を追加しました。');
    } catch (error) { say(error.message, true); }
  };
  el('templateFile').onchange = async () => {
    const file = el('templateFile').files[0]; el('templateFile').value = ''; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data || data.kind !== 'jizura-overlay-template' || !Array.isArray(data.overlays)) throw new Error('JIZURA の重ね合わせテンプレートではありません。');
      J.validateVideoOverlays(data.overlays);
      await J.preloadVideoOverlays({ settings: { videoEdit: { overlays: data.overlays } } });
      change(next => { next.overlays = data.overlays; }, 'テンプレートを読み込みました。');
    } catch (error) { say(error.message, true); }
  };

  /* ---------- Notes ---------- */
  function renderNotes(edit) {
    el('notes').replaceChildren(...edit.notes.map((note, i) => {
      const set = (key, value) => change(next => {
        const edited = { ...next.notes[i], [key]: value };
        if (!String(edited.text).trim()) throw new Error('メモの文字を入力してください。');
        if (!(edited.end > edited.start && edited.start >= 0 && edited.end <= duration())) throw new Error(`メモは 0:00.0〜${sec(duration())} の中で、終了を開始より後にしてください。`);
        next.notes[i] = edited;
      }, 'メモを更新しました。');
      return make('fieldset', { className: 'video-edit-grid vs-note-row' }, make('legend', { text: `メモ${i + 1}` }),
        make('label', { className: 'vs-wide' }, '文字', make('textarea', { rows: '2', onchange: event => set('text', event.target.value) }, note.text)),
        numberInput('開始（秒）', note.start, value => set('start', value)), numberInput('終了（秒）', note.end, value => set('end', value)),
        numberInput('横位置（%）', +(note.x * 100).toFixed(1), value => set('x', value / 100), { max: 100, step: '1' }), numberInput('縦位置（%）', +(note.y * 100).toFixed(1), value => set('y', value / 100), { max: 100, step: '1' }),
        numberInput('文字の大きさ（%）', note.size, value => set('size', value), { min: 1, max: 15, step: '.5' }),
        make('label', {}, '色', make('input', { type: 'color', value: note.color, onchange: event => set('color', event.target.value.toLowerCase()) })),
        make('button', { type: 'button', className: 'small danger', onclick: () => change(next => { next.notes.splice(i, 1); }, 'メモを削除しました。') }, 'メモを削除'));
    }));
  }

  /* ---------- Buttons ---------- */
  host.addEventListener('click', event => {
    const action = event.target.dataset && event.target.dataset.action; if (!action) return;
    try {
      const total = duration(), time = now();
      if (action === 'split') {
        needVideo();
        change(next => {
          const clips = clipsOf(next), index = clips.findIndex(clip => time > clip.start + .05 && time < clip.end - .05);
          if (index < 0) throw new Error('再生位置を、残す区間の中（端から少し離れた位置）に置いてください。');
          clips.splice(index, 1, { start: clips[index].start, end: time }, { start: time, end: clips[index].end });
          next.clips = clips; selectedClip = index + 1;
        }, `${sec(time)} で分割しました。`);
      }
      if (action === 'startHere' || action === 'endHere') {
        needVideo();
        const side = action === 'startHere' ? 'start' : 'end';
        setEdge(selectedClip, side, time);
      }
      if (action === 'removeClip') change(next => {
        const clips = clipsOf(next); if (clips.length < 2) throw new Error('最後の区間は削除できません。');
        clips.splice(selectedClip, 1); next.clips = clips; selectedClip = Math.max(0, selectedClip - 1);
      }, '区間を削除しました。');
      if (action === 'restoreGap') change(next => {
        const clips = clipsOf(next), after = clips.findIndex(clip => clip.start > time), before = after < 0 ? clips.length - 1 : after - 1;
        if (clips.some(clip => time >= clip.start && time < clip.end)) throw new Error('再生位置を、削除した部分（縞模様の部分）に置いてください。');
        if (before >= 0 && after >= 0) clips.splice(before, 2, { start: clips[before].start, end: clips[after].end });
        else if (after >= 0) clips[after].start = 0;
        else clips[before].end = total;
        next.clips = clips.length === 1 && clips[0].start === 0 && Math.abs(clips[0].end - total) < .001 ? [] : clips;
      }, '削除した部分を戻しました。');
      if (action === 'full') change(next => { next.clips = []; selectedClip = 0; }, '動画全体に戻しました。');
      if (action === 'saveTemplate') {
        const overlays = view().overlays || [];
        if (!overlays.length) throw new Error('先に画像を追加してください。');
        J.saveFile('jizura-overlay-template.json', JSON.stringify({ kind: 'jizura-overlay-template', version: 1, overlays }));
      }
      if (action === 'note') {
        needVideo();
        const start = Math.min(time, Math.max(0, total - .1));
        change(next => { next.notes.push({ text: '新しいメモ', start, end: Math.min(total, start + 3), x: .5, y: .18 + (next.notes.length % 5) * .12, size: 4, color: '#ffffff' }); }, 'メモを追加しました。');
      }
    } catch (error) { say(error.message, true); }
  });

  function render() {
    const edit = view();
    renderShape(edit); renderTrim(edit); renderLayout(edit); renderOverlays(edit); renderNotes(edit);
  }
  function refresh() {
    const value = JSON.stringify(J.videoEditSettings(project()));
    if (value !== saved || mediaDuration !== project().media.duration) { saved = value; mediaDuration = project().media.duration; if (!trimDrag && !crop && !move) working = null; render(); }
  }
  refresh(); return { refresh, paint };
};
})();
