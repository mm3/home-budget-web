import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPdf, textWidth, toLatin1 } from '../src/core/pdf.js';

const columns = [
  { key: 'date', title: 'Date', width: 80 },
  { key: 'note', title: 'Note', width: 260 },
  { key: 'amount', title: 'Amount', width: 100, align: 'right' },
];

function decode(bytes) {
  return new TextDecoder('latin1').decode(bytes);
}

test('characters outside Latin-1 are transliterated', () => {
  assert.equal(toLatin1('−5 — "quote" …'), '-5 - "quote" ...');
  assert.equal(toLatin1('café €'), 'café \u0080');
  assert.equal(toLatin1('你好'), '??');
});

test('textWidth grows with the text', () => {
  assert.ok(textWidth('MMM', 10) > textWidth('iii', 10));
  assert.ok(textWidth('', 10) === 0);
  assert.ok(textWidth('Amount', 10) > 0);
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
  assert.match(text, /Page 1 of 1/);
  assert.match(text, /Coffee \\\(large\\\)/, 'parentheses are escaped');
  assert.match(text, /startxref\n\d+/);
});

test('long reports are paginated and long cells are cut', () => {
  const rows = Array.from({ length: 120 }, (unused, index) => ({
    date: '22.09.2026',
    note: `A very long note that certainly will not fit into this narrow column, number ${index} of many`,
    amount: '12.50 EUR',
  }));
  const text = decode(buildPdf({ title: 'Home Budget', columns, rows }));
  assert.match(text, /\/Count [2-9]/);
  assert.match(text, /Page 2 of/);
  assert.match(text, /\.\.\./, 'text that does not fit is cut');
});

test('a report without rows still works', () => {
  const text = decode(buildPdf({ title: 'Empty', columns, rows: [] }));
  assert.match(text, /\/Count 1/);
  assert.match(text, /Empty/);
});
