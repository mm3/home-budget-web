/**
 * Draws the QR code that the README shows, so a phone can open the published
 * app by pointing its camera at the page.
 *
 *   node tools/make-qr.mjs [url] [docs/qr-app.png]
 *
 * The address defaults to SITE_URL in src/core/version.js, which is where every
 * other link to the app comes from too.
 *
 * The encoder is written out here rather than installed: byte mode, the smallest
 * version that fits, error correction level Q (recoverable up to a quarter of the
 * symbol, so a printed or partly covered code still scans), Reed-Solomon over
 * GF(256), and the mask chosen by the penalty rules of the specification.
 * Versions 1 to 10 are covered, which is far more than a URL needs.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { encodePng } from './png.mjs';

// --------------------------------------------------------------- the tables

/** Total codewords (data + error correction) per version, 1..10. */
const TOTAL_CODEWORDS = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

/**
 * Per version and correction level: error correction codewords per block, then
 * the blocks as [count, data codewords] groups.
 */
const BLOCKS = {
  L: [[7, [[1, 19]]], [10, [[1, 34]]], [15, [[1, 55]]], [20, [[1, 80]]], [26, [[1, 108]]],
    [18, [[2, 68]]], [20, [[2, 78]]], [24, [[2, 97]]], [30, [[2, 116]]], [18, [[2, 68], [2, 69]]]],
  M: [[10, [[1, 16]]], [16, [[1, 28]]], [26, [[1, 44]]], [18, [[2, 32]]], [24, [[2, 43]]],
    [16, [[4, 27]]], [18, [[4, 31]]], [22, [[2, 38], [2, 39]]], [22, [[3, 36], [2, 37]]],
    [26, [[4, 43], [1, 44]]]],
  Q: [[13, [[1, 13]]], [22, [[1, 22]]], [18, [[2, 17]]], [26, [[2, 24]]], [18, [[2, 15], [2, 16]]],
    [24, [[4, 19]]], [18, [[2, 14], [4, 15]]], [22, [[4, 18], [2, 19]]], [20, [[4, 16], [4, 17]]],
    [24, [[6, 19], [2, 20]]]],
  H: [[17, [[1, 9]]], [28, [[1, 16]]], [22, [[2, 13]]], [16, [[4, 9]]], [22, [[2, 11], [2, 12]]],
    [28, [[4, 15]]], [26, [[4, 13], [1, 14]]], [26, [[4, 14], [2, 15]]], [24, [[4, 12], [4, 13]]],
    [28, [[6, 15], [2, 16]]]],
};

/** Centres of the alignment patterns, per version. */
const ALIGNMENT = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42],
  [6, 26, 46], [6, 28, 50]];

const FORMAT_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// ------------------------------------------------------- Reed-Solomon, GF(256)

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
for (let index = 0, value = 1; index < 255; index += 1) {
  EXP[index] = value;
  LOG[value] = index;
  value <<= 1;
  if (value & 0x100) value ^= 0x11d; // the primitive polynomial QR uses
}
for (let index = 255; index < 512; index += 1) EXP[index] = EXP[index - 255];

function multiply(a, b) {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

/** The generator polynomial for `count` error correction codewords. */
function generator(count) {
  let poly = [1];
  for (let index = 0; index < count; index += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let at = 0; at < poly.length; at += 1) {
      next[at] ^= poly[at];
      next[at + 1] ^= multiply(poly[at], EXP[index]);
    }
    poly = next;
  }
  return poly;
}

function errorCorrection(data, count) {
  const poly = generator(count);
  const remainder = new Array(count).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift();
    remainder.push(0);
    for (let at = 0; at < count; at += 1) remainder[at] ^= multiply(poly[at + 1], factor);
  }
  return remainder;
}

// ------------------------------------------------------------- the code words

