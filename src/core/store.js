/**
 * Application state and the operations the UI performs on it.
 * The store owns the data, validates every change and notifies listeners.
 */

import {
  AppError, createCategory, createCurrency, createEntry, createDefaultState,
  findCategory, findCurrency, slugify,
} from './model.js';
import { isIsoDate, parseAmount, todayIso } from './format.js';

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
    if (amount === 0) throw new AppError('Amount cannot be zero');
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
    const updated = createCategory({ ...this.categories[index], ...changes, id });
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
    if (changes.theme !== undefined) {
      if (!['auto', 'light', 'dark'].includes(changes.theme)) throw new AppError('Unknown theme');
      settings.theme = changes.theme;
    }
    this.#changed();
    return settings;
  }

  /** Replaces everything, e.g. after importing a backup. */
  replaceState(state) {
    this.state = state;
    this.#changed();
  }

  /** Deletes all entries but keeps the settings. */
  clearEntries() {
    const removed = this.state.entries.length;
    this.state.entries = [];
    this.#changed();
    return removed;
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
    this.lastError = this.persist(this.state);
    for (const listener of this.listeners) listener(this.state);
  }
}

const PALETTE = ['#4f46e5', '#ea580c', '#0284c7', '#16a34a', '#db2777', '#ca8a04', '#7c3aed', '#0d9488'];

/** Colour for a newly created category. */
export function pickColor(index) {
  return PALETTE[index % PALETTE.length];
}
