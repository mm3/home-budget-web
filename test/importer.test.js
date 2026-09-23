import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/core/csv.js';
import {
  convertRows, describeImport, detectStructure, readCurrency, readDate,
} from '../src/core/importer.js';

const context = {
  categories: [
    { id: 'daily', name: 'Daily', kind: 'expense' },
    { id: 'pay', name: 'Pay', kind: 'income' },
  ],
  currencies: [{ code: 'EUR', decimals: 2 }, { code: 'USD', decimals: 2 }, { code: 'JPY', decimals: 0 }],
  defaultCategoryId: 'daily',
  defaultCurrency: 'EUR',
  today: '2026-09-22',
};

test('English headers are recognised', () => {
  const { rows } = parseCsv('Date,Amount,Category,Currency,Note\n2026-09-22,12.50,Daily,EUR,coffee\n');
  const structure = detectStructure(rows);
  assert.equal(structure.confidence, 'header');
  assert.equal(structure.headerRow, 0);
  assert.deepEqual(structure.mapping, { date: 0, amount: 1, category: 2, currency: 3, note: 4 });
});

test('headers in other languages and with extra words are recognised', () => {
  const { rows } = parseCsv('Datum;Betrag EUR;Kategorie;Kommentar\n20.09.2026;-15,75;Groceries;Rimi\n');
  const structure = detectStructure(rows);
  assert.deepEqual(structure.mapping, { date: 0, amount: 1, category: 2, currency: null, note: 3 });

  const russian = parseCsv('Дата,Сумма,Категория\n22.09.2026,100,Daily\n').rows;
  assert.deepEqual(detectStructure(russian).mapping.amount, 1);
});

test('files without a header are read by looking at the content', () => {
  const rows = [
    ['2026-09-01', '12.30', 'Daily', 'coffee'],
    ['2026-09-02', '4', 'Daily', 'bus ticket'],
    ['2026-09-03', '8.10', 'Groceries', 'milk and bread'],
  ];
  const structure = detectStructure(rows);
  assert.equal(structure.headerRow, null);
  assert.equal(structure.confidence, 'content');
  assert.equal(structure.mapping.date, 0);
  assert.equal(structure.mapping.amount, 1);
  assert.equal(structure.mapping.category, 2);
  assert.equal(structure.mapping.note, 3);
});

test('a header that appears after a title row is still found', () => {
  const rows = [
    ['Bank statement 2026'],
    [],
    ['Date', 'Description', 'Amount'],
    ['2026-09-22', 'Shop', '-12.50'],
  ];
  const structure = detectStructure(rows);
  assert.equal(structure.headerRow, 2);
  assert.equal(structure.mapping.amount, 2);
  assert.equal(structure.mapping.note, 1);
});

test('empty and unreadable files are reported', () => {
  const empty = detectStructure([]);
  assert.equal(empty.confidence, 'none');
  assert.deepEqual(empty.warnings, ['The file is empty']);

  const noAmounts = detectStructure([['just text'], ['more text']]);
  assert.equal(noAmounts.confidence, 'none');
  assert.ok(noAmounts.warnings.some((warning) => warning.includes('amounts')));
});

test('rows are converted into entries', () => {
  const rows = parseCsv('Date,Amount,Category,Currency,Note\n'
    + '2026-09-22,12.50,Daily,EUR,coffee\n'
    + '20.09.2026,-15,Groceries,€,Rimi\n'
    + '2026-09-19,2000,Pay,USD,salary\n'
    + 'broken,5,Daily,EUR,skip me\n'
    + '2026-09-18,,Daily,EUR,no amount\n').rows;
  const result = convertRows(rows, detectStructure(rows), context);
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries[0], {
    date: '2026-09-22', amount: 1250, categoryId: 'daily', categoryName: 'Daily',
    isIncome: false, currency: 'EUR', note: 'coffee',
  });
  assert.equal(result.entries[1].amount, 1500, 'a minus sign only marks an expense');
  assert.equal(result.entries[1].categoryId, null);
  assert.equal(result.entries[1].currency, 'EUR');
  assert.equal(result.entries[2].isIncome, true);
  assert.equal(result.entries[2].currency, 'USD');
  assert.deepEqual(result.newCategories, ['Groceries']);
  assert.deepEqual(result.skipped.map((item) => item.reason), ['unreadable date', 'no amount']);
  assert.equal(describeImport(result), '3 entries, 1 new categories, 2 skipped');
  assert.equal(describeImport({ entries: [1], newCategories: [], skipped: [] }), '1 entry');
});

test('missing columns fall back to defaults', () => {
  const rows = [['Amount'], ['12.50'], ['7']];
  const structure = detectStructure(rows);
  const result = convertRows(rows, structure, context);
  assert.equal(result.entries.length, 2);
  assert.equal(result.entries[0].date, '2026-09-22');
  assert.equal(result.entries[0].currency, 'EUR');
  assert.equal(result.entries[0].categoryId, null);
  assert.ok(structure.warnings.some((warning) => warning.includes('date')));
});

test('spreadsheet values keep their types', () => {
  const rows = [['Date', 'Amount', 'Currency'], [46287, 12.5, 'JPY'], [46286, 3, 'USD']];
  const result = convertRows(rows, detectStructure(rows), context);
  assert.equal(result.entries[0].date, '2026-09-22');
  assert.equal(result.entries[0].amount, 13, 'JPY has no decimals');
  assert.equal(result.entries[1].amount, 300);
});

test('dates and currencies are read from several notations', () => {
  assert.equal(readDate(46287), '2026-09-22');
  assert.equal(readDate('46287'), '2026-09-22');
  assert.equal(readDate('2026-09-22'), '2026-09-22');
  assert.equal(readDate('22.09.2026'), '2026-09-22');
  assert.equal(readDate(5), null);
  assert.equal(readDate(''), null);
  assert.equal(readDate(null), null);

  const codes = ['EUR', 'USD'];
  assert.equal(readCurrency('eur', codes), 'EUR');
  assert.equal(readCurrency('12.50 €', codes), 'EUR');
  assert.equal(readCurrency('$', codes), 'USD');
  assert.equal(readCurrency('₽', codes), null, 'unknown symbols are ignored');
  assert.equal(readCurrency('SEK', codes), 'SEK');
  assert.equal(readCurrency('', codes), null);
  assert.equal(readCurrency('nonsense', codes), null);
});
