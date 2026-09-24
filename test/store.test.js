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

test('currencies can be added, changed and removed', () => {
  const store = makeStore();
  store.deleteCurrency('SEK');
  store.addCurrency({ code: 'sek', symbol: 'kr', rate: 0.09 });
  assert.ok(store.currencies.some((currency) => currency.code === 'SEK'));
  assert.throws(() => store.addCurrency({ code: 'SEK' }), /already exists/);
  store.addEntry({ amount: 100, categoryId: 'daily', currency: 'SEK', date: '2026-09-22' });
  assert.throws(() => store.deleteCurrency('SEK'), /still used/);
  assert.throws(() => store.deleteCurrency('EUR'), /default currency/);
  assert.throws(() => store.deleteCurrency('XXX'), /not found/);
  store.deleteEntry(store.entries[0].id);
  assert.equal(store.updateCurrency('SEK', { rate: 0.1 }).rate, 0.1);
  assert.throws(() => store.updateCurrency('XXX', { rate: 1 }), /not found/);
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

test('budgets track the limits of the current period', () => {
  const store = makeStore();
  store.updateCategory('groceries', { limit: 40000, limitPeriod: 'month' });
  store.updateCategory('transport', { limit: 10000, limitPeriod: 'month' });
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

test('each category can use its own limit period', () => {
  const store = makeStore();
  store.updateCategory('groceries', { limit: 10000, limitPeriod: 'week' });
  store.updateCategory('yearly', { limit: 200000, limitPeriod: 'year' });
  store.updateCategory('daily', { limit: 2000, limitPeriod: 'day' });
  store.addEntry({ amount: 6000, categoryId: 'groceries', currency: 'EUR', date: '2026-09-21' });
  store.addEntry({ amount: 9000, categoryId: 'groceries', currency: 'EUR', date: '2026-09-14', note: 'week before' });
  store.addEntry({ amount: 50000, categoryId: 'yearly', currency: 'EUR', date: '2026-03-01' });
  store.addEntry({ amount: 500, categoryId: 'daily', currency: 'EUR', date: '2026-09-22' });

  const byId = new Map(store.budgets('EUR').map((budget) => [budget.category.id, budget]));
  assert.deepEqual(
    { period: byId.get('groceries').period, from: byId.get('groceries').from, to: byId.get('groceries').to },
    { period: 'week', from: '2026-09-21', to: '2026-09-27' },
  );
  assert.equal(byId.get('groceries').spent, 6000, 'the previous week does not count');
  assert.equal(byId.get('yearly').spent, 50000);
  assert.equal(byId.get('yearly').from, '2026-01-01');
  assert.equal(byId.get('daily').from, '2026-09-22');
  assert.equal(byId.get('daily').spent, 500);
  assert.equal(byId.get('daily').percent, 25);
});

test('conversion folds every currency into the shown one', () => {
  const store = makeStore();
  store.updateCurrency('USD', { rate: 0.5 });
  store.addEntry({ amount: 1000, categoryId: 'daily', currency: 'EUR', date: '2026-09-22' });
  store.addEntry({ amount: 2000, categoryId: 'daily', currency: 'USD', date: '2026-09-22' });

  assert.equal(store.entriesIn('EUR').length, 1, 'without conversion only one currency is shown');
  store.updateSettings({ convertToDefault: true });
  const converted = store.entriesIn('EUR');
  assert.equal(converted.length, 2);
  assert.equal(converted[1].amount, 1000, '20.00 USD at 0.5 is 10.00 EUR');
  assert.equal(converted[1].currency, 'EUR');
  assert.equal(converted[1].convertedFrom, 'USD');
  assert.equal(store.convert(2000, 'USD', 'EUR'), 1000);
  store.updateCategory('daily', { limit: 5000, limitPeriod: 'month' });
  assert.equal(store.budgets('EUR')[0].spent, 2000, 'budgets use the converted amounts');
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

test('deleting the entries keeps the settings, resetting does not', () => {
  const store = makeStore();
  store.addCategory({ name: 'My own category' });
  store.addCurrency({ code: 'XTS', symbol: 'T' });
  store.updateSettings({ theme: 'dark' });
  store.quickAdd('12.50');
  const categories = store.categories.length;

  assert.equal(store.clearEntries(), 1);
  assert.equal(store.entries.length, 0);
  assert.equal(store.categories.length, categories, 'the categories stay');
  assert.ok(store.currencies.some((currency) => currency.code === 'XTS'), 'the currencies stay');
  assert.equal(store.settings.theme, 'dark', 'the settings stay');

  store.quickAdd('5');
  store.resetAll();
  assert.equal(store.entries.length, 0);
  assert.ok(!store.categories.some((category) => category.name === 'My own category'));
  assert.ok(!store.currencies.some((currency) => currency.code === 'XTS'));
  assert.equal(store.settings.theme, 'auto');
});

test('an amount that rounds away says so instead of claiming it is zero', () => {
  const store = makeStore();
  assert.throws(() => store.quickAdd('0.001'), /too small/);
  assert.throws(() => store.quickAdd('0'), /cannot be zero/);
  assert.throws(() => store.quickAdd('0.00'), /cannot be zero/);
  assert.throws(() => store.quickAdd('1e15'), /Enter an amount/, 'no exponent sneaks through');
  assert.throws(() => store.quickAdd('999999999999999'), /too large/);
  assert.equal(store.quickAdd('0.005').amount, 1, 'half a cent still rounds up to one');
});

test('picking a currency marks it as the person\'s own; the app guessing does not', () => {
  const store = makeStore();
  assert.equal(store.settings.currencyChosen, false);

  // The app following the interface language leaves the flag alone, so it stays
  // free to follow again on the next change.
  store.updateSettings({ defaultCurrency: 'RUB', currencyChosen: false });
  assert.equal(store.settings.defaultCurrency, 'RUB');
  assert.equal(store.settings.currencyChosen, false);

  // A plain change is the person choosing, and that is final.
  store.updateSettings({ defaultCurrency: 'USD' });
  assert.equal(store.settings.currencyChosen, true);

  // Which the app's own guess must not undo.
  store.updateSettings({ defaultCurrency: 'EUR', currencyChosen: false });
  assert.equal(store.settings.currencyChosen, false);
});

test('a stored state written before the app followed the language keeps its currency', async () => {
  const { migrateState } = await import('../src/core/storage.js');
  // No flag in the stored settings means an older version wrote them: the
  // currency in there is one the person has lived with, so it counts as chosen.
  const older = migrateState({ settings: { defaultCurrency: 'GBP' }, entries: [] });
  assert.equal(older.settings.defaultCurrency, 'GBP');
  assert.equal(older.settings.currencyChosen, true);

  // A newer state says for itself.
  const newer = migrateState({ settings: { defaultCurrency: 'RUB', currencyChosen: false }, entries: [] });
  assert.equal(newer.settings.currencyChosen, false);
});
