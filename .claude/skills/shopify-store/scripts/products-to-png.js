#!/usr/bin/env node
/**
 * Convert source product art (SVG/PNG/JPG) to Shopify-ready PNGs:
 * square, padded on a clean background, optimized for web.
 *
 * USAGE:
 *   npm install sharp
 *   node products-to-png.js [--in ./products] [--out ./png-exports] [--size 1200] [--bg "#f8f8f8"]
 *
 * Defaults: in=./products, out=./png-exports, size=1200, bg=#f8f8f8
 */
'use strict';
const fs = require('fs');
const path = require('path');

let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('✗ sharp not installed. Run: npm install sharp');
  process.exit(1);
}

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : d;
};
const IN = path.resolve(opt('in', 'products'));
const OUT = path.resolve(opt('out', 'png-exports'));
const SIZE = parseInt(opt('size', '1200'), 10);
const BG = opt('bg', '#f8f8f8');

function hexToRgb(h) {
  const m = h.replace('#', '');
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
    alpha: 1,
  };
}

if (!fs.existsSync(IN)) {
  console.error(`✗ input dir not found: ${IN}`);
  process.exit(1);
}
fs.mkdirSync(OUT, { recursive: true });

const exts = ['.svg', '.png', '.jpg', '.jpeg', '.webp'];
const files = fs
  .readdirSync(IN)
  .filter((f) => exts.includes(path.extname(f).toLowerCase()) && !f.startsWith('.'));

if (files.length === 0) {
  console.error(`✗ no source images in ${IN}`);
  process.exit(1);
}

(async () => {
  console.log(`Converting ${files.length} images → ${SIZE}×${SIZE} PNG (bg ${BG})\n`);
  let ok = 0,
    fail = 0;
  for (const f of files) {
    const out = path.join(OUT, f.replace(path.extname(f), '.png'));
    try {
      await sharp(path.join(IN, f))
        .resize(SIZE, SIZE, { fit: 'contain', background: hexToRgb(BG) })
        .flatten({ background: hexToRgb(BG) })
        .png({ quality: 90, compressionLevel: 9 })
        .toFile(out);
      const kb = (fs.statSync(out).size / 1024).toFixed(0);
      console.log(`✓ ${f} → ${path.basename(out)} (${kb} KB)`);
      ok++;
    } catch (e) {
      console.error(`✗ ${f}: ${e.message}`);
      fail++;
    }
  }
  console.log(`\nDone. OK: ${ok}  Failed: ${fail}\nOutput: ${OUT}`);
})();
