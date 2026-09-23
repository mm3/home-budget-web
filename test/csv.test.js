import test from 'node:test';
import assert from 'node:assert/strict';
import { detectDelimiter, parseCsv, toCsv } from '../src/core/csv.js';

test('the delimiter is detected from the first lines', () => {
  assert.equal(detectDelimiter('a,b,c\n1,2,3'), ',');
  assert.equal(detectDelimiter('a;b;c\n1;2;3'), ';');
  assert.equal(detectDelimiter('a\tb\n1\t2'), '\t');
  assert.equal(detectDelimiter('a|b\n1|2'), '|');
  assert.equal(detectDelimiter('single column'), ',');
  assert.equal(detectDelimiter('"a;b",c\n"1;2",3'), ',', 'separators inside quotes do not count');
});

test('parseCsv handles quotes, newlines and a BOM', () => {
  const text = '﻿Date,Note,Amount\r\n2026-09-22,"Rimi, shop",12.50\r\n2026-09-21,"He said ""hi""",3\r\n';
  const { rows, delimiter } = parseCsv(text);
  assert.equal(delimiter, ',');
  assert.deepEqual(rows[0], ['Date', 'Note', 'Amount']);
  assert.deepEqual(rows[1], ['2026-09-22', 'Rimi, shop', '12.50']);
  assert.deepEqual(rows[2], ['2026-09-21', 'He said "hi"', '3']);
  assert.deepEqual(parseCsv('a,b\n\n\nc,d').rows, [['a', 'b'], ['c', 'd']], 'blank lines are dropped');
  assert.deepEqual(parseCsv('"multi\nline",x').rows, [['multi\nline', 'x']]);
  assert.deepEqual(parseCsv('').rows, []);
  assert.deepEqual(parseCsv('a;b', { delimiter: ';' }).rows, [['a', 'b']]);
  assert.deepEqual(parseCsv('a,b').rows, [['a', 'b']], 'a last line without a newline is kept');
});

test('toCsv quotes only what needs quoting', () => {
  const text = toCsv([['Date', 'Note'], ['2026-09-22', 'Rimi, shop'], ['2026-09-21', 'say "hi"'], [1, null]]);
  assert.ok(text.startsWith('﻿'));
  assert.match(text, /"Rimi, shop"/);
  assert.match(text, /"say ""hi"""/);
  assert.match(text, /\r\n1,\r\n$/);
  assert.equal(toCsv([['a', 'b']], { bom: false, delimiter: ';', newline: '\n' }), 'a;b\n');
  assert.match(toCsv([[' padded ']], { bom: false }), /" padded "/);
});

test('CSV survives a round trip', () => {
  const rows = [['Date', 'Note'], ['2026-09-22', 'a,b'], ['2026-09-21', 'c\nd']];
  assert.deepEqual(parseCsv(toCsv(rows)).rows, rows);
});
