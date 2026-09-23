/**
 * Generates src/core/font-data.js: a TrueType subset of DejaVu Sans that covers
 * every script the interface can be translated into (Latin, Latin Extended-A,
 * Cyrillic, punctuation and currency signs), so the PDF export can show real
 * text instead of question marks.
 *
 *   node tools/make-font.mjs [path/to/DejaVuSans.ttf]
 *
 * The result is a checked-in source file, so building the app never needs this
 * tool, a font on the machine or any dependency. The subset is deflate
 * compressed here and embedded in the PDF as-is (/FlateDecode), which means the
 * app never has to decompress it at runtime.
 *
 * Hinting instructions are dropped: they would need the cvt/fpgm/prep tables,
 * and PDF viewers hint the outlines themselves.
 */

import { deflateSync } from 'node:zlib';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';

/** Code point ranges the export has to be able to print. */
const RANGES = [
  [0x0020, 0x007e], // ASCII
  [0x00a0, 0x00ff], // Latin-1: accents, the section sign, the cent sign
  [0x0100, 0x017f], // Latin Extended-A: Polish, Czech, Estonian, Turkish, Baltic
  [0x018f, 0x018f], [0x01b7, 0x01b7], [0x0259, 0x0259], // Azerbaijani schwa and ezh
  [0x0386, 0x03ce], // Greek
  [0x0400, 0x045f], // Cyrillic
  [0x0490, 0x0491], // Ukrainian ghe with upturn
  [0x2010, 0x2027], // dashes, quotes, bullet, ellipsis
  [0x2030, 0x2030], [0x2039, 0x203a], [0x2044, 0x2044],
  [0x20a0, 0x20bf], // currency signs: euro, hryvnia, ruble, lira, tenge...
  [0x2116, 0x2116], // numero
  [0x2190, 0x2193], // arrows
  [0x2212, 0x2212], [0x2260, 0x2260], [0x2264, 0x2265], // minus, comparisons
  [0x25a0, 0x25a1], [0x2713, 0x2713], // squares and the check mark
  [0xfffd, 0xfffd], // replacement character for anything else
];

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

function readTables(font) {
  const numTables = font.readUInt16BE(4);
  const tables = new Map();
  for (let index = 0; index < numTables; index += 1) {
    const record = 12 + index * 16;
    const tag = font.toString('latin1', record, record + 4);
    const offset = font.readUInt32BE(record + 8);
    const length = font.readUInt32BE(record + 12);
    tables.set(tag, font.subarray(offset, offset + length));
  }
  return tables;
}

/** Unicode code point -> glyph id, from the best available cmap subtable. */
function readCmap(cmap) {
  const count = cmap.readUInt16BE(2);
  let best = null;
  for (let index = 0; index < count; index += 1) {
    const record = 4 + index * 8;
    const platform = cmap.readUInt16BE(record);
    const encoding = cmap.readUInt16BE(record + 2);
    const offset = cmap.readUInt32BE(record + 4);
    const format = cmap.readUInt16BE(offset);
    const score = format === 12 ? 3 : (platform === 3 && encoding === 1 ? 2 : 1);
    if (!best || score > best.score) best = { score, offset, format };
  }
  if (!best) throw new Error('no usable cmap subtable');
  return best.format === 12 ? readCmap12(cmap, best.offset) : readCmap4(cmap, best.offset);
}

function readCmap4(cmap, start) {
  const segCount = cmap.readUInt16BE(start + 6) / 2;
  const ends = start + 14;
  const starts = ends + segCount * 2 + 2;
  const deltas = starts + segCount * 2;
  const rangeOffsets = deltas + segCount * 2;
  const map = new Map();
  for (let segment = 0; segment < segCount; segment += 1) {
    const end = cmap.readUInt16BE(ends + segment * 2);
    const first = cmap.readUInt16BE(starts + segment * 2);
    const delta = cmap.readInt16BE(deltas + segment * 2);
    const rangeOffset = cmap.readUInt16BE(rangeOffsets + segment * 2);
    if (first === 0xffff) continue;
    for (let code = first; code <= end; code += 1) {
      let glyph;
      if (rangeOffset === 0) {
        glyph = (code + delta) & 0xffff;
      } else {
        const at = rangeOffsets + segment * 2 + rangeOffset + (code - first) * 2;
        if (at + 1 >= cmap.length) continue;
        glyph = cmap.readUInt16BE(at);
        if (glyph !== 0) glyph = (glyph + delta) & 0xffff;
      }
      if (glyph) map.set(code, glyph);
    }
  }
  return map;
}

