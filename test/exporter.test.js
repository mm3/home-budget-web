import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv } from '../src/core/csv.js';
import {
  breakdownLines, buildCsvExport, buildPdfExport, buildXlsxExport, chartData, EXPORT_COLUMNS, exportFileName,
  exportRows, summaryByCurrency,
} from '../src/core/exporter.js';
import { readZip } from '../src/core/zip.js';
import { parseXlsx, excelSerialToIso } from '../src/core/xlsx.js';

const categories = [
  { id: 'daily', name: 'Daily', kind: 'expense', color: '#4f46e5' },
  { id: 'pay', name: 'Pay', kind: 'income', color: '#16a34a' },
];
const currencies = [{ code: 'EUR', symbol: '€', decimals: 2 }, { code: 'JPY', symbol: '¥', decimals: 0 }];
const entries = [
  { id: '1', date: '2026-09-22', amount: 1250, categoryId: 'daily', currency: 'EUR', note: 'Rimi, shop' },
  { id: '2', date: '2026-09-01', amount: 200000, categoryId: 'pay', currency: 'EUR', note: 'Salary' },
  { id: '3', date: '2026-09-02', amount: 900, categoryId: 'daily', currency: 'JPY', note: '' },
];
const context = { categories, currencies };

test('export rows carry a signed amount and readable names', () => {
  const rows = exportRows(entries, context);
  assert.deepEqual(rows[0], {
    date: '2026-09-22', category: 'Daily', kind: 'Expense', amount: -12.5, currency: 'EUR', note: 'Rimi, shop',
  });
  assert.equal(rows[1].amount, 2000);
  assert.equal(rows[2].amount, -900, 'currencies without decimals are not divided');
  assert.equal(exportFileName('csv', '2026-09-22'), 'home-budget-2026-09-22.csv');
});

test('CSV export can be parsed back', () => {
  const csv = buildCsvExport(entries, context);
  const { rows } = parseCsv(csv);
  assert.deepEqual(rows[0], EXPORT_COLUMNS.map((column) => column.title));
  assert.deepEqual(rows[1], ['2026-09-22', 'Daily', 'Expense', '-12.5', 'EUR', 'Rimi, shop']);
  assert.equal(rows.length, 4);
  assert.ok(buildCsvExport(entries, { ...context, delimiter: ';' }).includes(';'));
});

test('XLSX export can be parsed back', async () => {
  const parsed = await parseXlsx(await buildXlsxExport(entries, context));
  assert.deepEqual(parsed.rows[0], EXPORT_COLUMNS.map((column) => column.title));
  assert.equal(excelSerialToIso(parsed.rows[1][0]), '2026-09-22');
  assert.equal(parsed.rows[1][3], -12.5);
  assert.equal(parsed.rows[1][5], 'Rimi, shop');
});

test('PDF export contains the summary and the rows', () => {
  const text = new TextDecoder('latin1').decode(buildPdfExport(entries, { ...context, subtitle: 'September 2026' }));
  assert.match(text, /Home Budget/);
  assert.match(text, /September 2026/);
  assert.match(text, /Expenses \\\(EUR\\\)/);
  assert.match(text, /Income \\\(EUR\\\)/);
  assert.match(text, /Balance \\\(EUR\\\)/);
  assert.match(text, /22\.09\.2026/);
  const withoutSubtitle = new TextDecoder('latin1').decode(buildPdfExport(entries.slice(0, 1), context));
  assert.match(withoutSubtitle, /1 entry/);
});

test('chart data has one point per period and an average of the used periods', () => {
  const chart = chartData(entries, { ...context, today: '2026-09-22', chartCurrency: 'EUR', chartCount: 3 });
  assert.deepEqual(chart.points.map((point) => point.label), ['Jul 26', 'Aug 26', 'Sep 26']);
  assert.deepEqual(chart.points.map((point) => point.value), [0, 0, 12.5]);
  assert.equal(chart.average, 12.5, 'empty periods do not lower the average');
  assert.equal(chart.currency.code, 'EUR');
  const empty = chartData([], { ...context, today: '2026-09-22' });
  assert.equal(empty.average, 0);
  assert.equal(empty.hasData, false);
});

test('the spreadsheet export contains the chart', async () => {
  const files = await readZip(await buildXlsxExport(entries, { ...context, today: '2026-09-22', chartCurrency: 'EUR' }));
  assert.ok([...files.keys()].includes('xl/charts/chart1.xml'));
  assert.match(new TextDecoder().decode(files.get('xl/charts/chart1.xml')), /Expenses \(EUR\)/);
});

test('the PDF export contains the chart', () => {
  const text = new TextDecoder('latin1').decode(
    buildPdfExport(entries, { ...context, today: '2026-09-22', chartCurrency: 'EUR' }),
  );
  assert.match(text, /Sep 26/);
  assert.match(text, /re f/);
});

test('exports work without translated labels and without a chart currency', async () => {
  const plain = { categories, currencies };
  const files = await readZip(await buildXlsxExport(entries, plain));
  const decoder = new TextDecoder();
  const chart = decoder.decode(files.get('xl/charts/chart1.xml'));
  assert.match(chart, /Expenses \(EUR\)/, 'English defaults are used');
  assert.match(decoder.decode(files.get('xl/worksheets/sheet2.xml')), /Period/, 'the data sheet uses English headers');
  const pdf = new TextDecoder('latin1').decode(buildPdfExport(entries, plain));
  assert.match(pdf, /average/);
  const noChart = await readZip(await buildXlsxExport([], plain));
  assert.ok(![...noChart.keys()].some((name) => name.includes('chart')));
});

test('summaries are grouped per currency', () => {
  const summary = summaryByCurrency(entries, categories, currencies);
  assert.deepEqual(summary.map((item) => item.currency.code), ['EUR', 'JPY']);
  assert.equal(summary[0].expense, 1250);
  assert.equal(summary[0].income, 200000);
  assert.equal(summary[1].net, -900);
  assert.deepEqual(breakdownLines(entries, categories, currencies, 'EUR'), ['Daily: 12.50 € (100%)']);
  assert.deepEqual(summaryByCurrency([], categories, currencies), []);
});
