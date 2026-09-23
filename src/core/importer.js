/**
 * Importing entries from CSV and XLSX files whose column layout is unknown.
 * The structure is detected from the header names and, when those do not help,
 * from what the cells actually contain.
 */

import { isIsoDate, parseAmount, parseDateLoose } from './format.js';
import { excelSerialToIso } from './xlsx.js';

/** Header names understood for each field, in several languages. */
export const HEADER_SYNONYMS = {
  date: ['date', 'day', 'when', 'datum', 'fecha', 'data', 'kuupäev', 'kuupaev', 'дата', 'день', 'дата операции'],
  amount: ['amount', 'sum', 'total', 'value', 'price', 'cost', 'spent', 'debit', 'betrag', 'summe', 'importe',
    'summa', 'сумма', 'стоимость', 'расход'],
  category: ['category', 'categories', 'type', 'kind', 'group', 'kategorie', 'categoria', 'kategooria',
    'категория', 'тип', 'группа'],
  currency: ['currency', 'cur', 'ccy', 'währung', 'wahrung', 'valuuta', 'moneda', 'валюта'],
  note: ['note', 'notes', 'comment', 'comments', 'description', 'memo', 'details', 'text', 'purpose',
    'kommentar', 'beschreibung', 'selgitus', 'märkus', 'markus', 'комментарий', 'примечание', 'описание'],
};

const SYMBOL_TO_CODE = { '€': 'EUR', $: 'USD', '£': 'GBP', '₽': 'RUB', '₴': 'UAH', '₸': 'KZT', '¥': 'JPY', zł: 'PLN' };

const EXCEL_SERIAL_MIN = 20000; // 1954-10-04, earlier values are more likely plain numbers
const EXCEL_SERIAL_MAX = 60000; // 2064-04-08

function normalizeHeader(value) {
  return String(value ?? '').toLowerCase().trim().replace(/[.\-_]+/g, ' ').replace(/\s+/g, ' ');
}

function matchField(header) {
  const text = normalizeHeader(header);
  if (!text) return null;
  for (const [field, names] of Object.entries(HEADER_SYNONYMS)) {
    if (names.includes(text)) return field;
  }
  for (const [field, names] of Object.entries(HEADER_SYNONYMS)) {
    if (names.some((name) => text.includes(name))) return field;
  }
  return null;
}

/** Share of cells in a column that look like dates / numbers / text. */
function profileColumn(rows, index) {
  let dates = 0;
  let numbers = 0;
  let texts = 0;
  let filled = 0;
  const distinct = new Set();
  for (const row of rows) {
    const value = row[index];
    if (value === undefined || value === null || value === '') continue;
    filled += 1;
    distinct.add(String(value).toLowerCase());
    if (typeof value === 'number') {
      if (value >= EXCEL_SERIAL_MIN && value <= EXCEL_SERIAL_MAX && Number.isInteger(value)) dates += 1;
      else numbers += 1;
      continue;
    }
    if (parseDateLoose(value)) dates += 1;
    else if (parseAmount(value) !== null && /\d/.test(value)) numbers += 1;
    else texts += 1;
  }
  const total = Math.max(1, filled);
  return {
    index,
    filled,
    dateRatio: dates / total,
    numberRatio: numbers / total,
    textRatio: texts / total,
    distinct: distinct.size,
  };
}

/**
 * Detects the header row and which column holds which field.
 * @param {Array<Array<string|number>>} rows raw rows from CSV or XLSX
 * @returns {{headerRow: number|null, mapping: object, confidence: 'header'|'content'|'none', warnings: string[]}}
 */
export function detectStructure(rows) {
  const warnings = [];
  const mapping = { date: null, amount: null, category: null, currency: null, note: null };
  if (!rows.length) return { headerRow: null, mapping, confidence: 'none', warnings: ['The file is empty'] };

  let headerRow = null;
  let bestMatches = 0;
  for (let index = 0; index < Math.min(5, rows.length); index += 1) {
    const matches = rows[index].map(matchField).filter(Boolean);
    const unique = new Set(matches);
    if (unique.size >= 2 && unique.size > bestMatches) {
      bestMatches = unique.size;
      headerRow = index;
    }
  }

  if (headerRow !== null) {
    rows[headerRow].forEach((header, column) => {
      const field = matchField(header);
      if (field && mapping[field] === null) mapping[field] = column;
    });
  }

  const dataRows = rows.slice(headerRow === null ? 0 : headerRow + 1);
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const profiles = [];
  for (let column = 0; column < width; column += 1) profiles.push(profileColumn(dataRows, column));

  const used = new Set(Object.values(mapping).filter((value) => value !== null));
  const pick = (field, score) => {
    if (mapping[field] !== null) return;
    const candidates = profiles
      .filter((profile) => !used.has(profile.index) && profile.filled > 0)
      .map((profile) => ({ profile, score: score(profile) }))
      .filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score);
    if (candidates.length) {
      mapping[field] = candidates[0].profile.index;
      used.add(candidates[0].profile.index);
    }
  };

  pick('date', (profile) => (profile.dateRatio >= 0.6 ? profile.dateRatio : 0));
  pick('amount', (profile) => (profile.numberRatio >= 0.6 ? profile.numberRatio : 0));
  pick('category', (profile) => (profile.textRatio >= 0.6 && profile.distinct <= Math.max(3, dataRows.length * 0.6)
    ? profile.textRatio + 1 / (profile.distinct + 1) : 0));
  pick('note', (profile) => (profile.textRatio >= 0.5 ? profile.textRatio : 0));

  if (mapping.amount === null) warnings.push('No column with amounts was found');
  if (mapping.date === null) warnings.push('No date column was found - today\'s date will be used');

  const confidence = headerRow !== null ? 'header' : (mapping.amount !== null ? 'content' : 'none');
  return { headerRow, mapping, confidence, warnings };
}

