import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError, createCategory, createCurrency, createDefaultState, createEntry, defaultCategory,
  findCategory, findCurrency, ICON_CHOICES, newId, signedAmount, slugify,
} from '../src/core/model.js';

const NOW = new Date('2026-09-22T10:00:00Z');

test('the default state has the Daily category and EUR', () => {
  const state = createDefaultState();
  assert.equal(state.settings.defaultCategoryId, 'daily');
  assert.equal(state.settings.defaultCurrency, 'EUR');
  assert.equal(state.settings.language, 'auto');
  assert.deepEqual(state.settings.customTranslation, {});
  assert.equal(defaultCategory().name, 'Daily');
  assert.ok(state.settings.categories.some((category) => category.id === 'daily'));
  assert.deepEqual(state.entries, []);
});

test('the predefined categories cover daily, monthly and yearly spending', () => {
  const ids = createDefaultState().settings.categories.map((category) => category.id);
  assert.deepEqual(ids.slice(0, 3), ['daily', 'monthly', 'yearly']);
  for (const category of createDefaultState().settings.categories) {
    assert.ok(category.icon, `${category.id} has an icon`);
    assert.equal(category.nameKey, `category.${category.id}`);
    assert.equal(category.limit, null);
  }
});

test('categories carry an icon and an optional limit', () => {
  const pets = createCategory({ name: 'Pets', icon: '🐶🐱🐭', limit: 5000 });
  assert.equal(pets.icon, '🐶🐱', 'at most two characters are kept');
  assert.equal(pets.limit, 5000);
  assert.equal(createCategory({ name: 'X' }).icon, '💸', 'a default icon is used');
  assert.equal(createCategory({ name: 'X', limit: '' }).limit, null);
  assert.equal(createCategory({ name: 'X', limit: 0 }).limit, null);
  assert.throws(() => createCategory({ name: 'X', limit: -1 }), /cannot be negative/);
  assert.throws(() => createCategory({ name: 'X', limit: 1.5 }), /whole number/);
  assert.throws(() => createCategory({ name: 'X', limit: 'abc' }), /whole number/);
  assert.equal(createCategory({ name: 'Daily', nameKey: 'category.daily' }).nameKey, 'category.daily');
  assert.equal(createCategory({ name: 'Mine', nameKey: 'category.daily', keepNameKey: false }).nameKey, undefined);
  assert.equal(ICON_CHOICES.length > 10, true);
});

test('createEntry validates and normalizes', () => {
  const entry = createEntry({ amount: 1250, categoryId: 'daily', currency: 'eur', note: '  milk  ' }, NOW);
  assert.equal(entry.currency, 'EUR');
  assert.equal(entry.note, 'milk');
  assert.equal(entry.date, '2026-09-22');
  assert.ok(entry.id);
  assert.equal(createEntry({ amount: 1, categoryId: 'daily', currency: 'EUR', date: '' }, NOW).date, '2026-09-22');
});

test('createEntry rejects bad input', () => {
  const base = { amount: 100, categoryId: 'daily', currency: 'EUR' };
  assert.throws(() => createEntry({ ...base, amount: 1.5 }, NOW), AppError);
  assert.throws(() => createEntry({ ...base, amount: 'x' }, NOW), AppError);
  assert.throws(() => createEntry({ ...base, amount: 0 }, NOW), AppError);
  assert.throws(() => createEntry({ ...base, date: '22.09.2026' }, NOW), /yyyy-mm-dd/);
  assert.throws(() => createEntry({ ...base, categoryId: '' }, NOW), /Category is required/);
  assert.throws(() => createEntry({ ...base, currency: '' }, NOW), /Currency is required/);
  assert.throws(() => createEntry({ ...base, note: 'x'.repeat(201) }, NOW), /at most 200/);
});

test('categories and currencies are validated', () => {
  assert.deepEqual(createCategory({ name: ' Eating out ' }),
    { id: 'eating-out', name: 'Eating out', kind: 'expense', color: '#4f46e5', icon: '💸', limit: null });
  assert.equal(createCategory({ name: 'Pay', kind: 'income', color: '#ABCDEF' }).color, '#abcdef');
  assert.equal(createCategory({ name: 'X', color: 'red' }).color, '#4f46e5');
  assert.throws(() => createCategory({ name: '  ' }), /name is required/);
  assert.throws(() => createCategory({ name: 'x'.repeat(41) }), /at most 40/);

  assert.deepEqual(createCurrency({ code: 'sek', symbol: ' kr ' }), { code: 'SEK', symbol: 'kr', decimals: 2 });
  assert.equal(createCurrency({ code: 'JPY', decimals: 0 }).symbol, 'JPY');
  assert.throws(() => createCurrency({ code: 'e' }), /2-5 letters/);
  assert.throws(() => createCurrency({ code: 'EUR', decimals: 9 }), /between 0 and 4/);
});

test('slugify and newId produce usable identifiers', () => {
  assert.equal(slugify('Eating out!'), 'eating-out');
  assert.equal(slugify('  '), 'category');
  assert.equal(slugify('Продукты'), 'продукты');
  assert.notEqual(newId(), newId());
});

test('lookups fall back to placeholders', () => {
  const categories = [{ id: 'daily', name: 'Daily', kind: 'expense', color: '#000000' }];
  assert.equal(findCategory(categories, 'daily').name, 'Daily');
  assert.equal(findCategory(categories, 'gone').name, 'gone');
  assert.equal(findCategory(categories, '').name, 'Unknown');
  assert.equal(findCurrency([{ code: 'EUR', symbol: '€', decimals: 2 }], 'EUR').symbol, '€');
  assert.equal(findCurrency([], 'SEK').symbol, 'SEK');
});

test('signedAmount makes expenses negative', () => {
  const categories = [
    { id: 'daily', name: 'Daily', kind: 'expense', color: '#000000' },
    { id: 'pay', name: 'Pay', kind: 'income', color: '#000000' },
  ];
  assert.equal(signedAmount({ amount: 100, categoryId: 'daily' }, categories), -100);
  assert.equal(signedAmount({ amount: 100, categoryId: 'pay' }, categories), 100);
});
