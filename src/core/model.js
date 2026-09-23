/** Domain objects: entries, categories, currencies, and the default application state. */

import { isIsoDate, todayIso } from './format.js';

/** Error with a message meant to be shown to the user. */
export class AppError extends Error {}

export const STATE_VERSION = 1;
export const DEFAULT_CATEGORY_ID = 'daily';
export const MAX_NOTE_LENGTH = 200;
export const MAX_NAME_LENGTH = 40;

/** The category every quick entry goes to. */
export function defaultCategory() {
  return { id: DEFAULT_CATEGORY_ID, name: 'Daily', kind: 'expense', color: '#4f46e5' };
}

export function defaultCategories() {
  return [
    defaultCategory(),
    { id: 'groceries', name: 'Groceries', kind: 'expense', color: '#ea580c' },
    { id: 'transport', name: 'Transport', kind: 'expense', color: '#0284c7' },
    { id: 'home', name: 'Home', kind: 'expense', color: '#7c3aed' },
    { id: 'income', name: 'Income', kind: 'income', color: '#16a34a' },
  ];
}

export function defaultCurrencies() {
  return [
    { code: 'EUR', symbol: '€', decimals: 2 },
    { code: 'USD', symbol: '$', decimals: 2 },
    { code: 'GBP', symbol: '£', decimals: 2 },
  ];
}

/** A fresh, empty application state. */
export function createDefaultState() {
  return {
    version: STATE_VERSION,
    settings: {
      categories: defaultCategories(),
      currencies: defaultCurrencies(),
      defaultCategoryId: DEFAULT_CATEGORY_ID,
      defaultCurrency: 'EUR',
      uiMode: 'auto',
      theme: 'auto',
    },
    entries: [],
  };
}

let idCounter = 0;

/** Sortable unique id: timestamp in base36 plus a counter. */
export function newId(now = Date.now()) {
  idCounter = (idCounter + 1) % 1000;
  return now.toString(36) + '-' + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
}

/** Turns a name into an id: "Eating out" -> "eating-out". */
export function slugify(name) {
  const slug = String(name).toLowerCase().trim()
    .replace(/[^a-z0-9À-ɏЀ-ӿ]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'category';
}

/**
 * Validates and normalizes an entry.
 * @throws {AppError} when a field is missing or wrong
 */
export function createEntry(input, now = new Date()) {
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new AppError('Amount must be a whole number of minor units');
  }
  if (amount === 0) throw new AppError('Amount cannot be zero');
  const date = input.date === undefined || input.date === null || input.date === '' ? todayIso(now) : input.date;
  if (!isIsoDate(date)) throw new AppError('Date must be yyyy-mm-dd');
  if (!input.categoryId) throw new AppError('Category is required');
  if (!input.currency) throw new AppError('Currency is required');
  const note = String(input.note ?? '').trim();
  if (note.length > MAX_NOTE_LENGTH) throw new AppError(`Note must be at most ${MAX_NOTE_LENGTH} characters`);
  return {
    id: input.id || newId(),
    date,
    amount,
    categoryId: String(input.categoryId),
    currency: String(input.currency).toUpperCase(),
    note,
    createdAt: input.createdAt || new Date(now).toISOString(),
  };
}

/** Validates and normalizes a category. */
export function createCategory(input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new AppError('Category name is required');
  if (name.length > MAX_NAME_LENGTH) throw new AppError(`Name must be at most ${MAX_NAME_LENGTH} characters`);
  const kind = input.kind === 'income' ? 'income' : 'expense';
  const color = /^#[0-9a-fA-F]{6}$/.test(input.color || '') ? String(input.color).toLowerCase() : '#4f46e5';
  return { id: input.id || slugify(name), name, kind, color };
}

/** Validates and normalizes a currency. */
export function createCurrency(input) {
  const code = String(input.code ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2,5}$/.test(code)) throw new AppError('Currency code must be 2-5 letters, e.g. EUR');
  const decimals = Number.isInteger(input.decimals) ? input.decimals : 2;
  if (decimals < 0 || decimals > 4) throw new AppError('Decimals must be between 0 and 4');
  const symbol = String(input.symbol ?? '').trim() || code;
  return { code, symbol, decimals };
}

/** Looks up a currency, falling back to a 2-decimal placeholder. */
export function findCurrency(currencies, code) {
  return currencies.find((currency) => currency.code === code) || { code, symbol: code, decimals: 2 };
}

/** Looks up a category, falling back to a placeholder for entries of a deleted category. */
export function findCategory(categories, id) {
  return categories.find((category) => category.id === id)
    || { id, name: id || 'Unknown', kind: 'expense', color: '#94a3b8' };
}

/** Expenses count negative, income positive. */
export function signedAmount(entry, categories) {
  return findCategory(categories, entry.categoryId).kind === 'income' ? entry.amount : -entry.amount;
}