/** Reads a cell as a date: ISO text, local formats, or an Excel serial number. */
export function readDate(value) {
  if (typeof value === 'number') {
    return value >= EXCEL_SERIAL_MIN && value <= EXCEL_SERIAL_MAX ? excelSerialToIso(value) : null;
  }
  const text = String(value ?? '').trim();
  if (!text) return null;
  const numeric = Number(text);
  if (Number.isFinite(numeric) && Number.isInteger(numeric)
      && numeric >= EXCEL_SERIAL_MIN && numeric <= EXCEL_SERIAL_MAX) {
    return excelSerialToIso(numeric);
  }
  return parseDateLoose(text);
}

/** Reads a currency cell: a code, a symbol, or nothing. */
export function readCurrency(value, knownCodes) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const upper = text.toUpperCase();
  if (knownCodes.includes(upper)) return upper;
  for (const [symbol, code] of Object.entries(SYMBOL_TO_CODE)) {
    if (text.includes(symbol)) return knownCodes.includes(code) ? code : null;
  }
  return /^[A-Z]{3}$/.test(upper) ? upper : null;
}

/**
 * Converts raw rows into entries using a mapping.
 * @param {Array<Array<string|number>>} rows
 * @param {{headerRow: number|null, mapping: object}} structure
 * @param {{categories: Array<{id: string, name: string, kind: string}>, currencies: Array<{code: string, decimals: number}>,
 *          defaultCategoryId: string, defaultCurrency: string, today: string}} context
 * @returns {{entries: object[], skipped: Array<{row: number, reason: string}>, newCategories: string[]}}
 */
export function convertRows(rows, structure, context) {
  const { mapping, headerRow } = structure;
  const dataRows = rows.slice(headerRow === null ? 0 : headerRow + 1);
  const codes = context.currencies.map((currency) => currency.code);
  const decimalsOf = (code) => {
    const currency = context.currencies.find((item) => item.code === code);
    return currency ? currency.decimals : 2;
  };
  const byName = new Map(context.categories.map((category) => [category.name.toLowerCase(), category]));
  const entries = [];
  const skipped = [];
  const newCategories = [];

  dataRows.forEach((row, index) => {
    const rowNumber = (headerRow === null ? 0 : headerRow + 1) + index + 1;
    const rawAmount = mapping.amount === null ? '' : row[mapping.amount];
    const currency = (mapping.currency === null ? null : readCurrency(row[mapping.currency], codes))
      || context.defaultCurrency;
    const decimals = decimalsOf(currency);
    const amount = typeof rawAmount === 'number'
      ? Math.round(rawAmount * 10 ** decimals)
      : parseAmount(rawAmount, decimals);
    if (amount === null || amount === 0) {
      skipped.push({ row: rowNumber, reason: 'no amount' });
      return;
    }
    const date = mapping.date === null ? context.today : readDate(row[mapping.date]);
    if (!date || !isIsoDate(date)) {
      skipped.push({ row: rowNumber, reason: 'unreadable date' });
      return;
    }
    const categoryName = mapping.category === null ? '' : String(row[mapping.category] ?? '').trim();
    let category = categoryName ? byName.get(categoryName.toLowerCase()) : null;
    if (categoryName && !category) {
      if (!newCategories.includes(categoryName)) newCategories.push(categoryName);
      category = { id: null, name: categoryName, kind: amount < 0 ? 'expense' : 'income' };
    }
    const note = mapping.note === null ? '' : String(row[mapping.note] ?? '').trim();
    const isIncome = category ? category.kind === 'income' : false;
    entries.push({
      date,
      amount: Math.abs(amount),
      categoryId: category && category.id ? category.id : null,
      categoryName: category ? category.name : null,
      isIncome,
      currency,
      note: note.slice(0, 200),
    });
  });

  return { entries, skipped, newCategories };
}

/** Short human summary of what an import will do. */
export function describeImport(result) {
  const parts = [`${result.entries.length} ${result.entries.length === 1 ? 'entry' : 'entries'}`];
  if (result.newCategories.length) parts.push(`${result.newCategories.length} new categories`);
  if (result.skipped.length) parts.push(`${result.skipped.length} skipped`);
  return parts.join(', ');
}
