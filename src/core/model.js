/** Domain objects: entries, categories, currencies, and the default application state. */

import { isIsoDate, todayIso } from './format.js';
import { APP_VERSION, DATA_VERSION } from './version.js';

/** Error with a message meant to be shown to the user. */
export class AppError extends Error {}

export const STATE_VERSION = DATA_VERSION;

/** Periods a spending limit can be set for. */
export const LIMIT_PERIODS = ['day', 'week', 'month', 'year'];
export const DEFAULT_CATEGORY_ID = 'daily';
export const MAX_NOTE_LENGTH = 200;
/**
 * Biggest amount one entry may hold, in minor units: a thousand million major
 * units, e.g. 1 000 000 000.00 EUR. Far beyond any home budget, and low enough
 * that even a full store of entries adds up well inside the range where integers
 * stay exact (2^53), so no single entry can turn the totals into nonsense.
 */
export const MAX_AMOUNT = 100000000000;
export const MAX_NAME_LENGTH = 40;

/** The category every quick entry goes to. */
export function defaultCategory() {
  return {
    id: DEFAULT_CATEGORY_ID, name: 'Daily', nameKey: 'category.daily',
    kind: 'expense', color: '#4f46e5', icon: '\u2615', limit: null, limitPeriod: 'month',
  };
}

/**
 * Categories every new installation starts with: the three spending rhythms
 * (daily, monthly, yearly) plus a few common ones and income.
 */
export function defaultCategories() {
  return [
    defaultCategory(),
    { id: 'monthly', name: 'Monthly', nameKey: 'category.monthly', kind: 'expense', color: '#0f766e', icon: '\ud83d\udd01', limit: null, limitPeriod: 'month' },
    { id: 'yearly', name: 'Yearly', nameKey: 'category.yearly', kind: 'expense', color: '#b45309', icon: '\ud83d\udcc5', limit: null, limitPeriod: 'year' },
    { id: 'budget', name: 'Budget', nameKey: 'category.budget', kind: 'expense', color: '#be185d', icon: '\ud83d\udecd\ufe0f', limit: null, limitPeriod: 'month' },
    { id: 'groceries', name: 'Groceries', nameKey: 'category.groceries', kind: 'expense', color: '#ea580c', icon: '\ud83d\uded2', limit: null, limitPeriod: 'week' },
    { id: 'transport', name: 'Transport', nameKey: 'category.transport', kind: 'expense', color: '#0284c7', icon: '\ud83d\ude8c', limit: null, limitPeriod: 'month' },
    { id: 'home', name: 'Home', nameKey: 'category.home', kind: 'expense', color: '#7c3aed', icon: '\ud83c\udfe0', limit: null, limitPeriod: 'month' },
    { id: 'income', name: 'Income', nameKey: 'category.income', kind: 'income', color: '#16a34a', icon: '\ud83d\udcb0', limit: null, limitPeriod: 'month' },
  ];
}

/** Emojis offered in the category form. */
export const ICON_CHOICES = ['\u2615', '\ud83d\udd01', '\ud83d\udcc5', '\ud83d\uded2', '\ud83d\ude8c', '\ud83c\udfe0',
  '\ud83d\udcb0', '\ud83c\udf74', '\ud83d\udc8a', '\ud83c\udfac', '\ud83d\udc55', '\ud83d\udcf1', '\u26a1', '\ud83d\udc36',
  '\ud83c\udf81', '\u2708\ufe0f', '\ud83d\udcda', '\ud83c\udfcb\ufe0f', '\ud83d\udc76', '\ud83d\udd27', '\ud83d\udcb3', '\u2753'];

/**
 * Currencies a new installation knows about. Symbols are kept distinct on purpose:
 * three Nordic crowns and two yen would otherwise share one sign, and an amount has
 * to say which currency it is in. `rate` is how much one unit is worth in the
 * default currency; these values are only a starting point and are meant to be edited in the
 * settings, because an offline app cannot look rates up.
 */