/** Byte mode payload: mode, length, data, terminator and padding. */
function encodeData(bytes, version, level) {
  const [ecPerBlock, groups] = BLOCKS[level][version - 1];
  const blockCount = groups.reduce((sum, [count]) => sum + count, 0);
  const dataCodewords = TOTAL_CODEWORDS[version - 1] - ecPerBlock * blockCount;

  const bits = [];
  const push = (value, width) => {
    for (let at = width - 1; at >= 0; at -= 1) bits.push((value >> at) & 1);
  };
  push(0b0100, 4); // byte mode
  push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, dataCodewords * 8 - bits.length)); // terminator
  while (bits.length % 8) bits.push(0);

  const codewords = [];
  for (let at = 0; at < bits.length; at += 8) {
    codewords.push(bits.slice(at, at + 8).reduce((byte, bit) => (byte << 1) | bit, 0));
  }
  for (let pad = 0; codewords.length < dataCodewords; pad += 1) {
    codewords.push(pad % 2 === 0 ? 0xec : 0x11);
  }

  // Split into blocks, add their error correction, then interleave both.
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (const [count, size] of groups) {
    for (let index = 0; index < count; index += 1) {
      const block = codewords.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(errorCorrection(block, ecPerBlock));
    }
  }
  const result = [];
  const longest = Math.max(...dataBlocks.map((block) => block.length));
  for (let at = 0; at < longest; at += 1) {
    for (const block of dataBlocks) if (at < block.length) result.push(block[at]);
  }
  for (let at = 0; at < ecPerBlock; at += 1) {
    for (const block of ecBlocks) result.push(block[at]);
  }
  return result;
}

/** Smallest version that holds the data at this correction level. */
function chooseVersion(byteLength, level) {
  for (let version = 1; version <= 10; version += 1) {
    const [ecPerBlock, groups] = BLOCKS[level][version - 1];
    const blockCount = groups.reduce((sum, [count]) => sum + count, 0);
    const capacity = TOTAL_CODEWORDS[version - 1] - ecPerBlock * blockCount;
    const header = 4 + (version < 10 ? 8 : 16);
    if (byteLength * 8 + header <= capacity * 8) return version;
  }
  throw new Error(`${byteLength} bytes do not fit in a version 10 symbol at level ${level}`);
}

// ------------------------------------------------------------- the symbol

/** 15 bit BCH code that protects the format information. */
function formatInformation(level, mask) {
  const data = (FORMAT_BITS[level] << 3) | mask;
  let value = data << 10;
  for (let bit = 14; bit >= 10; bit -= 1) {
    if ((value >> bit) & 1) value ^= 0b10100110111 << (bit - 10);
  }
  return ((data << 10) | value) ^ 0b101010000010010;
}

/** 18 bit BCH code that names the version, needed from version 7 on. */
function versionInformation(version) {
  let value = version << 12;
  for (let bit = 17; bit >= 12; bit -= 1) {
    if ((value >> bit) & 1) value ^= 0b1111100100 << (bit - 12);
  }
  return (version << 12) | value;
}

const MASKS = [
  (row, column) => (row + column) % 2 === 0,
  (row) => row % 2 === 0,
  (unused, column) => column % 3 === 0,
  (row, column) => (row + column) % 3 === 0,
  (row, column) => (Math.floor(row / 2) + Math.floor(column / 3)) % 2 === 0,
  (row, column) => ((row * column) % 2) + ((row * column) % 3) === 0,
  (row, column) => ((((row * column) % 2) + ((row * column) % 3)) % 2) === 0,
  (row, column) => ((((row + column) % 2) + ((row * column) % 3)) % 2) === 0,
];

