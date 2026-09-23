import test from 'node:test';
import assert from 'node:assert/strict';
import { BudgetStore, pickColor } from '../src/core/store.js';
import { AppError } from '../src/core/model.js';

const clock = () => new Date('2026-09-22T10:00:00Z');

function makeStore(options = {}) {
  return new BudgetStore({ clock, ...options });
}

test('quickAdd books an expense in the default category and currency', () => {
  const store = makeStore();
  const entry = store.quickAdd('12,50');
  assert.equal(entry.amount, 1250);
  assert.equal(entry.categoryId, 'daily');
  assert.equal(entry.currency, 'EUR');
  assert.equal(entry.date, '2026-09-22');
  assert.equal(store.entries.length, 1);
  assert.equal(store.quickAdd('-4').amount, 400, 'a minus sign is ignored for quick entries');
  assert.throws(() => store.quickAdd('abc'), /Enter an amount/);
  assert.throws(() => store.quickAdd('0'), /cannot be zero/);
});

test('entries can be added, updated, deleted and filtered', () => {
  const store = makeStore();
  const first = store.addEntry({ amount: 500, categoryId: 'daily', currency: 'EUR', date: '2026-09-20', note: 'tea' });
  const second = store.addEntry({ amount: 900, categoryId: 'groceries', currency: 'USD', date: '2026-09-22', note: 'Rimi' });

  assert.deepEqual(store.list().map((entry) => entry.id), [second.id, first.id]);
  assert.equal(store.list({ from: '2026-09-21' }).length, 1);
  assert.equal(store.list({ to: '2026-09-21' }).length, 1);
  assert.equal(store.list({ categoryId: 'groceries' }).length, 1);
  assert.equal(store.list({ currency: 'USD' }).length, 1);
  assert.equal(store.list({ text: 'rim' }).length, 1);
  assert.equal(store.list({ text: 'daily' }).length, 1, 'search also matches the category name');
  assert.equal(store.list({ text: 'nothing' }).length, 0);

  const updated = store.updateEntry(first.id, { amount: 700, note: 'coffee' });
  assert.equal(updated.amount, 700);
  assert.equal(updated.note, 'coffee');
  assert.equal(store.deleteEntry(second.id).id, second.id);
  assert.equal(store.entries.length, 1);
  assert.throws(() => store.updateEntry('nope', {}), /not found/);
  assert.throws(() => store.deleteEntry('nope'), /not found/);
  assert.throws(() => store.addEntry({ amount: 1, categoryId: 'ghost', currency: 'EUR' }), /Unknown category/);
});

test('entries of the same day keep the newest first', () => {
  let tick = 0;
  const store = new BudgetStore({ clock: () => new Date(Date.UTC(2026, 8, 22, 10, 0, tick += 1)) });
  const first = store.quickAdd('1');
  const second = store.quickAdd('2');
  assert.deepEqual(store.list().map((entry) => entry.id), [second.id, first.id]);
});

test('addEntries skips invalid rows and reports the count', () => {
  const store = makeStore();
  const added = store.addEntries([
    { amount: 100, categoryId: 'daily', currency: 'EUR', date: '2026-09-01' },
    { amount: 0, categoryId: 'daily', currency: 'EUR' },
    { amount: 100, categoryId: 'ghost', currency: 'EUR' },
  ]);
  assert.equal(added, 1);
  assert.equal(store.addEntries([]), 0);
});

test('categories can be created, renamed and deleted', () => {
  const store = makeStore();
  const created = store.addCategory({ name: 'Eating out' });
  assert.equal(created.id, 'eating-out');
  assert.throws(() => store.addCategory({ name: 'eating OUT' }), /already exists/);

  const renamed = store.updateCategory('eating-out', { name: 'Restaurants', kind: 'expense' });
  assert.equal(renamed.name, 'Restaurants');
  assert.throws(() => store.updateCategory('eating-out', { name: 'Groceries' }), /already exists/);
  assert.throws(() => store.updateCategory('ghost', { name: 'X' }), /not found/);

  store.addEntry({ amount: 100, categoryId: 'eating-out', currency: 'EUR', date: '2026-09-22' });
  assert.equal(store.categoryUsage().get('eating-out'), 1);
  assert.throws(() => store.deleteCategory('eating-out'), /used by 1 entry/);
  assert.throws(() => store.deleteCategory('eating-out', 'ghost'), /Unknown category/);
  assert.equal(store.deleteCategory('eating-out', 'daily'), 1);
  assert.equal(store.entries[0].categoryId, 'daily');
  assert.throws(() => store.deleteCategory('daily'), /default category cannot be deleted/);
  assert.throws(() => store.deleteCategory('ghost'), /not found/);
  assert.equal(store.deleteCategory('home'), 0, 'an unused category is removed without moving entries');
});

test('currencies can be added and removed', () => {
  const store = makeStore();
  store.addCurrency({ code: 'sek', symbol: 'kr' });
  assert.ok(store.currencies.some((currency) => currency.code === 'SEK'));
  assert.throws(() => store.addCurrency({ code: 'SEK' }), /already exists/);
  store.addEntry({ amount: 100, categoryId: 'daily', currency: 'SEK', date: '2026-09-22' });
  assert.throws(() => store.deleteCurrency('SEK'), /still used/);
  assert.throws(() => store.deleteCurrency('EUR'), /default currency/);
  assert.throws(() => store.deleteCurrency('NOK'), /not found/);
  store.deleteEntry(store.entries[0].id);
  store.deleteCurrency('SEK');
  assert.ok(!store.currencies.some((currency) => currency.code === 'SEK'));
  assert.deepEqual(store.usedCurrencies(), ['EUR']);
  store.addEntry({ amount: 100, categoryId: 'daily', currency: 'USD', date: '2026-09-22' });
  assert.deepEqual(store.usedCurrencies(), ['EUR', 'USD']);
});