export function defaultCurrencies() {
  return [
    { code: 'EUR', symbol: '€', flag: '🇪🇺', decimals: 2, rate: 1 },
    { code: 'USD', symbol: '$', flag: '🇺🇸', decimals: 2, rate: 0.92 },
    { code: 'GBP', symbol: '£', flag: '🇬🇧', decimals: 2, rate: 1.17 },
    { code: 'CHF', symbol: 'Fr', flag: '🇨🇭', decimals: 2, rate: 1.04 },
    { code: 'SEK', symbol: 'Skr', flag: '🇸🇪', decimals: 2, rate: 0.088 },
    { code: 'NOK', symbol: 'Nkr', flag: '🇳🇴', decimals: 2, rate: 0.086 },
    { code: 'DKK', symbol: 'Dkr', flag: '🇩🇰', decimals: 2, rate: 0.134 },
    { code: 'PLN', symbol: 'zł', flag: '🇵🇱', decimals: 2, rate: 0.23 },
    { code: 'CZK', symbol: 'Kč', flag: '🇨🇿', decimals: 2, rate: 0.04 },
    { code: 'RUB', symbol: '₽', flag: '🇷🇺', decimals: 2, rate: 0.0098 },
    { code: 'UAH', symbol: '₴', flag: '🇺🇦', decimals: 2, rate: 0.022 },
    { code: 'TRY', symbol: '₺', flag: '🇹🇷', decimals: 2, rate: 0.026 },
    { code: 'KZT', symbol: '₸', flag: '🇰🇿', decimals: 2, rate: 0.0019 },
    { code: 'GEL', symbol: '₾', flag: '🇬🇪', decimals: 2, rate: 0.34 },
    { code: 'RON', symbol: 'lei', flag: '🇷🇴', decimals: 2, rate: 0.2 },
    { code: 'HUF', symbol: 'Ft', flag: '🇭🇺', decimals: 0, rate: 0.0025 },
    { code: 'BGN', symbol: 'лв', flag: '🇧🇬', decimals: 2, rate: 0.51 },
    { code: 'CAD', symbol: 'C$', flag: '🇨🇦', decimals: 2, rate: 0.66 },
    { code: 'AUD', symbol: 'A$', flag: '🇦🇺', decimals: 2, rate: 0.6 },
    { code: 'NZD', symbol: 'NZ$', flag: '🇳🇿', decimals: 2, rate: 0.55 },
    { code: 'JPY', symbol: '¥', flag: '🇯🇵', decimals: 0, rate: 0.0059 },
    { code: 'CNY', symbol: 'CN¥', flag: '🇨🇳', decimals: 2, rate: 0.13 },
    { code: 'INR', symbol: '₹', flag: '🇮🇳', decimals: 2, rate: 0.011 },
    { code: 'ILS', symbol: '₪', flag: '🇮🇱', decimals: 2, rate: 0.25 },
  ];
}

/** Flags for the currencies people add by hand; the code's country is a good guess. */
const FLAGS_BY_CODE = {
  AED: '🇦🇪', ARS: '🇦🇷', AMD: '🇦🇲', AZN: '🇦🇿', BRL: '🇧🇷', BYN: '🇧🇾', CLP: '🇨🇱', COP: '🇨🇴',
  EGP: '🇪🇬', HKD: '🇭🇰', IDR: '🇮🇩', ISK: '🇮🇸', KRW: '🇰🇷', MDL: '🇲🇩', MXN: '🇲🇽', MYR: '🇲🇾',
  NGN: '🇳🇬', PHP: '🇵🇭', PKR: '🇵🇰', RSD: '🇷🇸', SAR: '🇸🇦', SGD: '🇸🇬', THB: '🇹🇭', TWD: '🇹🇼',
  UZS: '🇺🇿', VND: '🇻🇳', ZAR: '🇿🇦',
};

/**
 * The flag shown next to a currency. Known codes get their country's flag, the
 * rest get a neutral exchange symbol, so every currency has an icon.
 */
export function flagForCurrency(code) {
  const known = defaultCurrencies().find((currency) => currency.code === code);
  return known ? known.flag : (FLAGS_BY_CODE[code] || '💱');
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
      convertToDefault: false,
      language: 'auto',
      customLanguageName: 'My language',
      customTranslation: {},
    },
    appVersion: APP_VERSION,
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
  if (Math.abs(amount) > MAX_AMOUNT) throw new AppError('This amount is too large');
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
  const limitPeriod = LIMIT_PERIODS.includes(input.limitPeriod) ? input.limitPeriod : 'month';
  const category = { id: input.id || slugify(name), name, kind, color, icon, limit, limitPeriod };
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
  const rate = input.rate === undefined || input.rate === null || input.rate === '' ? 1 : Number(input.rate);
  if (!Number.isFinite(rate) || rate <= 0) throw new AppError('The rate must be a positive number');
  const given = String(input.flag ?? '').trim();
  if ([...given].length > 3) throw new AppError('The flag must be a single emoji');
  const flag = given || flagForCurrency(code);
  return { code, symbol, flag, decimals, rate };
}

/**
 * Converts minor units from one currency to another using the stored rates.
 * Rates are relative to the default currency, so the conversion goes through it.
 */
export function convertAmount(amount, fromCode, toCode, currencies) {
  if (fromCode === toCode) return amount;
  const from = findCurrency(currencies, fromCode);
  const to = findCurrency(currencies, toCode);
  const fromRate = Number(from.rate) > 0 ? Number(from.rate) : 1;
  const toRate = Number(to.rate) > 0 ? Number(to.rate) : 1;
  const major = (amount / 10 ** from.decimals) * (fromRate / toRate);
  return Math.round(major * 10 ** to.decimals);
}

/** Looks up a currency, falling back to a 2-decimal placeholder. */
export function findCurrency(currencies, code) {
  return currencies.find((currency) => currency.code === code) || { code, symbol: code, decimals: 2, rate: 1 };
}

/** Looks up a category, falling back to a placeholder for entries of a deleted category. */
export function findCategory(categories, id) {
  return categories.find((category) => category.id === id)
    || { id, name: id || 'Unknown', kind: 'expense', color: '#94a3b8', icon: '\u2753', limit: null, limitPeriod: 'month' };
}

/** Expenses count negative, income positive. */
export function signedAmount(entry, categories) {
  return findCategory(categories, entry.categoryId).kind === 'income' ? entry.amount : -entry.amount;
}