function readCmap12(cmap, start) {
  const groups = cmap.readUInt32BE(start + 12);
  const map = new Map();
  for (let index = 0; index < groups; index += 1) {
    const at = start + 16 + index * 12;
    const first = cmap.readUInt32BE(at);
    const last = cmap.readUInt32BE(at + 4);
    const glyph = cmap.readUInt32BE(at + 8);
    for (let code = first; code <= last && code - first < 0x10000; code += 1) {
      map.set(code, glyph + (code - first));
    }
  }
  return map;
}

function readLoca(loca, longFormat, numGlyphs) {
  const offsets = [];
  for (let glyph = 0; glyph <= numGlyphs; glyph += 1) {
    offsets.push(longFormat ? loca.readUInt32BE(glyph * 4) : loca.readUInt16BE(glyph * 2) * 2);
  }
  return offsets;
}

// ---------------------------------------------------------------------------
// Glyph rewriting
// ---------------------------------------------------------------------------

const MORE_COMPONENTS = 0x0020;
const ARGS_ARE_WORDS = 0x0001;
const HAVE_SCALE = 0x0008;
const HAVE_XY_SCALE = 0x0040;
const HAVE_TWO_BY_TWO = 0x0080;
const HAVE_INSTRUCTIONS = 0x0100;

/** Glyph ids a composite glyph is built from. */
function componentsOf(glyph) {
  if (glyph.length === 0 || glyph.readInt16BE(0) >= 0) return [];
  const found = [];
  let at = 10;
  for (;;) {
    const flags = glyph.readUInt16BE(at);
    found.push({ at: at + 2, glyph: glyph.readUInt16BE(at + 2) });
    at += 4 + (flags & ARGS_ARE_WORDS ? 4 : 2);
    if (flags & HAVE_SCALE) at += 2;
    else if (flags & HAVE_XY_SCALE) at += 4;
    else if (flags & HAVE_TWO_BY_TWO) at += 8;
    if (!(flags & MORE_COMPONENTS)) break;
  }
  return found;
}

