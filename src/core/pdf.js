/**
 * Minimal PDF writer: one built-in font (Helvetica), a title block, a summary
 * and a paginated table. Enough for a readable export without any library.
 */

const PAGE = { width: 595.28, height: 841.89, margin: 40 }; // A4 portrait, points

function escapeText(text) {
  return String(text).replace(/[\\()]/g, (char) => `\\${char}`);
}

/** PDF's standard encoding is Latin-1; anything else is transliterated or dropped. */
export function toLatin1(text) {
  const replacements = {
    '−': '-', '–': '-', '—': '-', '‘': "'", '’': "'",
    '“': '"', '”': '"', '…': '...', ' ': ' ', ' ': ' ', '€': '\u0080',
  };
  let result = '';
  for (const char of String(text)) {
    const replacement = replacements[char];
    if (replacement !== undefined) result += replacement;
    else if (char.codePointAt(0) <= 0xff) result += char;
    else result += '?';
  }
  return result;
}

/** Rough text width in points for Helvetica; good enough for column fitting. */
export function textWidth(text, fontSize) {
  let units = 0;
  for (const char of String(text)) {
    if ('iljt.,:;|!\'`'.includes(char)) units += 0.28;
    else if ('fr()[]-'.includes(char)) units += 0.36;
    else if ('MW@'.includes(char)) units += 0.9;
    else if (char === ' ') units += 0.28;
    else if (char >= 'A' && char <= 'Z') units += 0.68;
    else units += 0.55;
  }
  return units * fontSize;
}

function fit(text, fontSize, maxWidth) {
  let value = toLatin1(text);
  if (textWidth(value, fontSize) <= maxWidth) return value;
  while (value.length > 1 && textWidth(`${value}...`, fontSize) > maxWidth) value = value.slice(0, -1);
  return `${value}...`;
}

/**
 * Builds a PDF document.
 * @param {{title: string, subtitle?: string, summary?: Array<{label: string, value: string}>,
 *          columns: Array<{title: string, key: string, width: number, align?: 'left'|'right'}>,
 *          rows: Array<Record<string, any>>, footer?: string}} document
 * @returns {Uint8Array}
 */
export function buildPdf(document) {
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

function text(x, y, value, size = 10, bold = false, grey = 0) {
  return `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${grey ? `${grey} ${grey} ${grey} rg` : '0 0 0 rg'} `
    + `1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${escapeText(toLatin1(value))}) Tj ET`;
}

function line(x1, y1, x2, y2) {
  return `0.8 0.8 0.85 RG 0.7 w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`;
}

function assemble(pages, footer) {
  const objects = [];
  const pageIds = pages.map((unused, index) => 4 + index * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
  const boldFontId = 3 + pages.length * 2 + 1;
  pages.forEach((content, index) => {
    const pageId = pageIds[index];
    const streamId = pageId + 1;
    const withFooter = [...content, text(PAGE.margin, PAGE.margin - 12,
      `${footer}${footer ? '   ' : ''}Page ${index + 1} of ${pages.length}`, 8, false, 0.5)].join('\n');
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.width.toFixed(2)} ${PAGE.height.toFixed(2)}] `
      + `/Resources << /Font << /F1 3 0 R /F2 ${boldFontId} 0 R >> >> /Contents ${streamId} 0 R >>`;
    objects[streamId] = { stream: withFooter };
  });
  objects[boldFontId] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';

  let pdf = '%PDF-1.4\n';
  const offsets = [];
  for (let id = 1; id < objects.length; id += 1) {
    const object = objects[id];
    if (object === undefined) continue;
    offsets[id] = pdf.length;
    if (typeof object === 'string') {
      pdf += `${id} 0 obj\n${object}\nendobj\n`;
    } else {
      pdf += `${id} 0 obj\n<< /Length ${object.stream.length} >>\nstream\n${object.stream}\nendstream\nendobj\n`;
    }
  }
  const xrefOffset = pdf.length;
  const count = objects.length;
  pdf += `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let id = 1; id < count; id += 1) {
    pdf += offsets[id] === undefined
      ? '0000000000 65535 f \n'
      : `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  const bytes = new Uint8Array(pdf.length);
  for (let index = 0; index < pdf.length; index += 1) bytes[index] = pdf.charCodeAt(index) & 0xff;
  return bytes;
}
