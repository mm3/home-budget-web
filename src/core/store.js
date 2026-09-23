/**
 * Application state and the operations the UI performs on it.
 * The store owns the data, validates every change and notifies listeners.
 */

import {
  AppError, convertAmount, createCategory, createCurrency, createEntry, createDefaultState,
  findCategory, findCurrency, slugify,
} from './model.js';
import { isIsoDate, parseAmount, periodEnd, periodStart, todayIso } from './format.js';
import { CUSTOM_LANGUAGE, LANGUAGES, sanitizeTranslation } from './i18n.js';
import { APP_VERSION } from './version.js';

export class BudgetStore {
  /**
   * @param {object} [options]
   * @param {object} [options.state] initial state (defaults are used when omitted)
   * @param {(state: object) => (string|null)} [options.persist] called after every change
   * @param {() => Date} [options.clock] current time, injected for tests
   */
  constructor(options = {}) {
    this.state = options.state || createDefaultState();
    this.persist = options.persist || (() => null);
    this.clock = options.clock || (() => new Date());
    this.listeners = new Set();
    this.lastError = null;
  }

  /** Registers a listener; returns a function that removes it. */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get settings() {
    return this.state.settings;
  }

  get entries() {
    return this.state.entries;
  }

  get categories() {
    return this.state.settings.categories;
  }

  get currencies() {
    return this.state.settings.currencies;
  }

  category(id) {
    return findCategory(this.categories, id);
  }

  currency(code) {
    return findCurrency(this.currencies, code || this.settings.defaultCurrency);
  }

  today() {
    return todayIso(this.clock());
  }

  // ---------------------------------------------------------------- entries

  /** Adds an entry from the quick form: amount only, everything else default. */
  quickAdd(amountText) {
    const currency = this.currency(this.settings.defaultCurrency);
    const amount = parseAmount(amountText, currency.decimals);
    if (amount === null) throw new AppError('Enter an amount, for example 12.50');
    // "0.001" in a currency with two decimals rounds to nothing - that is not the
    // same mistake as typing a plain zero, and saying so avoids a puzzling error.
    if (amount === 0) {
      throw new AppError(/[1-9]/.test(String(amountText)) ? 'This amount is too small' : 'Amount cannot be zero');
    }
    return this.addEntry({
      amount: Math.abs(amount),
      categoryId: this.settings.defaultCategoryId,
      currency: currency.code,
      date: this.today(),
    });
  }

  addEntry(input) {
    const entry = createEntry(input, this.clock());
    if (!this.categories.some((category) => category.id === entry.categoryId)) {
      throw new AppError('Unknown category');
    }
    this.state.entries.push(entry);
    this.#changed();
    return entry;
  }

  updateEntry(id, changes) {
    const index = this.state.entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new AppError('Entry not found');
    const updated = createEntry({ ...this.state.entries[index], ...changes, id }, this.clock());
    this.state.entries[index] = updated;
    this.#changed();
    return updated;
  }

  deleteEntry(id) {
    const index = this.state.entries.findIndex((entry) => entry.id === id);
    if (index < 0) throw new AppError('Entry not found');
    const [removed] = this.state.entries.splice(index, 1);
    this.#changed();
    return removed;
  }

  /** Adds many entries at once (used by the importer). Invalid rows are skipped. */
  addEntries(entries) {
    let added = 0;
    for (const input of entries) {
      try {
        const entry = createEntry(input, this.clock());
        if (!this.categories.some((category) => category.id === entry.categoryId)) continue;
        this.state.entries.push(entry);
        added += 1;
      } catch {
        // skipped, the importer reports these rows separately
      }
    }
    if (added) this.#changed();
    return added;
  }

  /**
   * Entries filtered and sorted newest first.
   * @param {{from?: string, to?: string, categoryId?: string, currency?: string, text?: string}} [filter]
   */
  list(filter = {}) {
    const text = (filter.text || '').trim().toLowerCase();
    return this.state.entries
      .filter((entry) => {
        if (filter.from && entry.date < filter.from) return false;
        if (filter.to && entry.date > filter.to) return false;
        if (filter.categoryId && entry.categoryId !== filter.categoryId) return false;
        if (filter.currency && entry.currency !== filter.currency) return false;
        if (text) {
          const haystack = `${entry.note} ${this.category(entry.categoryId).name}`.toLowerCase();
          if (!haystack.includes(text)) return false;
        }
        return true;
      })
      .sort((a, b) => (a.date === b.date
        ? String(b.createdAt).localeCompare(String(a.createdAt))
        : b.date.localeCompare(a.date)));
  }

