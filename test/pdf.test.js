import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { buildPdf, encodeText, supported, textWidth } from '../src/core/pdf.js';
import { FONT_DATA, FONT_LENGTH, glyphFor } from '../src/core/font-data.js';

const columns = [
  { key: 'date', title: 'Date', width: 80 },
  { key: 'note', title: 'Note', width: 260 },
  { key: 'amount', title: 'Amount', width: 100, align: 'right' },
];

function decode(bytes) {
  return new TextDecoder('latin1').decode(bytes);
}

/** The document writes glyph ids, so expected text has to be encoded the same way. */
function shows(pdf, value) {
  return pdf.includes(encodeText(value));
}

test('every script the interface uses has glyphs', () => {
  for (const char of 'Aя Ω ü ß ł č €₽₴£$¥') {
    assert.ok(glyphFor(char.codePointAt(0)) > 0, `no glyph for ${char}`);
  }
});

test('characters the font has no glyph for are dropped without leaving gaps', () => {
  assert.equal(String.fromCodePoint(...supported('☕ Coffee')), 'Coffee');
  assert.equal(String.fromCodePoint(...supported('Daily 🛍️ shopping')), 'Daily shopping');
  assert.equal(String.fromCodePoint(...supported('你好')), '');
  assert.equal(String.fromCodePoint(...supported('Кофе')), 'Кофе');
});

test('textWidth uses the real advance widths', () => {
  assert.ok(textWidth('MMM', 10) > textWidth('iii', 10));
  assert.equal(textWidth('', 10), 0);
  assert.ok(textWidth('Amount', 10) > 0);
  assert.ok(Math.abs(textWidth('AB', 20) - textWidth('AB', 10) * 2) < 1e-9, 'width scales with the size');
});

test('a small report is a single valid page', () => {
  const bytes = buildPdf({
    title: 'Home Budget',
    subtitle: 'September 2026',
    summary: [{ label: 'Expenses', value: '12.50 €' }],
    columns,
    rows: [{ date: '22.09.2026', note: 'Coffee (large)', amount: '12.50 EUR' }],
    footer: 'Home Budget',
  });
  const text = decode(bytes);
  assert.match(text, /^%PDF-1\.4/);
  assert.match(text, /%%EOF\n$/);
  assert.match(text, /\/Count 1/);
  assert.ok(shows(text, 'Page 1 of 1'));
  assert.ok(shows(text, 'Coffee (large)'), 'parentheses need no escaping in a hex string');
  assert.match(text, /startxref\n\d+/);
});

test('the embedded font is a complete flate stream with a unicode map', () => {
  const text = decode(buildPdf({
    title: 'Домашний бюджет',
    columns,
    rows: [{ date: '22.09.2026', note: 'Кофе', amount: '12,50 ₽' }],
  }));
  assert.match(text, /\/Subtype \/Type0/);
  assert.match(text, /\/Encoding \/Identity-H/);
  assert.match(text, /\/Subtype \/CIDFontType2/);
  assert.match(text, /\/CIDToGIDMap \/Identity/);
  assert.match(text, new RegExp(`/Length1 ${FONT_LENGTH} /Filter /FlateDecode`));
  assert.match(text, /\/ToUnicode \d+ 0 R/);
  assert.match(text, /beginbfchar/);
  // The ruble sign has to be mapped back to U+20BD so the text stays searchable.
  assert.match(text, new RegExp(`<${glyphFor(0x20bd).toString(16).padStart(4, '0')}> <20bd>`, 'i'));
  assert.equal(inflateSync(Buffer.from(FONT_DATA, 'base64')).length, FONT_LENGTH);
});

test('cyrillic text is written as glyphs, not as question marks', () => {
  const text = decode(buildPdf({
    title: 'Домашний бюджет',
    subtitle: 'Сентябрь 2026',
    columns,
    rows: [{ date: '22.09.2026', note: 'Кофе', amount: '12,50 ₽' }],
  }));
  assert.ok(shows(text, 'Домашний бюджет'));
  assert.ok(shows(text, 'Кофе'));
  assert.ok(!shows(text, '????'));
});

test('long reports are paginated and long cells are cut', () => {
  const rows = Array.from({ length: 120 }, (unused, index) => ({
    date: '22.09.2026',
    note: `A very long note that certainly will not fit into this narrow column, number ${index} of many`,
    amount: '12.50 EUR',
  }));
  const text = decode(buildPdf({ title: 'Home Budget', columns, rows }));
  assert.match(text, /\/Count [2-9]/);
  assert.ok(shows(text, 'Page 2 of'));
  assert.ok(text.includes(encodeText('...')), 'text that does not fit is cut');
});

test('the chart is drawn above the table', () => {
  const text = decode(buildPdf({
    title: 'Home Budget',
    summary: [{ label: 'Expenses', value: '12.50 EUR' }],
    chart: {
      title: 'Expenses (EUR)',
      points: [{ label: 'Jul 26', value: 0 }, { label: 'Aug 26', value: 80 }, { label: 'Sep 26', value: 120 }],
      average: 100,
      averageLabel: 'average',
      format: (value) => `${value.toFixed(2)} EUR`,
    },
    columns,
    rows: [{ date: '22.09.2026', note: 'Coffee', amount: '12.50 EUR' }],
  }));
  assert.ok(shows(text, 'Expenses (EUR)'), 'the chart title is written');
  assert.ok(shows(text, 'Jul 26'));
  assert.ok(shows(text, 'average 100.00 EUR'));
  assert.match(text, /re f/, 'bars are filled rectangles');
  assert.match(text, /\[4 3\] 0 d/, 'the average is a dashed line');
  assert.ok(!text.includes('NaN'));
});

test('a chart without an average or with many points still works', () => {
  const many = Array.from({ length: 30 }, (unused, index) => ({ label: `d${index}`, value: index }));
  const text = decode(buildPdf({
    title: 'Home Budget',
    chart: { title: 'Days', points: many },
    columns,
    rows: [],
  }));
  assert.ok(shows(text, 'Days'));
  assert.ok(!text.includes('[4 3] 0 d'), 'no dashed line without an average');
});

test('a report without rows still works', () => {
  const text = decode(buildPdf({ title: 'Empty', columns, rows: [] }));
  assert.match(text, /\/Count 1/);
  assert.ok(shows(text, 'Empty'));
});

test('the cross reference table points at every object', () => {
  const text = decode(buildPdf({ title: 'Home Budget', columns, rows: [] }));
  const size = Number(text.match(/\/Size (\d+)/)[1]);
  const entries = text.slice(text.indexOf('xref\n')).match(/^\d{10} \d{5} [nf] $/gm);
  assert.equal(entries.length, size);
  for (const id of [1, size - 1]) {
    const offset = Number(entries[id].slice(0, 10));
    assert.ok(text.startsWith(`${id} 0 obj`, offset), `object ${id} is not at its offset`);
  }
});
