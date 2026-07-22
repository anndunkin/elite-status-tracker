#!/usr/bin/env node
'use strict';
// Copy runtime JSON assets that tsc does not emit (resolveJsonModule requires
// the file to exist next to the compiled JS at runtime / inside the asar).
const fs = require('fs');
const path = require('path');

const srcDir = path.resolve(__dirname, '..', 'electron');
const outDir = path.resolve(__dirname, '..', 'electron', 'dist');
fs.mkdirSync(outDir, { recursive: true });

for (const file of ['seedTrips.json']) {
  const src = path.join(srcDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(outDir, file));
    console.log('copied', file, '-> electron/dist/');
  }
}
