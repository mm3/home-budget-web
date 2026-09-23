/**
 * Minimal PDF writer: a title block, a summary, a vector chart and a paginated
 * table, with no library involved.
 *
 * The document embeds a subset of DejaVu Sans (see font-data.js) as a
 * CIDFontType2 with Identity-H encoding, so Cyrillic, Greek and accented Latin
 * text prints correctly instead of turning into question marks. Text is written
 * as glyph ids, and a /ToUnicode map is attached so the text can still be
 * selected, copied and searched in a PDF reader.
 */

import { FONT_DATA, FONT_LENGTH, FONT_METRICS, FONT_NAME, glyphFor, glyphWidth } from './font-data.js';

const PAGE = { width: 595.28, height: 841.89, margin: 40 }; // A4 portrait, points

/** Characters the subset does not contain but that have an obvious stand-in. */
const SUBSTITUTES = {
  ' ': ' ', ' ': ' ', ' ': ' ', '​': '', '️': '',
  '  ': ' ',
};

/** Glyph ids used in the document, mapped back to their code point for /ToUnicode. */
const used = new Map();

/**
 * Drops what the font cannot show (emoji, for instance) and replaces the few
 * characters that have a plain equivalent.
 * @returns {number[]} code points that all have a glyph
 */
export function supported(value) {
  const result = [];
  for (const char of String(value)) {
    const replacement = SUBSTITUTES[char];
    const text = replacement === undefined ? char : replacement;
    for (const final of text) {
      const code = final.codePointAt(0);
      if (!glyphFor(code)) continue;
      // Dropping an emoji must not leave a double space or a leading one behind.
      if (code === 32 && (result.length === 0 || result[result.length - 1] === 32)) continue;
      result.push(code);
    }
  }
  while (result.length && result[result.length - 1] === 32) result.pop();
  return result;
}

/** Encodes text as a hexadecimal Identity-H string, remembering the glyphs used. */
export function encodeText(value) {
  let hex = '';
  for (const code of supported(value)) {
    const glyph = glyphFor(code);
    used.set(glyph, code);
    hex += glyph.toString(16).padStart(4, '0');
  }
  return hex;
}

/** Width of the text in points, from the real advance widths of the font. */
export function textWidth(value, fontSize) {
  let units = 0;
  for (const code of supported(value)) units += glyphWidth(glyphFor(code));
  return (units / 1000) * fontSize;
}

/** Cuts text down to maxWidth, adding an ellipsis when something was dropped. */
function fit(value, fontSize, maxWidth) {
  const codes = supported(value);
  let text = String.fromCodePoint(...codes);
  if (textWidth(text, fontSize) <= maxWidth) return text;
  while (text.length > 1 && textWidth(`${text}...`, fontSize) > maxWidth) text = text.slice(0, -1);
  return `${text}...`;
}

/**
 * Builds a PDF document.
 * @param {{title: string, subtitle?: string, summary?: Array<{label: string, value: string}>,
 *          chart?: {title: string, points: Array<{label: string, value: number}>, average?: number,
 *                   format?: (value: number) => string},
 *          columns: Array<{title: string, key: string, width: number, align?: 'left'|'right'}>,
 *          rows: Array<Record<string, any>>, footer?: string}} document
 * @returns {Uint8Array}
 */
export function buildPdf(document) {
  used.clear();
  const columns = document.columns;
  const totalWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const usable = PAGE.width - PAGE.margin * 2;
  const scale = usable / totalWidth;
  const pages = [];
  let content = [];
  let y = 0;

  const startPage = (first) => {
    content = [];
    y = PAGE.height - PAGE.margin;
    if (first) {
      content.push(text(PAGE.margin, y - 6, document.title, 18, true));
      y -= 26;
      if (document.subtitle) {
        content.push(text(PAGE.margin, y - 4, document.subtitle, 10, false, 0.42));
        y -= 18;
      }
      for (const item of document.summary || []) {
        content.push(text(PAGE.margin, y - 4, `${item.label}: ${item.value}`, 11));
        y -= 15;
      }
      y -= 8;
      if (document.chart && document.chart.points.length) {
        y = drawChart(content, document.chart, y);
      }
    }
    // table header
    let x = PAGE.margin;
    for (const column of columns) {
      const width = column.width * scale;
      const value = fit(column.title, 9, width - 6);
      const offset = column.align === 'right' ? width - 6 - textWidth(value, 9) : 0;
      content.push(text(x + offset, y - 10, value, 9, true, 0.42));
      x += width;
    }
    y -= 14;
    content.push(line(PAGE.margin, y, PAGE.width - PAGE.margin, y));
    y -= 12;
  };

  startPage(true);
  for (const row of document.rows) {
    if (y < PAGE.margin + 40) {
      pages.push(content);
      startPage(false);
    }
    let x = PAGE.margin;
    for (const column of columns) {
      const width = column.width * scale;
      const value = fit(row[column.key] ?? '', 10, width - 6);
      const offset = column.align === 'right' ? width - 6 - textWidth(value, 10) : 0;
      content.push(text(x + offset, y, value, 10));
      x += width;
    }
    y -= 15;
  }
  pages.push(content);

  return assemble(pages, document.footer || '');
}

