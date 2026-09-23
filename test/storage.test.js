import test from 'node:test';
import assert from 'node:assert/strict';
import {
  loadState, MemoryStorage, migrateState, pickStorage, saveState, STORAGE_KEY,
} from '../src/core/storage.js';

test('MemoryStorage behaves like the Web Storage API', () => {
  const storage = new MemoryStorage({ a: '1' });
  assert.equal(storage.getItem('a'), '1');
  assert.equal(storage.getItem('missing'), null);
  storage.setItem('b', 2);
  assert.equal(storage.getItem('b'), '2');
  storage.removeItem('b');
  assert.equal(storage.getItem('b'), null);
});

test('state survives a save and load round trip', () => {
  const storage = new MemoryStorage();
  const loaded = loadState(storage);
  assert.equal(loaded.fresh, true);
  loaded.state.entries.push({
    id: 'e1', date: '2026-09-22', amount: 1250, categoryId: 'daily', currency: 'EUR', note: 'x',
    createdAt: '2026-09-22T10:00:00.000Z',
  });
  assert.equal(saveState(storage, loaded.state), null);
  const again = loadState(storage);
  assert.equal(again.state.entries.length, 1);
  assert.equal(again.state.entries[0].note, 'x');
  assert.ok(storage.getItem(STORAGE_KEY));
});

test('corrupt or partial documents are repaired', () => {
  const storage = new MemoryStorage({ [STORAGE_KEY]: '{ not json' });
  const result = loadState(storage);
  assert.match(result.error, /unreadable/);
  assert.equal(result.state.entries.length, 0);

  const repaired = migrateState({
    settings: { categories: [], currencies: [], uiMode: 'hologram', theme: 'neon', defaultCurrency: 7 },
    entries: [
      { id: 'ok', date: '2026-01-01', amount: 10.7, categoryId: 5, currency: 'usd' },
      { id: 'bad-amount', date: '2026-01-01', amount: 'x' },
      null,
    ],
  });
  assert.equal(repaired.settings.uiMode, 'auto');
  assert.equal(repaired.settings.theme, 'auto');
  assert.equal(repaired.settings.defaultCurrency, 'EUR');
  assert.ok(repaired.settings.categories.length > 0);
  assert.equal(repaired.entries.length, 1);
  assert.deepEqual(
    { amount: repaired.entries[0].amount, categoryId: repaired.entries[0].categoryId, currency: repaired.entries[0].currency },
    { amount: 11, categoryId: 'daily', currency: 'USD' },
  );
  assert.equal(migrateState(null).entries.length, 0);
  assert.equal(migrateState('text').settings.defaultCategoryId, 'daily');
  assert.equal(migrateState({ settings: { categories: [{ id: 'a', name: 'A' }] }, entries: 'no' }).entries.length, 0);
});

test('data from version 1 gains icons, limits and language settings', () => {
  const upgraded = migrateState({
    version: 1,
    settings: {
      categories: [
        { id: 'daily', name: 'Daily', kind: 'expense', color: '#4f46e5' },
        { id: 'pets', name: 'Pets', kind: 'expense', color: '#000000', limit: 12.7 },
      ],
      currencies: [{ code: 'EUR', symbol: '€', decimals: 2 }],
      defaultCategoryId: 'daily',
      defaultCurrency: 'EUR',
    },
    entries: [{ id: 'e', date: '2026-01-01', amount: 100, categoryId: 'daily', currency: 'EUR' }],
  });
  assert.equal(upgraded.version, 3);
  assert.equal(upgraded.settings.categories[0].limitPeriod, 'month');
  assert.equal(upgraded.settings.currencies[0].rate, 1, 'currencies without a rate get 1');
  assert.equal(upgraded.settings.convertToDefault, false);
  assert.ok(upgraded.appVersion);
  assert.equal(upgraded.settings.categories[0].icon, '☕');
  assert.equal(upgraded.settings.categories[0].nameKey, 'category.daily');
  assert.equal(upgraded.settings.categories[1].icon, '💸');
  assert.equal(upgraded.settings.categories[1].nameKey, undefined);
  assert.equal(upgraded.settings.categories[1].limit, 13);
  assert.equal(upgraded.settings.language, 'auto');
  assert.equal(upgraded.settings.customLanguageName, 'My language');
  assert.deepEqual(upgraded.settings.customTranslation, {});
  assert.equal(upgraded.entries.length, 1);
});

test('rates, limit periods and the conversion switch are validated when loading', () => {
  const state = migrateState({
    settings: {
      categories: [{ id: 'pets', name: 'Pets', kind: 'expense', color: '#000000', limit: 500, limitPeriod: 'week' },
        { id: 'x', name: 'X', kind: 'expense', color: '#000000', limitPeriod: 'century' }],
      currencies: [{ code: 'EUR', symbol: '€', decimals: 2, rate: 1 }, { code: 'USD', symbol: '$', decimals: 2, rate: -3 },
        { code: 'SEK', symbol: 'kr', decimals: 2, rate: '0.09' }],
      convertToDefault: 'yes',
    },
    entries: [],
  });
  assert.equal(state.settings.categories[0].limitPeriod, 'week');
  assert.equal(state.settings.categories[1].limitPeriod, 'month');
  assert.equal(state.settings.currencies[1].rate, 1, 'a broken rate falls back to 1');
  assert.equal(state.settings.currencies[2].rate, 0.09, 'a numeric string is accepted');
  assert.equal(state.settings.convertToDefault, false, 'only true switches conversion on');
  assert.equal(migrateState({ settings: { convertToDefault: true }, entries: [] }).settings.convertToDefault, true);
});

test('language settings are validated when loading', () => {
  const custom = migrateState({
    settings: { language: 'custom', customLanguageName: '  Eesti  ', customTranslation: { 'nav.home': 'Kodu', junk: 1 } },
    entries: [],
  });
  assert.equal(custom.settings.language, 'custom');
  assert.equal(custom.settings.customLanguageName, 'Eesti');
  assert.deepEqual(custom.settings.customTranslation, { 'nav.home': 'Kodu' });
  assert.equal(migrateState({ settings: { language: 'klingon' }, entries: [] }).settings.language, 'auto');
  assert.equal(migrateState({ settings: { language: 'de' }, entries: [] }).settings.language, 'de');
});

test('unreadable and unwritable storage is reported, not thrown', () => {
  const broken = {
    getItem() { throw new Error('blocked'); },
    setItem() { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; },
    removeItem() {},
  };
  assert.match(loadState(broken).error, /not readable/);
  assert.match(saveState(broken, {}), /storage is full/);

  const failing = { getItem: () => null, setItem() { throw new Error('nope'); }, removeItem() {} };
  assert.match(saveState(failing, {}), /Could not save/);
});

test('pickStorage prefers localStorage and falls back to memory', () => {
  const working = new MemoryStorage();
  assert.equal(pickStorage({ localStorage: working }).kind, 'localStorage');

  const blocked = { setItem() { throw new Error('denied'); }, removeItem() {}, getItem: () => null };
  assert.equal(pickStorage({ localStorage: blocked, sessionStorage: new MemoryStorage() }).kind, 'sessionStorage');
  assert.equal(pickStorage({}).kind, 'memory');
  assert.equal(pickStorage({ localStorage: blocked }).kind, 'memory');
});