test('settings are validated', () => {
  const store = makeStore();
  store.updateSettings({ defaultCategoryId: 'groceries', defaultCurrency: 'USD', uiMode: 'mobile', theme: 'dark' });
  assert.deepEqual(
    [store.settings.defaultCategoryId, store.settings.defaultCurrency, store.settings.uiMode, store.settings.theme],
    ['groceries', 'USD', 'mobile', 'dark'],
  );
  assert.throws(() => store.updateSettings({ defaultCategoryId: 'ghost' }), AppError);
  assert.throws(() => store.updateSettings({ defaultCurrency: 'XXX' }), AppError);
  assert.throws(() => store.updateSettings({ uiMode: 'watch' }), /display mode/);
  assert.throws(() => store.updateSettings({ theme: 'sepia' }), /theme/);
  assert.equal(store.updateSettings({}).uiMode, 'mobile');
});

test('listeners and persistence run on every change', () => {
  const saved = [];
  const seen = [];
  const store = makeStore({ persist: (state) => { saved.push(state.entries.length); return null; } });
  const unsubscribe = store.subscribe((state) => seen.push(state.entries.length));
  store.quickAdd('1');
  store.quickAdd('2');
  unsubscribe();
  store.quickAdd('3');
  assert.deepEqual(seen, [1, 2]);
  assert.deepEqual(saved, [1, 2, 3]);

  const failing = makeStore({ persist: () => 'storage is full' });
  failing.quickAdd('1');
  assert.equal(failing.lastError, 'storage is full');
});

test('categoryByNameOrCreate reuses existing names', () => {
  const store = makeStore();
  assert.equal(store.categoryByNameOrCreate('daily').id, 'daily');
  assert.equal(store.categoryByNameOrCreate('DAILY').id, 'daily');
  assert.equal(store.categoryByNameOrCreate('').id, 'daily');
  const created = store.categoryByNameOrCreate('Pets');
  assert.equal(created.id, 'pets');
  assert.equal(store.categoryByNameOrCreate('pets').id, 'pets');
  assert.ok(pickColor(0).startsWith('#'));
  assert.equal(pickColor(8), pickColor(0));
});

test('budgets track the limits of the current month', () => {
  const store = makeStore();
  store.updateCategory('groceries', { limit: 40000 });
  store.updateCategory('transport', { limit: 10000 });
  store.addEntry({ amount: 12000, categoryId: 'groceries', currency: 'EUR', date: '2026-09-05' });
  store.addEntry({ amount: 35000, categoryId: 'groceries', currency: 'EUR', date: '2026-09-20' });
  store.addEntry({ amount: 9900, categoryId: 'groceries', currency: 'EUR', date: '2026-08-31', note: 'last month' });
  store.addEntry({ amount: 5000, categoryId: 'transport', currency: 'USD', date: '2026-09-10', note: 'other currency' });

  const budgets = store.budgets('EUR');
  assert.deepEqual(budgets.map((budget) => budget.category.id), ['groceries', 'transport']);
  assert.equal(budgets[0].spent, 47000);
  assert.equal(budgets[0].percent, 118);
  assert.equal(budgets[0].over, true);
  assert.equal(budgets[0].remaining, -7000);
  assert.equal(budgets[1].spent, 0);
  assert.equal(budgets[1].over, false);
  assert.equal(budgets[1].remaining, 10000);
  assert.deepEqual(makeStore().budgets('EUR'), [], 'without limits there is nothing to show');
});

test('month ends are calculated correctly', () => {
  const store = makeStore();
  assert.equal(store.monthEnd('2026-02-01'), '2026-02-28');
  assert.equal(store.monthEnd('2024-02-01'), '2024-02-29');
  assert.equal(store.monthEnd('2026-09-01'), '2026-09-30');
  assert.equal(store.monthEnd('2026-12-01'), '2026-12-31');
});

test('renaming a predefined category drops its translated name', () => {
  const store = makeStore();
  assert.equal(store.category('daily').nameKey, 'category.daily');
  const renamed = store.updateCategory('daily', { name: 'Pocket money' });
  assert.equal(renamed.nameKey, undefined);
  assert.equal(renamed.name, 'Pocket money');
  const recoloured = store.updateCategory('groceries', { color: '#111111' });
  assert.equal(recoloured.nameKey, 'category.groceries', 'other changes keep the translation');
});

test('language settings are validated', () => {
  const store = makeStore();
  store.updateSettings({ language: 'de' });
  assert.equal(store.settings.language, 'de');
  store.updateSettings({ language: 'custom', customLanguageName: '  Eesti  ', customTranslation: { 'nav.home': 'Kodu', junk: 'x' } });
  assert.equal(store.settings.customLanguageName, 'Eesti');
  assert.deepEqual(store.settings.customTranslation, { 'nav.home': 'Kodu' });
  store.updateSettings({ customLanguageName: '   ' });
  assert.equal(store.settings.customLanguageName, 'My language');
  assert.throws(() => store.updateSettings({ language: 'klingon' }), /Unknown language/);
});

test('replaceState and clearEntries', () => {
  const store = makeStore();
  store.quickAdd('5');
  assert.equal(store.clearEntries(), 1);
  assert.equal(store.entries.length, 0);
  store.replaceState({ version: 1, settings: store.settings, entries: [] });
  assert.equal(store.entries.length, 0);
  assert.equal(store.today(), '2026-09-22');
  assert.equal(store.currency().code, 'EUR');
  assert.equal(store.category('daily').name, 'Daily');
  assert.equal(new BudgetStore().settings.defaultCurrency, 'EUR');
});
