import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bundledTexts, createTranslator, CUSTOM_LANGUAGE, DE, detectLanguage, EN, fill, LANGUAGES, RU,
  sanitizeTranslation, translationKeys,
} from '../src/core/i18n.js';

test('every bundled language has every key and no extra keys', () => {
  const keys = translationKeys();
  assert.ok(keys.length > 100);
  for (const [name, texts] of [['ru', RU], ['de', DE]]) {
    const missing = keys.filter((key) => !texts[key]);
    const extra = Object.keys(texts).filter((key) => !(key in EN));
    assert.deepEqual(missing, [], `missing keys in ${name}`);
    assert.deepEqual(extra, [], `unknown keys in ${name}`);
  }
  assert.deepEqual(LANGUAGES.map((item) => item.code), ['en', 'ru', 'de']);
});

test('placeholders keep the same names in every language', () => {
  const placeholders = (text) => (String(text).match(/\{\w+\}/g) || []).sort().join(',');
  for (const key of translationKeys()) {
    assert.equal(placeholders(RU[key]), placeholders(EN[key]), `placeholders differ in ru for ${key}`);
    assert.equal(placeholders(DE[key]), placeholders(EN[key]), `placeholders differ in de for ${key}`);
  }
});

test('the translator falls back to English for unknown keys', () => {
  const russian = createTranslator('ru');
  assert.equal(russian('nav.home'), 'Главная');
  assert.equal(russian('does.not.exist'), 'does.not.exist');
  const partial = createTranslator('xx');
  assert.equal(partial('nav.home'), EN['nav.home']);
});

test('parameters are filled in', () => {
  const english = createTranslator('en');
  assert.equal(english('quick.title', { category: 'Daily' }), 'Add to Daily');
  assert.equal(english('common.entries', { count: 3 }), '3 entries');
  assert.equal(fill('{a} and {b} and {a}', { a: 1, b: 2 }), '1 and 2 and 1');
  assert.equal(fill('{missing}', {}), '{missing}');
});

test('a custom translation is used where it is filled in', () => {
  const custom = createTranslator(CUSTOM_LANGUAGE, { 'nav.home': 'Kodu' });
  assert.equal(custom('nav.home'), 'Kodu');
  assert.equal(custom('nav.stats'), EN['nav.stats'], 'empty keys stay English');
  assert.equal(createTranslator(CUSTOM_LANGUAGE)('nav.home'), EN['nav.home']);
});

test('custom translations are cleaned before they are stored', () => {
  const clean = sanitizeTranslation({ 'nav.home': 'Kodu', 'nav.stats': '  ', unknown: 'x', 'nav.entries': 5 });
  assert.deepEqual(clean, { 'nav.home': 'Kodu' });
  assert.deepEqual(sanitizeTranslation(null), {});
  assert.deepEqual(sanitizeTranslation('text'), {});
});

test('the browser language is matched to a bundled one', () => {
  assert.equal(detectLanguage(['ru-RU', 'en-US']), 'ru');
  assert.equal(detectLanguage(['de']), 'de');
  assert.equal(detectLanguage(['fr-FR']), 'en');
  assert.equal(detectLanguage([]), 'en');
  assert.deepEqual(bundledTexts('nope'), {});
});
