/**
 * Persistence in browser storage. The app keeps one JSON document per storage key,
 * which is small enough for localStorage (5 MB holds roughly 60 000 entries).
 */

import {
  createDefaultState, defaultCategories, defaultCurrencies, flagForCurrency, LIMIT_PERIODS, STATE_VERSION,
} from './model.js';
import { APP_VERSION } from './version.js';
import { CUSTOM_LANGUAGE, LANGUAGES, sanitizeTranslation } from './i18n.js';

export const STORAGE_KEY = 'home-budget/v1';

/** Icons given to categories that were created before version 2. */
const LEGACY_ICONS = {
  daily: '\u2615', monthly: '\ud83d\udd01', yearly: '\ud83d\udcc5', groceries: '\ud83d\uded2',
  transport: '\ud83d\ude8c', home: '\ud83c\udfe0', income: '\ud83d\udcb0',
};

/** In-memory storage used by tests and as a fallback when the browser blocks storage. */
export class MemoryStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial));
  }

  getItem(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  setItem(key, value) {
    this.map.set(key, String(value));
  }

  removeItem(key) {
    this.map.delete(key);
  }
}

/**
 * Picks the best available storage: localStorage, then sessionStorage, then memory.
 * Private mode can expose localStorage but throw on write, so writing is probed.
 */
export function pickStorage(globalObject = globalThis) {
  for (const name of ['localStorage', 'sessionStorage']) {
    try {
      const candidate = globalObject[name];
      if (!candidate) continue;
      const probe = '__hb_probe__';
      candidate.setItem(probe, '1');
      candidate.removeItem(probe);
      return { storage: candidate, kind: name };
    } catch {
      // Reading the property alone can throw when the browser blocks storage for
      // the page, and a private window can accept setItem and then refuse to keep
      // it. Writing a probe and removing it again is the only reliable test.
    }
  }
  return { storage: new MemoryStorage(), kind: 'memory' };
}

/** Upgrades and repairs a stored document; unknown or broken data falls back to defaults. */
export function migrateState(raw) {
  const fallback = createDefaultState();
  if (!raw || typeof raw !== 'object') return fallback;
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const knownIds = new Set(defaultCategories().map((category) => category.id));
  const categories = (Array.isArray(settings.categories) && settings.categories.length
    ? settings.categories.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
    : defaultCategories()
  ).map((category) => ({
    ...category,
    icon: typeof category.icon === 'string' && category.icon
      ? category.icon
      : (LEGACY_ICONS[category.id] || '\ud83d\udcb8'),
    limit: Number.isFinite(category.limit) && category.limit > 0 ? Math.round(category.limit) : null,
    limitPeriod: LIMIT_PERIODS.includes(category.limitPeriod) ? category.limitPeriod : 'month',
    nameKey: typeof category.nameKey === 'string' ? category.nameKey
      : (knownIds.has(category.id) ? `category.${category.id}` : undefined),
  }));
  const currencies = (Array.isArray(settings.currencies) && settings.currencies.length
    ? settings.currencies.filter((c) => c && typeof c.code === 'string')
    : defaultCurrencies()
  ).map((currency) => ({
    ...currency,
    rate: Number.isFinite(Number(currency.rate)) && Number(currency.rate) > 0 ? Number(currency.rate) : 1,
    flag: typeof currency.flag === 'string' && currency.flag
      ? currency.flag
      : flagForCurrency(String(currency.code).toUpperCase()),
  }));
  const entries = Array.isArray(raw.entries)
    ? raw.entries.filter((e) => e && typeof e.id === 'string' && typeof e.date === 'string'
        && Number.isFinite(e.amount))
    : [];
  return {
    version: STATE_VERSION,
    appVersion: APP_VERSION,
    settings: {
      categories: categories.length ? categories : defaultCategories(),
      currencies: currencies.length ? currencies : defaultCurrencies(),
      defaultCategoryId: typeof settings.defaultCategoryId === 'string'
        ? settings.defaultCategoryId : fallback.settings.defaultCategoryId,
      defaultCurrency: typeof settings.defaultCurrency === 'string'
        ? settings.defaultCurrency : fallback.settings.defaultCurrency,
      // Missing means the state was written before the app followed the
      // language, so the currency it holds is one the person has lived with:
      // treat it as chosen, and leave it exactly where it is.
      currencyChosen: typeof settings.currencyChosen === 'boolean' ? settings.currencyChosen : true,
      uiMode: ['auto', 'mobile', 'desktop'].includes(settings.uiMode) ? settings.uiMode : 'auto',
      convertToDefault: settings.convertToDefault === true,
      theme: ['auto', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'auto',
      language: typeof settings.language === 'string'
        && (settings.language === 'auto' || settings.language === CUSTOM_LANGUAGE
          || LANGUAGES.some((item) => item.code === settings.language))
        ? settings.language : 'auto',
      customLanguageName: typeof settings.customLanguageName === 'string' && settings.customLanguageName.trim()
        ? settings.customLanguageName.trim().slice(0, 40) : 'My language',
      customTranslation: sanitizeTranslation(settings.customTranslation),
    },
    entries: entries.map((entry) => ({
      id: entry.id,
      date: entry.date,
      amount: Math.round(entry.amount),
      categoryId: typeof entry.categoryId === 'string' ? entry.categoryId : 'daily',
      currency: typeof entry.currency === 'string' ? entry.currency.toUpperCase() : 'EUR',
      note: typeof entry.note === 'string' ? entry.note : '',
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date(0).toISOString(),
    })),
  };
}

/** Reads the state; corrupt JSON is reported and replaced by defaults. */
export function loadState(storage, key = STORAGE_KEY) {
  let raw = null;
  try {
    raw = storage.getItem(key);
  } catch {
    return { state: createDefaultState(), error: 'Storage is not readable' };
  }
  if (raw === null) return { state: createDefaultState(), error: null, fresh: true };
  try {
    return { state: migrateState(JSON.parse(raw)), error: null };
  } catch {
    return { state: createDefaultState(), error: 'Saved data was unreadable and has been reset' };
  }
}

/** Writes the state. Returns an error message when the browser refuses (e.g. quota). */
export function saveState(storage, state, key = STORAGE_KEY) {
  try {
    storage.setItem(key, JSON.stringify(state));
    return null;
  } catch (error) {
    return error && error.name === 'QuotaExceededError'
      ? 'Browser storage is full - export your data and remove old entries'
      : 'Could not save to browser storage';
  }
}
