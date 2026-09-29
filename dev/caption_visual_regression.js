/* Gate 3.6 deterministic SVG visual regression harness.
   Run with --update to intentionally replace committed baselines. */
'use strict';
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const baselineDir = path.join(__dirname, 'fixtures', 'visual', 'caption-gate-3');
global.window = globalThis;
global.document = { fonts: { check: () => true, add: () => {}, ready: Promise.resolve() }, createElement: () => ({ getContext: () => ({ measureText: text => ({ width: Array.from(String(text)).length * 57 }) }) }) };
for (const name of fs.readdirSync(path.join(root, 'src')).filter(name => name.endsWith('.js') && name !== '12_ui.js').sort()) {
  const filename = path.join(root, 'src', name); vm.runInThisContext(fs.readFileSync(filename, 'utf8'), { filename });
}

const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const slug = value => value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const tokenise = (words, start, duration) => words.map((text, index) => {
  const step = duration / words.length, tokenStart = start + index * step;
  return { id: `t${index + 1}`, text, start: +tokenStart.toFixed(3), end: +(tokenStart + step * 0.78).toFixed(3) };
});
const phaseTime = (phase, tokens) => {
  const first = tokens[0], middle = tokens[Math.floor(tokens.length / 2)], last = tokens[tokens.length - 1];
  if (phase === 'entry') return first.start + 0.03;
  if (phase === 'active') return (middle.start + middle.end) / 2;
  if (phase === 'hold') return Math.min(last.start - 0.02, middle.end + 0.08);
  if (phase === 'exit') return last.end - 0.02;
  return last.end;
};

const baseScenes = [
  ['portrait-entry', 1080, 1920, 'creator', 'captionBottomStack', 'entry', ['Captions', 'stay', 'clear.']],
  ['portrait-active', 1080, 1920, 'creator', 'captionBottomTwoLine', 'active', ['Words', 'follow', 'speech', 'smoothly.']],
  ['portrait-hold', 1080, 1920, 'punchy', 'captionCenterStack', 'hold', ['Make', 'this', 'moment', 'count.']],
  ['portrait-exit', 1080, 1920, 'jizura-mv', 'captionTwoLinePunch', 'exit', ['Leave', 'on', 'the', 'beat.']],
  ['portrait-transition', 1080, 1920, 'punchy', 'captionSingleWordHero', 'transition', ['NOW']],
  ['landscape-entry', 1920, 1080, 'creator', 'captionLeftAnchor', 'entry', ['Landscape', 'captions', 'enter', 'softly.']],
  ['landscape-active', 1920, 1080, 'creator', 'captionRightAnchor', 'active', ['Active', 'words', 'stay', 'anchored.']],
  ['landscape-hold', 1920, 1080, 'punchy', 'captionCenterStack', 'hold', ['Short', 'and', 'bold.']],
  ['landscape-exit', 1920, 1080, 'jizura-mv', 'captionTwoLinePunch', 'exit', ['Expressive', 'but', 'still', 'readable.']],
  ['landscape-transition', 1920, 1080, 'creator', 'captionBottomStack', 'transition', ['Next', 'caption.']],
];
const edgeScenes = [
  ['edge-long-text', 1080, 1920, 'creator', 'captionBottomTwoLine', 'active', ['A', 'longer', 'caption', 'must', 'remain', 'inside', 'the', 'safe', 'area.']],
  ['edge-emoji', 1080, 1920, 'creator', 'captionCenterStack', 'active', ['Ready', 'to', 'create', '✨']],
  ['edge-cjk', 1080, 1920, 'jizura-mv', 'captionCenterStack', 'active', ['字幕は', '読みやすく', '同期する。']],
  ['edge-numbers', 1920, 1080, 'punchy', 'captionTwoLinePunch', 'active', ['We', 'made', '42%', 'more.']],
  ['edge-min-duration', 1080, 1920, 'punchy', 'captionSingleWordHero', 'active', ['GO']],
  ['edge-max-words', 1080, 1920, 'creator', 'captionBottomTwoLine', 'hold', ['one', 'clear', 'caption', 'with', 'six', 'words']],
];
const scenes = baseScenes.concat(edgeScenes).map(([id, width, height, profile, layout, phase, words]) => ({ id, width, height, profile, layout, phase, words }));

