/* Runs every suite, keeps going after failures, and reports all of them.
   Usage: node run_all.js [name-filter] */
'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const pkg = require('./package.json');

/* video_edits_browser_test.js needs playwright; run it manually. Order: lyric guard first, then the historical chain. Suites not in the chain follow. */
const ordered = pkg.scripts['test:chain'].split('&&').map(part => part.trim().replace(/^node\s+/, ''));
const extras = ['caption_accessibility_ui_test.js', 'caption_editing_ui_test.js', 'caption_preview_integration_test.js',
  'caption_project_lifecycle_test.js', 'caption_style_controls_test.js', 'caption_timeline_ui_test.js',
  'caption_workbench_test.js', 'caption_style_file_test.js', 'caption_plan_snapshot_test.js', 'product_mode_shell_test.js', 'caption_schema_v3_test.js', 'caption_boxes_test.js', 'caption_roles_test.js', 'caption_tracks_test.js', 'caption_text_blocks_test.js', 'caption_timing_commands_test.js', 'caption_timeline_model_test.js', 'caption_look_test.js', 'video_settings_test.js'];
const suites = [...new Set([...ordered, ...extras])].filter(name => !process.argv[2] || name.includes(process.argv[2]));

const results = [];
for (const suite of suites) {
  const started = Date.now();
  const run = spawnSync(process.execPath, [path.join(__dirname, suite)], { cwd: __dirname, encoding: 'utf8', timeout: 300000 });
  const ok = run.status === 0;
  results.push({ suite, ok, ms: Date.now() - started, output: (run.stdout || '') + (run.stderr || '') });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${suite}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
}
const failed = results.filter(result => !result.ok);
for (const result of failed) console.log(`\n--- ${result.suite} ---\n${result.output.split('\n').slice(0, 25).join('\n')}`);
console.log(`\n${results.length - failed.length}/${results.length} suites passed.${failed.length ? ' Failed: ' + failed.map(f => f.suite).join(', ') : ''}`);
process.exit(failed.length ? 1 : 0);
