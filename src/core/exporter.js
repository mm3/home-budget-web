/** Turns entries into the rows used by the CSV, XLSX and PDF exports. */

import { toCsv } from './csv.js';
import { formatDate, formatMoney, toPlainAmount } from './format.js';
import { entryCategoryIds, findCategory, findCurrency } from './model.js';
import { buildPdf } from './pdf.js';
import { buildXlsx } from './xlsx.js';
import { APP_VERSION } from './version.js';
import { byCategory as categoryTotals, series, totals } from './stats.js';

export const EXPORT_COLUMNS = [
  { key: 'date', title: 'Date', type: 'date', width: 14 },
  { key: 'category', title: 'Category', type: 'text', width: 20 },
  { key: 'kind', title: 'Type', type: 'text', width: 10 },
  { key: 'amount', title: 'Amount', type: 'number', width: 14 },
  { key: 'currency', title: 'Currency', type: 'text', width: 10 },
  { key: 'note', title: 'Note', type: 'text', width: 40 },
];

/** One export row per entry, with a signed amount (expenses are negative). */
export function exportRows(entries, { categories, currencies }) {
  return entries.map((entry) => {
    const category = findCategory(categories, entry.categoryId);
    const currency = findCurrency(currencies, entry.currency);
    const signed = category.kind === 'income' ? entry.amount : -entry.amount;
    return {
      date: entry.date,
      // All of them, separated by a bar, which is what the importer reads back.
      // The first one is the one that decides income or expense.
      category: entryCategoryIds(entry).map((id) => findCategory(categories, id).name).join(' | '),
      kind: category.kind === 'income' ? 'Income' : 'Expense',
      amount: Number(toPlainAmount(signed, currency.decimals)),
      currency: currency.code,
      note: entry.note,
    };
  });
}

/** File name such as "home-budget-2026-09-22.csv". */
export function exportFileName(extension, today) {
  return `home-budget-${today}.${extension}`;
}

/** CSV text with a header row. */
export function buildCsvExport(entries, context) {
  const rows = exportRows(entries, context);
  return toCsv([
    EXPORT_COLUMNS.map((column) => column.title),
    ...rows.map((row) => EXPORT_COLUMNS.map((column) => row[column.key])),
  ], { delimiter: context.delimiter || ',' });
}

/**
 * Data for the chart that goes into the PDF and the spreadsheet: one point per period,
 * amounts in major units, plus the average across the periods that have entries.
 */
export function chartData(entries, context) {
  const currency = findCurrency(context.currencies, context.chartCurrency
    || (entries[0] && entries[0].currency) || 'EUR');
  const points = series(
    entries.filter((entry) => entry.currency === currency.code),
    context.categories,
    context.chartPeriod || 'month',
    context.chartCount || 12,
    context.today,
    context.periodTexts,
  ).map((point) => ({ label: point.label, value: Number(toPlainAmount(point.expense, currency.decimals)) }));
  const withData = points.filter((point) => point.value > 0);
  const average = withData.length
    ? Math.round((withData.reduce((sum, point) => sum + point.value, 0) / withData.length) * 100) / 100
    : 0;
  return { points, average, currency, hasData: withData.length > 0 };
}

/** Spreadsheet bytes: the entries on one sheet, the chart and its data on another. */
export function buildXlsxExport(entries, context) {
  const chart = chartData(entries, context);
  return buildXlsx({
    sheetName: 'Home Budget',
    columns: EXPORT_COLUMNS,
    rows: exportRows(entries, context),
    chart: chart.hasData ? {
      sheetName: context.labels?.statistics || 'Statistics',
      title: `${context.labels?.expenses || 'Expenses'} (${chart.currency.code})`,
      categoryTitle: context.labels?.period || 'Period',
      valueTitle: context.labels?.expenses || 'Expenses',
      averageTitle: context.labels?.average || 'Average',
      points: chart.points,
      average: chart.average,
    } : null,
  });
}

/** Totals per currency, used in the PDF header and in the UI. */
export function summaryByCurrency(entries, categories, currencies) {
  const codes = [...new Set(entries.map((entry) => entry.currency))].sort();
  return codes.map((code) => {
    const currency = findCurrency(currencies, code);
    const sums = totals(entries.filter((entry) => entry.currency === code), categories);
    return { currency, ...sums };
  });
}

/** Printable report with a summary block, a chart and the entry table. */
export function buildPdfExport(entries, context) {
  const rows = exportRows(entries, context);
  const summary = summaryByCurrency(entries, context.categories, context.currencies);
  const chart = chartData(entries, context);
  return buildPdf({
    chart: chart.hasData ? {
      title: `${context.labels?.expenses || 'Expenses'} (${chart.currency.code})`,
      points: chart.points,
      average: chart.average,
      averageLabel: context.labels?.average || 'average',
      format: (value) => `${value.toFixed(chart.currency.decimals)} ${chart.currency.code}`,
    } : null,
    title: 'Home Budget',
    subtitle: context.subtitle || `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`,
    // The PDF is meant to be read, so its labels follow the interface language.
    // The CSV and the spreadsheet keep English headers, because they get imported again.
    summary: summary.flatMap((item) => {
      const code = item.currency.code;
      const label = (name, fallback) => `${context.labels?.[name] || fallback} (${code})`;
      const lines = [{ label: label('expenses', 'Expenses'), value: formatMoney(item.expense, item.currency) }];
      if (item.income) {
        lines.push({ label: label('income', 'Income'), value: formatMoney(item.income, item.currency) });
      }
      lines.push({
        label: label('balance', 'Balance'),
        value: formatMoney(item.net, item.currency, { sign: true }),
      });
      return lines;
    }),
    columns: [
      { key: 'date', title: context.labels?.date || 'Date', width: 70 },
      { key: 'category', title: context.labels?.category || 'Category', width: 110 },
      { key: 'note', title: context.labels?.note || 'Note', width: 230 },
      { key: 'amount', title: context.labels?.amount || 'Amount', width: 90, align: 'right' },
    ],
    rows: rows.map((row) => ({
      date: formatDate(row.date),
      category: row.category,
      note: row.note,
      amount: `${row.amount.toFixed(2)} ${row.currency}`,
    })),
    footer: `${context.footer || 'Home Budget'} ${APP_VERSION}`,
  });
}

/** Category breakdown lines for a text summary. */
export function breakdownLines(entries, categories, currencies, code) {
  const currency = findCurrency(currencies, code);
  return categoryTotals(entries.filter((entry) => entry.currency === code), categories)
    .map((item) => `${item.name}: ${formatMoney(item.amount, currency)} (${item.share}%)`);
}
