/** Turns entries into the rows used by the CSV, XLSX and PDF exports. */

import { toCsv } from './csv.js';
import { formatDate, formatMoney, toPlainAmount } from './format.js';
import { findCategory, findCurrency } from './model.js';
import { buildPdf } from './pdf.js';
import { buildXlsx } from './xlsx.js';
import { byCategory, totals } from './stats.js';

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
      category: category.name,
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

/** Spreadsheet bytes. */
export function buildXlsxExport(entries, context) {
  return buildXlsx({
    sheetName: 'Home Budget',
    columns: EXPORT_COLUMNS,
    rows: exportRows(entries, context),
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

/** Printable report with a summary block and the entry table. */
export function buildPdfExport(entries, context) {
  const rows = exportRows(entries, context);
  const summary = summaryByCurrency(entries, context.categories, context.currencies);
  return buildPdf({
    title: 'Home Budget',
    subtitle: context.subtitle || `${rows.length} ${rows.length === 1 ? 'entry' : 'entries'}`,
    summary: summary.flatMap((item) => {
      const code = item.currency.code;
      const lines = [{ label: `Expenses (${code})`, value: formatMoney(item.expense, item.currency) }];
      if (item.income) lines.push({ label: `Income (${code})`, value: formatMoney(item.income, item.currency) });
      lines.push({ label: `Balance (${code})`, value: formatMoney(item.net, item.currency, { sign: true }) });
      return lines;
    }),
    columns: [
      { key: 'date', title: 'Date', width: 70 },
      { key: 'category', title: 'Category', width: 110 },
      { key: 'note', title: 'Note', width: 230 },
      { key: 'amount', title: 'Amount', width: 90, align: 'right' },
    ],
    rows: rows.map((row) => ({
      date: formatDate(row.date),
      category: row.category,
      note: row.note,
      amount: `${row.amount.toFixed(2)} ${row.currency}`,
    })),
    footer: context.footer || '',
  });
}

/** Category breakdown lines for the PDF or a text summary. */
export function breakdownLines(entries, categories, currencies, code) {
  const currency = findCurrency(currencies, code);
  return byCategory(entries.filter((entry) => entry.currency === code), categories)
    .map((item) => `${item.name}: ${formatMoney(item.amount, currency)} (${item.share}%)`);
}
