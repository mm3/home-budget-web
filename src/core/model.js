/** Domain objects: entries, categories, currencies, and the default application state. */

import { isIsoDate, todayIso } from './format.js';

/** Error with a message meant to be shown to the user. */
export class AppError extends Error {}

export const STATE_VERSION = 2;
export const DEFAULT_CATEGORY_ID = 'daily';
export const MAX_NOTE_LENGTH = 200;
export const MAX_NAME_LENGTH = 40;

/** The category every quick entry goes to. */
export function defaultCategory() {
  return {
    id: DEFAULT_CATEGORY_ID, name: 'Daily', nameKey: 'category.daily',
    kind: 'expense', color: '#4f46e5', icon: '\u2615', limit: null,
  };
}

/**
 * Categories every new installation starts with: the three spending rhythms
 * (daily, monthly, yearly) plus a few common ones and income.
 */
export function defaultCategories() {
  return [
    defaultCategory(),
    { id: 'monthly', name: 'Monthly', nameKey: 'category.monthly', kind: 'expense', color: '#0f766e', icon: '\ud83d\udd01', limit: null },
    { id: 'yearly', name: 'Yearly', nameKey: 'category.yearly', kind: 'expense', color: '#b45309', icon: '\ud83d\udcc5', limit: null },
    { id: 'groceries', name: 'Groceries', nameKey: 'category.groceries', kind: 'expense', color: '#ea580c', icon: '\ud83d\uded2', limit: null },
    { id: 'transport', name: 'Transport', nameKey: 'category.transport', kind: 'expense', color: '#0284c7', icon: '\ud83d\ude8c', limit: null },
    { id: 'home', name: 'Home', nameKey: 'category.home', kind: 'expense', color: '#7c3aed', icon: '\ud83c\udfe0', limit: null },
    { id: 'income', name: 'Income', nameKey: 'category.income', kind: 'income', color: '#16a34a', icon: '\ud83d\udcb0', limit: null },
  ];
}

/** Emojis offered in the category form. */
export const ICON_CHOICES = ['\u2615', '\ud83d\udd01', '\ud83d\udcc5', '\ud83d\uded2', '\ud83d\ude8c', '\ud83c\udfe0',
  '\ud83d\udcb0', '\ud83c\udf74', '\ud83d\udc8a', '\ud83c\udfac', '\ud83d\udc55', '\ud83d\udcf1', '\u26a1', '\ud83d\udc36',
  '\ud83c\udf81', '\u2708\ufe0f', '\ud83d\udcda', '\ud83c\udfcb\ufe0f', '\ud83d\udc76', '\ud83d\udd27', '\ud83d\udcb3', '\u2753'];

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
      language: 'auto',
      customLanguageName: 'My language',
      customTranslation: {},
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

/**
 * Validates and normalizes a category.
 * `nameKey` marks a predefined category whose name is translated; renaming clears it.
 * `limit` is an optional monthly spending limit in minor units.
 */
export function createCategory(input) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new AppError('Category name is required');
  if (name.length > MAX_NAME_LENGTH) throw new AppError(`Name must be at most ${MAX_NAME_LENGTH} characters`);
  const kind = input.kind === 'income' ? 'income' : 'expense';
  const color = /^#[0-9a-fA-F]{6}$/.test(input.color || '') ? String(input.color).toLowerCase() : '#4f46e5';
  const icon = [...String(input.icon ?? '').trim()].slice(0, 2).join('') || '\ud83d\udcb8';
  let limit = null;
  if (input.limit !== null && input.limit !== undefined && input.limit !== '') {
    const value = Number(input.limit);
    if (!Number.isFinite(value) || !Number.isInteger(value)) throw new AppError('Limit must be a whole number of minor units');
    if (value < 0) throw new AppError('Limit cannot be negative');
    limit = value || null;
  }
  const category = { id: input.id || slugify(name), name, kind, color, icon, limit };
  if (input.nameKey && input.keepNameKey !== false) category.nameKey = input.nameKey;
  return category;
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
    || { id, name: id || 'Unknown', kind: 'expense', color: '#94a3b8', icon: '\u2753', limit: null };
}

/** Expenses count negative, income positive. */
export function signedAmount(entry, categories) {
  return findCategory(categories, entry.categoryId).kind === 'income' ? entry.amount : -entry.amount;
}
