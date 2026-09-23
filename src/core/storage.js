/**
 * Persistence in browser storage. The app keeps one JSON document per storage key,
 * which is small enough for localStorage (5 MB holds roughly 60 000 entries).
 */

import { createDefaultState, defaultCategories, defaultCurrencies, STATE_VERSION } from './model.js';

export const STORAGE_KEY = 'home-budget/v1';

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
      // not usable, try the next one
    }
  }
  return { storage: new MemoryStorage(), kind: 'memory' };
}

/** Upgrades and repairs a stored document; unknown or broken data falls back to defaults. */
export function migrateState(raw) {
  const fallback = createDefaultState();
  if (!raw || typeof raw !== 'object') return fallback;
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  const categories = Array.isArray(settings.categories) && settings.categories.length
    ? settings.categories.filter((c) => c && typeof c.id === 'string' && typeof c.name === 'string')
    : defaultCategories();
  const currencies = Array.isArray(settings.currencies) && settings.currencies.length
    ? settings.currencies.filter((c) => c && typeof c.code === 'string')
    : defaultCurrencies();
  const entries = Array.isArray(raw.entries)
    ? raw.entries.filter((e) => e && typeof e.id === 'string' && typeof e.date === 'string'
        && Number.isFinite(e.amount))
    : [];
  return {
    version: STATE_VERSION,
    settings: {
      categories: categories.length ? categories : defaultCategories(),
      currencies: currencies.length ? currencies : defaultCurrencies(),
      defaultCategoryId: typeof settings.defaultCategoryId === 'string'
        ? settings.defaultCategoryId : fallback.settings.defaultCategoryId,
      defaultCurrency: typeof settings.defaultCurrency === 'string'
        ? settings.defaultCurrency : fallback.settings.defaultCurrency,
      uiMode: ['auto', 'mobile', 'desktop'].includes(settings.uiMode) ? settings.uiMode : 'auto',
      theme: ['auto', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'auto',
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
