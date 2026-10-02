'use strict';
/* The Video Captions workbench is split over several files (12bo … 12bw plus 12c_caption_workbench.js).
   Structural tests that read its source use this to get all of it as one string. */
const fs = require('node:fs');
const path = require('node:path');
const WORKBENCH_FILE = /^12b[o-w]_caption_.*\.js$|^12c_caption_workbench\.js$/;
function workbenchFiles(root) { return fs.readdirSync(path.join(root, 'src')).filter(name => WORKBENCH_FILE.test(name)).sort(); }
function workbenchSource(root) { return workbenchFiles(root).map(name => fs.readFileSync(path.join(root, 'src', name), 'utf8')).join('\n'); }
module.exports = { workbenchFiles, workbenchSource };