/** Lays out one symbol: the fixed patterns, the data and one mask. */
function buildSymbol(codewords, version, level, mask) {
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const place = (row, column, dark) => {
    modules[row][column] = dark;
    reserved[row][column] = true;
  };

  // finder patterns with their separators
  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let row = -1; row <= 7; row += 1) {
      for (let column = -1; column <= 7; column += 1) {
        const y = top + row;
        const x = left + column;
        if (y < 0 || y >= size || x < 0 || x >= size) continue;
        const inRing = (row === 0 || row === 6) && column >= 0 && column <= 6;
        const inSide = (column === 0 || column === 6) && row >= 0 && row <= 6;
        const inCore = row >= 2 && row <= 4 && column >= 2 && column <= 4;
        place(y, x, inRing || inSide || inCore);
      }
    }
  }
  // timing patterns
  for (let at = 8; at < size - 8; at += 1) {
    place(6, at, at % 2 === 0);
    place(at, 6, at % 2 === 0);
  }
  // alignment patterns, skipping the corners the finders already occupy
  const centres = ALIGNMENT[version - 1];
  for (const row of centres) {
    for (const column of centres) {
      if ((row === 6 && column === 6) || (row === 6 && column === size - 7)
        || (row === size - 7 && column === 6)) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          place(row + dy, column + dx, Math.max(Math.abs(dy), Math.abs(dx)) !== 1);
        }
      }
    }
  }
  place(size - 8, 8, true); // the one module that is always dark

  // Format information, written twice: down the left of the top-left finder and
  // along the top, then mirrored around the other two finders.
  const format = formatInformation(level, mask);
  for (let bit = 0; bit < 15; bit += 1) {
    const dark = ((format >> bit) & 1) === 1;
    if (bit < 6) place(bit, 8, dark);
    else if (bit < 8) place(bit + 1, 8, dark);
    else place(size - 15 + bit, 8, dark);

    // The column skips 6, which belongs to the timing pattern: writing there
    // breaks it, and a detector then finds the symbol only by luck.
    if (bit < 8) place(8, size - 1 - bit, dark);
    else if (bit === 8) place(8, 7, dark);
    else place(8, 14 - bit, dark);
  }
  if (version >= 7) {
    const info = versionInformation(version);
    for (let bit = 0; bit < 18; bit += 1) {
      const dark = ((info >> bit) & 1) === 1;
      const row = Math.floor(bit / 3);
      const column = bit % 3;
      place(row, size - 11 + column, dark);
      place(size - 11 + column, row, dark);
    }
  }

  // the data itself, upwards and downwards in two module wide columns
  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right > 0; right -= 2) {
    if (right === 6) right -= 1; // the vertical timing pattern is not a column
    for (let step = 0; step < size; step += 1) {
      const row = upward ? size - 1 - step : step;
      for (const column of [right, right - 1]) {
        if (reserved[row][column]) continue;
        const byte = codewords[bitIndex >> 3];
        const dark = byte !== undefined && ((byte >> (7 - (bitIndex & 7))) & 1) === 1;
        modules[row][column] = dark !== MASKS[mask](row, column);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
  return modules;
}

/** The penalty score of the specification; the lowest scoring mask is used. */
function penalty(modules) {
  const size = modules.length;
  let score = 0;

  const run = (line) => {
    let length = 1;
    for (let at = 1; at < line.length; at += 1) {
      if (line[at] === line[at - 1]) {
        length += 1;
      } else {
        if (length >= 5) score += 3 + (length - 5);
        length = 1;
      }
    }
    if (length >= 5) score += 3 + (length - 5);
  };
  for (let index = 0; index < size; index += 1) {
    run(modules[index]);
    run(modules.map((row) => row[index]));
  }

  for (let row = 0; row < size - 1; row += 1) {
    for (let column = 0; column < size - 1; column += 1) {
      const first = modules[row][column];
      if (first === modules[row][column + 1] && first === modules[row + 1][column]
        && first === modules[row + 1][column + 1]) score += 3;
    }
  }

  const pattern = [true, false, true, true, true, false, true];
  const hasPattern = (line, at) => pattern.every((value, index) => line[at + index] === value);
  const quiet = (line, at) => line.slice(at, at + 4).every((value) => value === false);
  for (let index = 0; index < size; index += 1) {
    for (const line of [modules[index], modules.map((row) => row[index])]) {
      for (let at = 0; at + 7 <= size; at += 1) {
        if (!hasPattern(line, at)) continue;
        if ((at >= 4 && quiet(line, at - 4)) || (at + 11 <= size && quiet(line, at + 7))) score += 40;
      }
    }
  }

  const dark = modules.flat().filter(Boolean).length;
  score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

/**
 * Encodes text as a QR symbol.
 * @returns {boolean[][]} true is a dark module
 */
export function encodeQr(text, level = 'Q') {
  const bytes = [...Buffer.from(text, 'utf8')];
  const version = chooseVersion(bytes.length, level);
  const codewords = encodeData(bytes, version, level);
  let best = null;
  for (let mask = 0; mask < 8; mask += 1) {
    const modules = buildSymbol(codewords, version, level, mask);
    const score = penalty(modules);
    if (!best || score < best.score) best = { modules, score, mask };
  }
  return { ...best, version, size: version * 4 + 17 };
}

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

export { toPng };
