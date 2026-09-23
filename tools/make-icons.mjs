/**
 * Draws the app icons for the GitHub Pages build (PNG, because iOS home screens
 * and the web app manifest want raster icons) into assets/.
 *
 *   node tools/make-icons.mjs
 *
 * PNG is written by hand - a deflate stream of raw scanlines - so this needs no
 * dependency either. The shapes are the same house that the inline SVG favicon
 * draws, sampled four times per pixel so the edges stay smooth.
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const INDIGO = [79, 70, 229];
const GREEN = [34, 197, 94];
const WHITE = [255, 255, 255];
const SAMPLES = 4;

/** Is (x, y), in 0..1 coordinates, inside a rounded square of the given radius? */
function inRoundedSquare(x, y, radius) {
  const dx = Math.max(radius - x, x - (1 - radius), 0);
  const dy = Math.max(radius - y, y - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

function inTriangle(x, y, [ax, ay], [bx, by], [cx, cy]) {
  const sign = (px, py, qx, qy, rx, ry) => (px - rx) * (qy - ry) - (qx - rx) * (py - ry);
  const d1 = sign(x, y, ax, ay, bx, by);
  const d2 = sign(x, y, bx, by, cx, cy);
  const d3 = sign(x, y, cx, cy, ax, ay);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}

/** Colour of the icon at (x, y) in 0..1 coordinates, or null where it is transparent. */
function colourAt(x, y, { maskable }) {
  // A maskable icon is cropped by the launcher, so it is full bleed and the
  // drawing stays inside the safe area in the middle.
  if (!maskable && !inRoundedSquare(x, y, 0.22)) return null;
  const scale = maskable ? 0.76 : 1;
  const px = 0.5 + (x - 0.5) / scale;
  const py = 0.5 + (y - 0.5) / scale;
  const dx = px - 0.5;
  const dy = py - 0.6;
  if (dx * dx + dy * dy <= 0.115 * 0.115) return GREEN;
  if (inTriangle(px, py, [0.5, 0.2], [0.16, 0.45], [0.84, 0.45])) return WHITE;
  if (px >= 0.245 && px <= 0.755 && py >= 0.44 && py <= 0.79) return WHITE;
  return INDIGO;
}

function render(size, options) {
  const pixels = Buffer.alloc(size * (size * 4 + 1)); // one filter byte per row
  for (let row = 0; row < size; row += 1) {
    const rowStart = row * (size * 4 + 1);
    pixels[rowStart] = 0; // filter: none
    for (let column = 0; column < size; column += 1) {
      let red = 0;
      let green = 0;
      let blue = 0;
      let alpha = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const colour = colourAt(
            (column + (sx + 0.5) / SAMPLES) / size,
            (row + (sy + 0.5) / SAMPLES) / size,
            options,
          );
          if (colour) {
            red += colour[0];
            green += colour[1];
            blue += colour[2];
            alpha += 255;
          }
        }
      }
      const taken = SAMPLES * SAMPLES;
      const at = rowStart + 1 + column * 4;
      const weight = alpha === 0 ? 1 : alpha / 255;
      pixels[at] = Math.round(red / weight);
      pixels[at + 1] = Math.round(green / weight);
      pixels[at + 2] = Math.round(blue / weight);
      pixels[at + 3] = Math.round(alpha / taken);
    }
  }
  return pixels;
}

const CRC_TABLE = Array.from({ length: 256 }, (unused, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function png(size, options) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(render(size, options), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'assets');
mkdirSync(assets, { recursive: true });

const icons = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];
for (const [name, size, options] of icons) {
  const bytes = png(size, options);
  writeFileSync(join(assets, name), bytes);
  console.log(`${name}: ${size}x${size}, ${(bytes.length / 1024).toFixed(1)} kB`);
}