/**
 * Draws the bar chart below the summary and returns the new vertical position.
 * Bars are plain filled rectangles, the average is a dashed line.
 */
function drawChart(content, chart, top) {
  const format = chart.format || String;
  const width = PAGE.width - PAGE.margin * 2;
  const height = 150;
  const baseline = top - height;
  const points = chart.points;
  const average = Number.isFinite(chart.average) && chart.average > 0 ? chart.average : null;
  const max = Math.max(1, ...points.map((point) => point.value), average || 0);
  const slot = width / points.length;
  const barWidth = Math.max(3, Math.min(26, slot * 0.6));

  content.push(text(PAGE.margin, top + 4, chart.title, 11, true));
  content.push(`0.85 0.86 0.89 RG 0.7 w ${PAGE.margin} ${baseline} m ${PAGE.width - PAGE.margin} ${baseline} l S`);
  content.push(text(PAGE.margin, top - 10, format(max), 8, false, 0.45));

  points.forEach((point, index) => {
    const barHeight = (point.value / max) * (height - 16);
    const x = PAGE.margin + slot * index + (slot - barWidth) / 2;
    if (point.value > 0) {
      content.push(`0.98 0.45 0.09 rg ${x.toFixed(2)} ${baseline.toFixed(2)} ${barWidth.toFixed(2)} `
        + `${Math.max(barHeight, 1).toFixed(2)} re f`);
    }
    if (points.length <= 20 || index % 2 === 0) {
      const labelX = x + barWidth / 2 - textWidth(point.label, 7) / 2;
      content.push(text(labelX, baseline - 10, point.label, 7, false, 0.45));
    }
  });

  if (average !== null) {
    const y = baseline + (average / max) * (height - 16);
    content.push(`0.31 0.27 0.9 RG 1 w [4 3] 0 d ${PAGE.margin} ${y.toFixed(2)} m `
      + `${PAGE.width - PAGE.margin} ${y.toFixed(2)} l S [] 0 d`);
    const label = `${chart.averageLabel || 'average'} ${format(average)}`;
    content.push(text(PAGE.width - PAGE.margin - textWidth(label, 8), y + 3, label, 8, true, 0.3));
  }
  return baseline - 28;
}

/**
 * One line of text. There is a single embedded font, so bold is drawn by
 * stroking the outline as well as filling it (PDF text render mode 2).
 */
function text(x, y, value, size = 10, bold = false, grey = 0) {
  const tone = grey ? `${grey} ${grey} ${grey}` : '0 0 0';
  const weight = bold ? `${tone} RG ${(size * 0.03).toFixed(2)} w 2 Tr` : '0 Tr';
  return `BT /F1 ${size} Tf ${tone} rg ${weight} `
    + `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm <${encodeText(value)}> Tj ET`;
}

