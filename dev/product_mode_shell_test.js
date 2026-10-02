/* Dependency-free structural tests for Gate 5.1 product mode shell. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const body = fs.readFileSync(path.join(root, 'app', 'body.html'), 'utf8');
const shell = fs.readFileSync(path.join(root, 'src', '11z_product_shell.js'), 'utf8');

const modeMatches = [...body.matchAll(/data-product-mode="([^"]+)"/g)].map(match => match[1]);
assert.deepStrictEqual(modeMatches, ['video-captions', 'lyrics'], 'shell must expose exactly the two product modes in product order');
assert.match(body, /id="lyricMotionWorkspace"/, 'preserved Lyric Motion editor has no workspace boundary');
assert.match(body, /id="videoCaptionsWorkspace"[^>]*hidden/, 'Video Captions workspace must have its own initially hidden surface');
assert.doesNotMatch(body, /live-captions|liveCaptionsWorkspace/, 'live captions remnants in shell');
assert.match(shell, /jizura\.productMode\.v1/, 'mode selection is not persisted independently');
assert.match(shell, /ArrowLeft.*ArrowRight.*Home.*End/, 'tab keyboard navigation is incomplete');
assert.match(shell, /jizura:product-mode/, 'mode changes do not expose an integration event');
assert.match(shell, /\/\* The assembled script[\s\S]*\ninit\(\);\n\}\)\(\);/, 'product shell waits too late to bind in the single-file build');

assert.match(shell, /const LYRIC_MOTION_ENABLED = false;/, 'Lyric Motion must be hidden behind the flag');
assert.match(shell, /DEFAULT_MODE = LYRIC_MOTION_ENABLED \? 'lyrics' : 'video-captions'/, 'default mode must be Video Captions while the flag is off');
assert.match(shell, /nav\.hidden = !LYRIC_MOTION_ENABLED/, 'mode switch must be hidden while the flag is off');

console.log('Gate 5.1 product mode shell tests passed.');