  // ------------------------------------------------------------- categories

  addCategory(input) {
    const category = createCategory(input);
    if (this.categories.some((existing) => existing.id === category.id
        || existing.name.toLowerCase() === category.name.toLowerCase())) {
      throw new AppError(`Category "${category.name}" already exists`);
    }
    this.categories.push(category);
    this.#changed();
    return category;
  }

  updateCategory(id, changes) {
    const index = this.categories.findIndex((category) => category.id === id);
    if (index < 0) throw new AppError('Category not found');
    const current = this.categories[index];
    // a renamed predefined category keeps the user's name instead of the translated one
    const renamed = changes.name !== undefined && String(changes.name).trim() !== current.name;
    const updated = createCategory({ ...current, ...changes, id, keepNameKey: !renamed });
    if (this.categories.some((other, otherIndex) => otherIndex !== index
        && other.name.toLowerCase() === updated.name.toLowerCase())) {
      throw new AppError(`Category "${updated.name}" already exists`);
    }
    this.categories[index] = updated;
    this.#changed();
    return updated;
  }

  /** Number of entries per category id. */
  categoryUsage() {
    const usage = new Map();
    for (const entry of this.state.entries) {
      usage.set(entry.categoryId, (usage.get(entry.categoryId) || 0) + 1);
    }
    return usage;
  }

  /**
   * Deletes a category. Entries move to `moveToId` when given, otherwise the category
   * must be empty. The default category cannot be deleted.
   */
  deleteCategory(id, moveToId = null) {
    if (id === this.settings.defaultCategoryId) throw new AppError('The default category cannot be deleted');
    const index = this.categories.findIndex((category) => category.id === id);
    if (index < 0) throw new AppError('Category not found');
    const used = this.categoryUsage().get(id) || 0;
    if (used > 0) {
      if (!moveToId) {
        throw new AppError(`"${this.category(id).name}" is used by ${used} ${used === 1 ? 'entry' : 'entries'}`);
      }
      if (!this.categories.some((category) => category.id === moveToId)) throw new AppError('Unknown category');
      for (const entry of this.state.entries) {
        if (entry.categoryId === id) entry.categoryId = moveToId;
      }
    }
    this.categories.splice(index, 1);
    this.#changed();
    return used;
  }

  // ------------------------------------------------------------- currencies

  addCurrency(input) {
    const currency = createCurrency(input);
    if (this.currencies.some((existing) => existing.code === currency.code)) {
      throw new AppError(`Currency ${currency.code} already exists`);
    }
    this.currencies.push(currency);
    this.#changed();
    return currency;
  }

  /** Changes the symbol, decimals or rate of a currency. */
  updateCurrency(code, changes) {
    const index = this.currencies.findIndex((currency) => currency.code === code);
    if (index < 0) throw new AppError('Currency not found');
    this.currencies[index] = createCurrency({ ...this.currencies[index], ...changes, code });
    this.#changed();
    return this.currencies[index];
  }

  deleteCurrency(code) {
    if (code === this.settings.defaultCurrency) throw new AppError('The default currency cannot be removed');
    const index = this.currencies.findIndex((currency) => currency.code === code);
    if (index < 0) throw new AppError('Currency not found');
    if (this.state.entries.some((entry) => entry.currency === code)) {
      throw new AppError(`${code} is still used by some entries`);
    }
    this.currencies.splice(index, 1);
    this.#changed();
  }

  /** Currency codes that appear in the data, default currency first. */
  usedCurrencies() {
    const used = new Set(this.state.entries.map((entry) => entry.currency));
    used.add(this.settings.defaultCurrency);
    return [...used].sort((a, b) => {
      if (a === this.settings.defaultCurrency) return -1;
      if (b === this.settings.defaultCurrency) return 1;
      return a.localeCompare(b);
    });
  }

  // --------------------------------------------------------------- settings

