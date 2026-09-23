/**
 * Draws the QR code that the README shows, so a phone can open the published
 * app by pointing its camera at the page.
 *
 *   node tools/make-qr.mjs [url] [docs/qr-app.png]
 *
 * The address defaults to SITE_URL in src/core/version.js, which is where every
 * other link to the app comes from too.
 *
 * The encoder itself lives in src/core/qr.js, because the app uses it too; this
 * tool only turns a symbol into a picture. Level Q is used: a quarter of the
 * symbol can be lost and it still scans, which a printed code needs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodePng } from './png.mjs';
import { encodeQr } from '../src/core/qr.js';

// --------------------------------------------------------------- the picture

/** Draws the symbol as a PNG, with the quiet zone the specification asks for. */
function toPng(modules, { scale = 8, quiet = 4 } = {}) {
  const size = modules.length;
  const pixels = (size + quiet * 2) * scale;
  const rgba = Buffer.alloc(pixels * pixels * 4, 0xff); // white, opaque
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      if (!modules[row][column]) continue;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const y = (row + quiet) * scale + dy;
          const x = (column + quiet) * scale + dx;
          const at = (y * pixels + x) * 4;
          rgba[at] = 0x17;
          rgba[at + 1] = 0x1a;
          rgba[at + 2] = 0x21;
        }
      }
    }
  }
  return encodePng(pixels, pixels, rgba);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function siteUrl() {
  const text = readFileSync(join(root, 'src', 'core', 'version.js'), 'utf8');
  const match = text.match(/SITE_URL\s*=\s*'([^']+)'/);
  if (!match) throw new Error('SITE_URL not found in src/core/version.js');
  return match[1];
}

// Only when run as a tool; importing this file just brings in the encoder.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.argv[2] || siteUrl();
  const target = join(root, process.argv[3] || 'docs/qr-app.png');
  const { modules, version, size, mask } = encodeQr(url, 'Q');
  const png = toPng(modules);
  writeFileSync(target, png);
  console.log(`${target}: ${url}`);
  console.log(`  version ${version} (${size}x${size} modules), level Q, mask ${mask}, `
    + `${(png.length / 1024).toFixed(1)} kB`);
}

export { toPng, encodeQr };