/** Copies a glyph without its hinting program, renumbering any components. */
function rewriteGlyph(glyph, renumber) {
  if (glyph.length === 0) return glyph;
  const contours = glyph.readInt16BE(0);
  if (contours >= 0) {
    const instructionsAt = 10 + contours * 2;
    const instructionLength = glyph.readUInt16BE(instructionsAt);
    const head = Buffer.from(glyph.subarray(0, instructionsAt + 2));
    head.writeUInt16BE(0, instructionsAt);
    return Buffer.concat([head, glyph.subarray(instructionsAt + 2 + instructionLength)]);
  }
  const copy = Buffer.from(glyph);
  let at = 10;
  let end = glyph.length;
  for (;;) {
    let flags = copy.readUInt16BE(at);
    copy.writeUInt16BE(renumber(copy.readUInt16BE(at + 2)), at + 2);
    if (flags & HAVE_INSTRUCTIONS) {
      flags &= ~HAVE_INSTRUCTIONS;
      copy.writeUInt16BE(flags, at);
    }
    at += 4 + (flags & ARGS_ARE_WORDS ? 4 : 2);
    if (flags & HAVE_SCALE) at += 2;
    else if (flags & HAVE_XY_SCALE) at += 4;
    else if (flags & HAVE_TWO_BY_TWO) at += 8;
    if (!(flags & MORE_COMPONENTS)) {
      end = at;
      break;
    }
  }
  return copy.subarray(0, end);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

function pad4(buffer) {
  const extra = (4 - (buffer.length % 4)) % 4;
  return extra ? Buffer.concat([buffer, Buffer.alloc(extra)]) : buffer;
}

function checksum(buffer) {
  const padded = pad4(buffer);
  let sum = 0;
  for (let at = 0; at < padded.length; at += 4) sum = (sum + padded.readUInt32BE(at)) >>> 0;
  return sum;
}

function assembleFont(tables) {
  // The table checksum of 'head' is defined with checkSumAdjustment set to zero.
  tables.get('head').writeUInt32BE(0, 8);
  const tags = [...tables.keys()].sort();
  const count = tags.length;
  const directory = Buffer.alloc(12 + count * 16);
  directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(count, 4);
  const power = Math.floor(Math.log2(count));
  directory.writeUInt16BE(16 * 2 ** power, 6);
  directory.writeUInt16BE(power, 8);
  directory.writeUInt16BE(count * 16 - 16 * 2 ** power, 10);

  const parts = [directory];
  let offset = directory.length;
  tags.forEach((tag, index) => {
    const table = tables.get(tag);
    const record = 12 + index * 16;
    directory.write(tag, record, 4, 'latin1');
    directory.writeUInt32BE(checksum(table), record + 4);
    directory.writeUInt32BE(offset, record + 8);
    directory.writeUInt32BE(table.length, record + 12);
    const padded = pad4(table);
    parts.push(padded);
    offset += padded.length;
  });

  const font = Buffer.concat(parts);
  const headIndex = tags.indexOf('head');
  const headOffset = font.readUInt32BE(12 + headIndex * 16 + 8);
  font.writeUInt32BE(0, headOffset + 8);
  font.writeUInt32BE((0xb1b0afba - checksum(font)) >>> 0, headOffset + 8);
  return font;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function subset(path) {
  const font = readFileSync(path);
  const tables = readTables(font);
  const head = Buffer.from(tables.get('head'));
  const hhea = Buffer.from(tables.get('hhea'));
  const maxp = Buffer.from(tables.get('maxp'));
  const os2 = tables.get('OS/2');
  const unitsPerEm = head.readUInt16BE(18);
  const numGlyphs = maxp.readUInt16BE(4);
  const longLoca = head.readInt16BE(50) === 1;
  const loca = readLoca(tables.get('loca'), longLoca, numGlyphs);
  const glyf = tables.get('glyf');
  const cmap = readCmap(tables.get('cmap'));
  const numberOfHMetrics = hhea.readUInt16BE(34);
  const hmtx = tables.get('hmtx');
  const advance = (glyph) => hmtx.readUInt16BE(Math.min(glyph, numberOfHMetrics - 1) * 4);

  // Which glyphs do we need? Start from the wanted code points, then pull in
  // every glyph the composites among them are built from.
  const wanted = new Map(); // code point -> old glyph id
  for (const [first, last] of RANGES) {
    for (let code = first; code <= last; code += 1) {
      const glyph = cmap.get(code);
      if (glyph) wanted.set(code, glyph);
    }
  }
  const keep = new Set([0, ...wanted.values()]);
  const queue = [...keep];
  while (queue.length) {
    const glyph = queue.pop();
    const bytes = glyf.subarray(loca[glyph], loca[glyph + 1]);
    for (const component of componentsOf(bytes)) {
      if (!keep.has(component.glyph)) {
        keep.add(component.glyph);
        queue.push(component.glyph);
      }
    }
  }

  const order = [...keep].sort((a, b) => a - b);
  const renumbered = new Map(order.map((glyph, index) => [glyph, index]));
  const renumber = (glyph) => renumbered.get(glyph) ?? 0;

  const glyphs = order.map((glyph) => pad4(rewriteGlyph(glyf.subarray(loca[glyph], loca[glyph + 1]), renumber)));
  const newLoca = Buffer.alloc((order.length + 1) * 4);
  let at = 0;
  glyphs.forEach((bytes, index) => {
    newLoca.writeUInt32BE(at, index * 4);
    at += bytes.length;
  });
  newLoca.writeUInt32BE(at, order.length * 4);

  const newHmtx = Buffer.alloc(order.length * 4);
  order.forEach((glyph, index) => newHmtx.writeUInt16BE(advance(glyph), index * 4));

  head.writeInt16BE(1, 50); // long loca
  hhea.writeUInt16BE(order.length, 34);
  maxp.writeUInt16BE(order.length, 4);

  const post = Buffer.alloc(32);
  post.writeUInt32BE(0x00030000, 0); // version 3.0: no glyph names

  const subsetFont = assembleFont(new Map([
    ['head', head], ['hhea', hhea], ['maxp', maxp], ['hmtx', newHmtx],
    ['loca', newLoca], ['glyf', Buffer.concat(glyphs)], ['post', post],
  ]));

  const scale = 1000 / unitsPerEm;
  const round = (value) => Math.round(value * scale);
  return {
    font: subsetFont,
    unitsPerEm,
    glyphCount: order.length,
    widths: order.map((glyph) => round(advance(glyph))),
    map: [...wanted.entries()].map(([code, glyph]) => [code, renumber(glyph)]),
    descriptor: {
      bbox: [round(head.readInt16BE(36)), round(head.readInt16BE(38)),
        round(head.readInt16BE(40)), round(head.readInt16BE(42))],
      ascent: round(hhea.readInt16BE(4)),
      descent: round(hhea.readInt16BE(6)),
      capHeight: os2 && os2.length >= 90 ? round(os2.readInt16BE(88)) : round(hhea.readInt16BE(4)),
      stemV: 80,
    },
  };
}

/** Packs the code point -> glyph table into ranges, which keeps the source small. */
function packRanges(pairs) {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const ranges = [];
  for (const [code, glyph] of sorted) {
    const last = ranges[ranges.length - 1];
    if (last && code === last[0] + last[2] && glyph === last[1] + last[2]) last[2] += 1;
    else ranges.push([code, glyph, 1]);
  }
  return ranges;
}

const source = process.argv[2] || DEFAULT_FONT;
const result = subset(source);
const compressed = deflateSync(result.font, { level: 9 });
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ranges = packRanges(result.map);

const output = `/**
 * Generated by tools/make-font.mjs - do not edit.
 *
 * A subset of DejaVu Sans (Bitstream Vera / public domain licence, see
 * https://dejavu-fonts.github.io/License.html) covering Latin, Latin
 * Extended-A, Greek, Cyrillic, punctuation and currency signs, so the PDF
 * export can print every language the interface offers.
 *
 * FONT_DATA is the subset already deflate compressed, base64 encoded: the PDF
 * embeds those bytes unchanged as a /FlateDecode stream, so nothing has to be
 * decompressed while the app runs.
 */

/** Deflate compressed TrueType subset, base64 encoded (${compressed.length} bytes compressed). */
export const FONT_DATA = '${compressed.toString('base64')}';

/** Size of the font once decompressed; the PDF needs it as /Length1. */
export const FONT_LENGTH = ${result.font.length};

export const FONT_NAME = 'DejaVuSans-Subset';

/** Glyph advance widths in 1/1000 em, indexed by glyph id. */
export const GLYPH_WIDTHS = [${result.widths.join(',')}];

/** Metrics for the PDF font descriptor, in 1/1000 em. */
export const FONT_METRICS = ${JSON.stringify(result.descriptor)};

/** Code point -> glyph id, packed as [firstCode, firstGlyph, count] runs. */
const RANGES = ${JSON.stringify(ranges)};

const BY_CODE = new Map();
for (const [code, glyph, count] of RANGES) {
  for (let step = 0; step < count; step += 1) BY_CODE.set(code + step, glyph + step);
}

/** Glyph id for a code point, or 0 when the font has no glyph for it. */
export function glyphFor(codePoint) {
  return BY_CODE.get(codePoint) || 0;
}

/** Width of a glyph in 1/1000 em. */
export function glyphWidth(glyph) {
  return GLYPH_WIDTHS[glyph] || 0;
}
`;

writeFileSync(join(root, 'src', 'core', 'font-data.js'), output);
console.log(`font-data.js: ${result.glyphCount} glyphs, `
  + `${(result.font.length / 1024).toFixed(1)} kB subset -> ${(compressed.length / 1024).toFixed(1)} kB deflated `
  + `-> ${(compressed.toString('base64').length / 1024).toFixed(1)} kB base64`);