  updateSettings(changes) {
    const settings = this.settings;
    if (changes.defaultCategoryId !== undefined) {
      if (!this.categories.some((category) => category.id === changes.defaultCategoryId)) {
        throw new AppError('Unknown category');
      }
      settings.defaultCategoryId = changes.defaultCategoryId;
    }
    if (changes.defaultCurrency !== undefined) {
      if (!this.currencies.some((currency) => currency.code === changes.defaultCurrency)) {
        throw new AppError('Unknown currency');
      }
      settings.defaultCurrency = changes.defaultCurrency;
    }
    if (changes.uiMode !== undefined) {
      if (!['auto', 'mobile', 'desktop'].includes(changes.uiMode)) throw new AppError('Unknown display mode');
      settings.uiMode = changes.uiMode;
    }
    if (changes.convertToDefault !== undefined) {
      settings.convertToDefault = changes.convertToDefault === true;
    }
    if (changes.theme !== undefined) {
      if (!['auto', 'light', 'dark'].includes(changes.theme)) throw new AppError('Unknown theme');
      settings.theme = changes.theme;
    }
    if (changes.language !== undefined) {
      const allowed = ['auto', CUSTOM_LANGUAGE, ...LANGUAGES.map((item) => item.code)];
      if (!allowed.includes(changes.language)) throw new AppError('Unknown language');
      settings.language = changes.language;
    }
    if (changes.customLanguageName !== undefined) {
      settings.customLanguageName = String(changes.customLanguageName).trim().slice(0, 40) || 'My language';
    }
    if (changes.customTranslation !== undefined) {
      settings.customTranslation = sanitizeTranslation(changes.customTranslation);
    }
    this.#changed();
    return settings;
  }

  /** Replaces everything, e.g. after importing a backup. */
  replaceState(state) {
    this.state = state;
    this.#changed();
  }

  /**
   * Throws everything away: entries, categories, currencies and settings all go
   * back to what a fresh installation has. Deleting the entries does NOT do this.
   */
  resetAll() {
    this.state = createDefaultState();
    this.#changed();
  }

  /** Deletes all entries but keeps the categories, currencies and settings. */
  clearEntries() {
    const removed = this.state.entries.length;
    this.state.entries = [];
    this.#changed();
    return removed;
  }

  /**
   * Entries shown for a currency: only that currency, or everything converted into it
   * when "convert to the default currency" is switched on.
   */
  entriesIn(currencyCode) {
    if (!this.settings.convertToDefault) {
      return this.state.entries.filter((entry) => entry.currency === currencyCode);
    }
    return this.state.entries.map((entry) => (entry.currency === currencyCode ? entry : {
      ...entry,
      amount: convertAmount(entry.amount, entry.currency, currencyCode, this.currencies),
      currency: currencyCode,
      convertedFrom: entry.currency,
    }));
  }

  /** Converts an amount between two of the configured currencies. */
  convert(amount, fromCode, toCode) {
    return convertAmount(amount, fromCode, toCode, this.currencies);
  }

  /**
   * Spending against each category's limit, measured over that category's own period.
   * @returns {Array<{category: object, spent: number, limit: number, period: string,
   *                  from: string, to: string, percent: number, over: boolean, remaining: number}>}
   */
  budgets(currencyCode, today = this.today()) {
    const entries = this.entriesIn(currencyCode);
    return this.categories
      .filter((category) => category.kind === 'expense' && category.limit)
      .map((category) => {
        const period = category.limitPeriod || 'month';
        const from = periodStart(today, period);
        const to = periodEnd(today, period);
        const used = entries
          .filter((entry) => entry.categoryId === category.id && entry.date >= from && entry.date <= to)
          .reduce((sum, entry) => sum + entry.amount, 0);
        return {
          category,
          period,
          from,
          to,
          spent: used,
          limit: category.limit,
          percent: Math.round((used / category.limit) * 100),
          over: used > category.limit,
          remaining: category.limit - used,
        };
      })
      .sort((a, b) => b.percent - a.percent);
  }

  /** Finds a category by name (case-insensitive) or creates one. */
  categoryByNameOrCreate(name) {
    const wanted = String(name || '').trim();
    if (!wanted) return this.category(this.settings.defaultCategoryId);
    const existing = this.categories.find((category) => category.name.toLowerCase() === wanted.toLowerCase()
      || category.id === slugify(wanted));
    return existing || this.addCategory({ name: wanted, color: pickColor(this.categories.length) });
  }

  #changed() {
    this.state.appVersion = APP_VERSION; // the file that last wrote this data
    this.lastError = this.persist(this.state);
    for (const listener of this.listeners) listener(this.state);
  }
}

// Eight hues far enough apart to tell a chart's slices apart. These are data,
// not interface: they stay varied whatever colour the interface itself is.
const PALETTE = ['#4f46e5', '#ea580c', '#0284c7', '#16a34a', '#db2777', '#ca8a04', '#7c3aed', '#0d9488'];

/** Colour for a newly created category. */
export function pickColor(index) {
  return PALETTE[index % PALETTE.length];
}
