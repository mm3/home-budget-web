import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AppError, convertAmount, createCategory, createCurrency, createDefaultState, createEntry, defaultCategory,
  defaultCurrencies, findCategory, findCurrency, ICON_CHOICES, LIMIT_PERIODS, MAX_AMOUNT, newId,
  signedAmount, slugify,
} from '../src/core/model.js';
import { APP_VERSION } from '../src/core/version.js';

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

test('the predefined categories cover daily, monthly and yearly spending and planned shopping', () => {
  const ids = createDefaultState().settings.categories.map((category) => category.id);
  assert.deepEqual(ids.slice(0, 4), ['daily', 'monthly', 'yearly', 'budget']);
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
  assert.equal(createCategory({ name: 'X', limitPeriod: 'week' }).limitPeriod, 'week');
  assert.equal(createCategory({ name: 'X', limitPeriod: 'century' }).limitPeriod, 'month', 'unknown periods fall back');
  assert.deepEqual(LIMIT_PERIODS, ['day', 'week', 'month', 'year']);
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
    { id: 'eating-out', name: 'Eating out', kind: 'expense', color: '#4f46e5', icon: '💸', limit: null, limitPeriod: 'month' });
  assert.equal(createCategory({ name: 'Pay', kind: 'income', color: '#ABCDEF' }).color, '#abcdef');
  assert.equal(createCategory({ name: 'X', color: 'red' }).color, '#4f46e5');
  assert.throws(() => createCategory({ name: '  ' }), /name is required/);
  assert.throws(() => createCategory({ name: 'x'.repeat(41) }), /at most 40/);

  assert.deepEqual(createCurrency({ code: 'sek', symbol: ' kr ' }),
    { code: 'SEK', symbol: 'kr', flag: '🇸🇪', decimals: 2, rate: 1 });
  assert.equal(createCurrency({ code: 'RUB' }).flag, '🇷🇺', 'known codes get their own flag');
  assert.equal(createCurrency({ code: 'XYZ' }).flag, '💱', 'unknown codes still get an icon');
  assert.equal(createCurrency({ code: 'SEK', flag: ' 🏴 ' }).flag, '🏴', 'a given flag wins');
  assert.throws(() => createCurrency({ code: 'SEK', flag: 'abcd' }), /single emoji/);
  assert.equal(createCurrency({ code: 'SEK', rate: '0.09' }).rate, 0.09);
  assert.throws(() => createCurrency({ code: 'SEK', rate: 0 }), /positive number/);
  assert.throws(() => createCurrency({ code: 'SEK', rate: 'abc' }), /positive number/);
  assert.equal(createCurrency({ code: 'JPY', decimals: 0 }).symbol, 'JPY');
  assert.throws(() => createCurrency({ code: 'e' }), /2-5 letters/);
  assert.throws(() => createCurrency({ code: 'EUR', decimals: 9 }), /between 0 and 4/);
});

test('the default currencies carry rates and the state carries the app version', () => {
  const currencies = defaultCurrencies();
  assert.ok(currencies.length >= 10, 'a useful set of currencies ships with the app');
  assert.equal(currencies[0].code, 'EUR');
  assert.equal(currencies[0].rate, 1);
  assert.ok(currencies.every((currency) => currency.rate > 0));
  assert.ok(currencies.some((currency) => currency.decimals === 0), 'currencies without decimals exist');
  assert.ok(currencies.every((currency) => currency.flag), 'every currency has a flag');
  const rub = currencies.find((currency) => currency.code === 'RUB');
  assert.equal(rub.symbol, '₽');
  assert.equal(new Set(currencies.map((currency) => currency.code)).size, currencies.length, 'no duplicates');
  // Three Nordic crowns and two yen would otherwise be told apart by the code alone.
  const symbols = currencies.map((currency) => currency.symbol);
  assert.equal(new Set(symbols).size, symbols.length, `symbols repeat: ${symbols.join(' ')}`);
  assert.equal(new Set(currencies.map((currency) => currency.flag)).size, currencies.length, 'flags repeat');
  assert.equal(createDefaultState().appVersion, APP_VERSION);
});

test('amounts convert through the default currency', () => {
  const currencies = [
    { code: 'EUR', symbol: '€', decimals: 2, rate: 1 },
    { code: 'USD', symbol: '$', decimals: 2, rate: 0.5 },
    { code: 'JPY', symbol: '¥', decimals: 0, rate: 0.01 },
  ];
  assert.equal(convertAmount(1000, 'USD', 'EUR', currencies), 500);
  assert.equal(convertAmount(1000, 'EUR', 'USD', currencies), 2000);
  assert.equal(convertAmount(1000, 'EUR', 'JPY', currencies), 1000, 'decimals are respected: 10 EUR = 1000 JPY');
  assert.equal(convertAmount(100, 'JPY', 'EUR', currencies), 100);
  assert.equal(convertAmount(1234, 'EUR', 'EUR', currencies), 1234);
  assert.equal(convertAmount(1000, 'USD', 'XXX', currencies), 500, 'unknown currencies use rate 1');
  assert.equal(convertAmount(1000, 'USD', 'EUR', [{ code: 'USD', symbol: '$', decimals: 2, rate: 0 }]), 1000);
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

test('an amount has an upper bound, so totals stay exact', () => {
  const entry = { categoryId: 'daily', currency: 'EUR' };
  assert.equal(createEntry({ ...entry, amount: MAX_AMOUNT }).amount, MAX_AMOUNT);
  assert.equal(createEntry({ ...entry, amount: -MAX_AMOUNT }).amount, -MAX_AMOUNT);
  assert.throws(() => createEntry({ ...entry, amount: MAX_AMOUNT + 1 }), /too large/);
  assert.throws(() => createEntry({ ...entry, amount: 1e300 }), /too large/);
  assert.throws(() => createEntry({ ...entry, amount: -1e300 }), /too large/);
  // A full store of the largest entries still adds up inside the exact integer range.
  assert.ok(MAX_AMOUNT * 60000 < Number.MAX_SAFE_INTEGER);
});