function line(x1, y1, x2, y2) {
  return `0.8 0.8 0.85 RG 0.7 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

/** The /ToUnicode CMap that makes the glyph ids searchable text again. */
function toUnicodeCMap() {
  const entries = [...used.entries()].sort((a, b) => a[0] - b[0]);
  let body = '';
  for (let at = 0; at < entries.length; at += 100) {
    const chunk = entries.slice(at, at + 100);
    body += `${chunk.length} beginbfchar\n`;
    for (const [glyph, code] of chunk) {
      const target = code > 0xffff
        ? `${(0xd800 + ((code - 0x10000) >> 10)).toString(16).padStart(4, '0')}`
          + `${(0xdc00 + ((code - 0x10000) & 0x3ff)).toString(16).padStart(4, '0')}`
        : code.toString(16).padStart(4, '0');
      body += `<${glyph.toString(16).padStart(4, '0')}> <${target}>\n`;
    }
    body += 'endbfchar\n';
  }
  return '/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n'
    + '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n'
    + '/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n'
    + '1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n'
    + `${body}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend\n`;
}

/** The widths array (/W) for the glyphs this document actually uses. */
function widthsArray() {
  const glyphs = [...used.keys()].sort((a, b) => a - b);
  const parts = [];
  let index = 0;
  while (index < glyphs.length) {
    const start = index;
    while (index + 1 < glyphs.length && glyphs[index + 1] === glyphs[index] + 1) index += 1;
    const run = glyphs.slice(start, index + 1).map((glyph) => glyphWidth(glyph));
    parts.push(`${glyphs[start]} [${run.join(' ')}]`);
    index += 1;
  }
  return parts.join(' ');
}

function assemble(pages, footer) {
  const objects = [];
  const add = (object) => {
    objects.push(object);
    return objects.length; // object numbers start at 1
  };
  const reserve = () => add(null);
  const set = (id, object) => { objects[id - 1] = object; };

  const catalogId = reserve();
  const pagesId = reserve();
  const fontId = reserve();
  const cidFontId = reserve();
  const descriptorId = reserve();
  const fontFileId = reserve();
  const toUnicodeId = reserve();

  const pageIds = [];
  pages.forEach((content, index) => {
    const pageId = reserve();
    const streamId = reserve();
    pageIds.push(pageId);
    const withFooter = [...content, text(PAGE.margin, PAGE.margin - 12,
      `${footer}${footer ? ' \u00b7 ' : ''}Page ${index + 1} of ${pages.length}`, 8, false, 0.5)].join('\n');
    set(pageId, `<< /Type /Page /Parent ${pagesId} 0 R `
      + `/MediaBox [0 0 ${PAGE.width.toFixed(2)} ${PAGE.height.toFixed(2)}] `
      + `/Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${streamId} 0 R >>`);
    set(streamId, { stream: withFooter });
  });

  // The font has to be written last: only now is it known which glyphs are used.
  const fontBytes = base64ToBinary(FONT_DATA);
  set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  set(fontId, `<< /Type /Font /Subtype /Type0 /BaseFont /${FONT_NAME} /Encoding /Identity-H `
    + `/DescendantFonts [${cidFontId} 0 R] /ToUnicode ${toUnicodeId} 0 R >>`);
  set(cidFontId, `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${FONT_NAME} `
    + '/CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> '
    + `/FontDescriptor ${descriptorId} 0 R /DW 1000 /W [${widthsArray()}] /CIDToGIDMap /Identity >>`);
  set(descriptorId, `<< /Type /FontDescriptor /FontName /${FONT_NAME} /Flags 4 `
    + `/FontBBox [${FONT_METRICS.bbox.join(' ')}] /ItalicAngle 0 /Ascent ${FONT_METRICS.ascent} `
    + `/Descent ${FONT_METRICS.descent} /CapHeight ${FONT_METRICS.capHeight} /StemV ${FONT_METRICS.stemV} `
    + `/FontFile2 ${fontFileId} 0 R >>`);
  set(fontFileId, { stream: fontBytes, dict: `/Length1 ${FONT_LENGTH} /Filter /FlateDecode` });
  set(toUnicodeId, { stream: toUnicodeCMap() });

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((object, index) => {
    const id = index + 1;
    offsets[id] = pdf.length;
    if (typeof object === 'string') {
      pdf += `${id} 0 obj\n${object}\nendobj\n`;
    } else {
      pdf += `${id} 0 obj\n<< /Length ${object.stream.length}${object.dict ? ` ${object.dict}` : ''} >>\n`
        + `stream\n${object.stream}\nendstream\nendobj\n`;
    }
  });

  const xrefOffset = pdf.length;
  const count = objects.length + 1;
  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) {
    pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return bytes;
}

/** base64 -> a string with one character per byte, which is what the writer works with. */
function base64ToBinary(value) {
  if (typeof atob === 'function') return atob(value);
  return Buffer.from(value, 'base64').toString('latin1');
}
