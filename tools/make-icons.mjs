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

const GREEN = [21, 128, 61];        // the background: money, but not neon
const GREEN_LIGHT = [34, 197, 94];  // a soft top-left lift, so the square is not flat
const GOLD = [217, 119, 6];         // the coin's rim
const GOLD_LIGHT = [251, 191, 36];  // its face
const DARK = [20, 83, 45];          // the currency sign cut into the coin
const SAMPLES = 4;

/** Is (x, y), in 0..1 coordinates, inside a rounded square of the given radius? */
function inRoundedSquare(x, y, radius) {
  const dx = Math.max(radius - x, x - (1 - radius), 0);
  const dy = Math.max(radius - y, y - (1 - radius), 0);
  return dx * dx + dy * dy <= radius * radius;
}

/** Mixes two colours; t = 0 is the first, t = 1 the second. */
function mix(first, second, t) {
  return [0, 1, 2].map((index) => first[index] + (second[index] - first[index]) * t);
}

/**
 * The euro sign, drawn as geometry rather than text: an open ring with the
 * right side cut away, crossed by two bars. The default currency is the euro
 * and the app bar already carries the same glyph.
 */
function inEuro(x, y) {
  const dx = x - 0.525;
  const dy = y - 0.5;
  const radius = Math.hypot(dx, dy);
  const openToTheRight = dx > 0 && Math.abs(dy) < dx * 0.78;
  if (radius <= 0.165 && radius >= 0.113 && !openToTheRight) return true;
  const bar = x >= 0.335 && x <= 0.60;
  return bar && (Math.abs(y - 0.468) <= 0.023 || Math.abs(y - 0.552) <= 0.023);
}

/** Colour of the icon at (x, y) in 0..1 coordinates, or null where it is transparent. */
function colourAt(x, y, { maskable }) {
  // A maskable icon is cropped by the launcher, so it is full bleed and the
  // drawing stays inside the safe area in the middle.
  if (!maskable && !inRoundedSquare(x, y, 0.22)) return null;
  const scale = maskable ? 0.76 : 1;
  const px = 0.5 + (x - 0.5) / scale;
  const py = 0.5 + (y - 0.5) / scale;

  const distance = Math.hypot(px - 0.5, py - 0.5);
  if (distance <= 0.345) {
    if (inEuro(px, py)) return DARK;
    // A lighter face inside a darker rim is what reads as a coin at 32 pixels.
    return distance <= 0.295 ? GOLD_LIGHT : GOLD;
  }
  return mix(GREEN_LIGHT, GREEN, Math.min(1, (x + y) / 1.6));
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