const profileFor = id => J.CAPTION_STYLE_PROFILES[id];
const render = scene => {
  const profile = profileFor(scene.profile), frame = { width: scene.width, height: scene.height };
  const kind = scene.layout.includes('Center') || scene.layout.includes('Hero') ? 'center' : 'bottom';
  const zone = J.createCaptionZone(kind, frame);
  const duration = scene.id === 'edge-min-duration' ? 0.35 : Math.max(1.2, scene.words.length * 0.42);
  const tokens = tokenise(scene.words, 0.2, duration), clock = phaseTime(scene.phase, tokens);
  const text = scene.words.join(' '), layout = J.LAYOUTS[scene.layout];
  const composed = layout.measure({ text, font: profile.font, fontSize: profile.fontSize, zone, frame, tokens, clockTime: clock });
  const state = J.captionTokenStatesAt(tokens, clock), active = state.activeTokenId;
  const activeTreatment = profile.activeTreatments[0], activeStyle = J.resolveCaptionActiveStyle(activeTreatment, active ? 'active' : 'upcoming', { accentColor: profile.accentColor });
  const anchor = composed.anchor, textAnchor = anchor.align === 'left' ? 'start' : anchor.align === 'right' ? 'end' : 'middle';
  const startY = anchor.y - (composed.lines.length - 1) * composed.lineHeight / 2;
  let wordIndex = 0;
  const lines = composed.lines.map((line, lineIndex) => {
    const parts = line.split(/(\s+)/u).filter(Boolean);
    const spans = parts.map(part => {
      if (/^\s+$/u.test(part)) return esc(part);
      const token = tokens[wordIndex++], isActive = token && token.id === active;
      const color = isActive ? activeStyle.color || profile.accentColor : profile.textColor;
      const weight = isActive && activeStyle.weight || 650;
      return `<tspan fill="${color}" font-weight="${weight}">${esc(part)}</tspan>`;
    }).join('');
    return `<text x="${anchor.x}" y="${+(startY + lineIndex * composed.lineHeight).toFixed(3)}" text-anchor="${textAnchor}" dominant-baseline="middle" font-family="sans-serif" font-size="${composed.fontSize}" fill="${profile.textColor}">${spans}</text>`;
  }).join('\n  ');
  const plateWidth = Math.min(zone.width, Math.max(...composed.lines.map(line => line.length * composed.fontSize * 0.58)) + composed.fontSize * 0.7);
  const plateHeight = composed.lines.length * composed.lineHeight + composed.fontSize * 0.45;
  const plateX = anchor.align === 'left' ? anchor.x : anchor.align === 'right' ? anchor.x - plateWidth : anchor.x - plateWidth / 2;
  const phaseLabel = `${scene.profile} · ${scene.layout} · ${scene.phase} · t=${clock.toFixed(3)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${frame.width}" height="${frame.height}" viewBox="0 0 ${frame.width} ${frame.height}">
  <rect width="${frame.width}" height="${frame.height}" fill="#20242d"/>
  <rect x="0" y="0" width="${frame.width}" height="${frame.height}" fill="url(#bg)"/>
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#354052"/><stop offset="1" stop-color="#11151d"/></linearGradient></defs>
  <rect x="${zone.x}" y="${zone.y}" width="${zone.width}" height="${zone.height}" fill="none" stroke="#ffffff" stroke-opacity="0.16" stroke-width="2" stroke-dasharray="12 12"/>
  <rect x="${+plateX.toFixed(3)}" y="${+(anchor.y - plateHeight / 2).toFixed(3)}" width="${+plateWidth.toFixed(3)}" height="${+plateHeight.toFixed(3)}" rx="${+(composed.fontSize * 0.22).toFixed(3)}" fill="${profile.backgroundColor}" fill-opacity="0.82"/>
  ${lines}
  <text x="${zone.x}" y="${Math.max(24, zone.y - 18)}" font-family="monospace" font-size="18" fill="#ffffff" fill-opacity="0.62">${esc(phaseLabel)}</text>
</svg>\n`;
};

const snapshots = Object.fromEntries(scenes.map(scene => [`${slug(scene.id)}.svg`, render(scene)]));
const manifest = {
  version: 1, gate: '3.6', format: 'deterministic-svg',
  coverage: { phases: ['entry', 'active', 'hold', 'exit', 'transition'], orientations: ['portrait', 'landscape'], profiles: ['creator', 'punchy', 'jizura-mv'],
    edgeCases: ['long-text', 'emoji', 'cjk', 'numbers', 'minimum-duration', 'maximum-words'] },
  snapshots: Object.fromEntries(Object.entries(snapshots).map(([file, svg]) => [file, hash(svg)])),
};
const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;

if (process.argv.includes('--update')) {
  fs.mkdirSync(baselineDir, { recursive: true });
  for (const [file, svg] of Object.entries(snapshots)) fs.writeFileSync(path.join(baselineDir, file), svg);
  fs.writeFileSync(path.join(baselineDir, 'manifest.json'), manifestText);
  console.log(`Updated ${Object.keys(snapshots).length} Gate 3.6 visual baselines.`);
} else {
  assert.ok(fs.existsSync(path.join(baselineDir, 'manifest.json')), 'visual baselines are missing; run npm run update:visual-captions');
  assert.equal(fs.readFileSync(path.join(baselineDir, 'manifest.json'), 'utf8'), manifestText, 'visual manifest changed; inspect output and update intentionally');
  for (const [file, svg] of Object.entries(snapshots)) {
    const target = path.join(baselineDir, file);
    assert.ok(fs.existsSync(target), `missing visual baseline ${file}`);
    assert.equal(fs.readFileSync(target, 'utf8'), svg, `visual regression in ${file}`);
  }
  assert.deepStrictEqual(new Set(baseScenes.map(scene => scene[5])), new Set(manifest.coverage.phases));
  assert.equal(Object.keys(snapshots).length, 16);
  console.log(`Gate 3.6 visual regression passed (${Object.keys(snapshots).length} deterministic SVG frames).`);
}
