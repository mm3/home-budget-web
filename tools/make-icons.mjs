/**
 * Draws the app icons for the GitHub Pages build (PNG, because iOS home screens
 * and the web app manifest want raster icons) into assets/.
 *
 *   node tools/make-icons.mjs
 *
 * The shapes are the same house that the inline SVG favicon draws, sampled four
 * times per pixel so the edges stay smooth; png.mjs turns them into a file.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';

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
  const pixels = Buffer.alloc(size * size * 4);
  for (let row = 0; row < size; row += 1) {
    const rowStart = row * size * 4;
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
      const at = rowStart + column * 4;
      const weight = alpha === 0 ? 1 : alpha / 255;
      pixels[at] = Math.round(red / weight);
      pixels[at + 1] = Math.round(green / weight);
      pixels[at + 2] = Math.round(blue / weight);
      pixels[at + 3] = Math.round(alpha / taken);
    }
  }
  return pixels;
}

function png(size, options) {
  return encodePng(size, size, render(size, options));
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
