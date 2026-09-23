import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, addMonths, formatDate, formatMoney, GROUP_SEPARATOR, isIsoDate, isoWeek, parseAmount,
  parseDateLoose, periodEnd, periodKey, periodLabel, periodStart, previousPeriodStart, startOfWeek,
  toIsoDate, todayIso, toPlainAmount,
} from '../src/core/format.js';

const EUR = { code: 'EUR', symbol: '€', decimals: 2 };

test('formatMoney groups thousands and appends the symbol', () => {
  assert.equal(formatMoney(123456, EUR), `1${GROUP_SEPARATOR}234.56 €`);
  assert.equal(formatMoney(0, EUR), '0.00 €');
  assert.equal(formatMoney(-500, EUR), '−5.00 €');
  assert.equal(formatMoney(500, EUR, { sign: true }), '+5.00 €');
  assert.equal(formatMoney(-500, EUR, { sign: true }), '−5.00 €');
  assert.equal(formatMoney(1234, EUR, { symbol: false }), '12.34');
  assert.equal(formatMoney(1234, {}), '12.34');
  assert.equal(formatMoney(1234, { code: 'JPY', decimals: 0 }), '1 234 JPY');
});

test('toPlainAmount writes a machine readable number', () => {
  assert.equal(toPlainAmount(123456), '1234.56');
  assert.equal(toPlainAmount(-5), '-0.05');
  assert.equal(toPlainAmount(1234, 0), '1234');
});

test('parseAmount understands the usual ways of typing money', () => {
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('12,50'), 1250);
  assert.equal(parseAmount(' 1 234.56 € '), 123456);
  assert.equal(parseAmount('1 234,56'), 123456);
  assert.equal(parseAmount('-3'), -300);
  assert.equal(parseAmount('(3)'), -300);
  assert.equal(parseAmount('+3'), 300);
  assert.equal(parseAmount('1,234'), 123400);
  assert.equal(parseAmount('0,5'), 50);
  assert.equal(parseAmount(12.345, 2), 1235);
  assert.equal(parseAmount(5, 0), 5);
  assert.equal(parseAmount('12.3456'), 1235);
});

test('parseAmount rejects what is not a number', () => {
  for (const value of ['', '   ', 'abc', '.', null, undefined, {}, Number.NaN, Infinity]) {
    assert.equal(parseAmount(value), null, `expected null for ${String(value)}`);
  }
});

test('date helpers work on ISO strings', () => {
  assert.ok(isIsoDate('2026-09-22'));
  assert.ok(!isIsoDate('2026-02-30'));
  assert.ok(!isIsoDate('22.09.2026'));
  assert.ok(!isIsoDate(20260922));
  assert.equal(toIsoDate(new Date(2026, 8, 22)), '2026-09-22');
  assert.equal(todayIso(new Date(2026, 0, 1)), '2026-01-01');
  assert.equal(formatDate('2026-09-22'), '22.09.2026');
  assert.equal(formatDate('nonsense'), '');
  assert.equal(addDays('2026-02-28', 1), '2026-03-01');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-03-15', -2), '2026-01-15');
});

test('parseDateLoose accepts the common formats', () => {
  assert.equal(parseDateLoose('2026-09-22'), '2026-09-22');
  assert.equal(parseDateLoose('22.09.2026'), '2026-09-22');
  assert.equal(parseDateLoose('22/09/2026'), '2026-09-22');
  assert.equal(parseDateLoose('9/22/2026'), '2026-09-22');
  assert.equal(parseDateLoose('22-09-26'), '2026-09-22');
  assert.equal(parseDateLoose('2026/9/22'), '2026-09-22');
  assert.equal(parseDateLoose(new Date(2026, 8, 22)), '2026-09-22');
  assert.equal(parseDateLoose('  '), null);
  assert.equal(parseDateLoose('not a date'), null);
  assert.equal(parseDateLoose('32.01.2026'), null);
  assert.equal(parseDateLoose(42), null);
  assert.equal(parseDateLoose(new Date('nope')), null);
});

test('weeks follow ISO 8601', () => {
  assert.equal(startOfWeek('2026-09-22'), '2026-09-21');
  assert.deepEqual(isoWeek('2026-09-22'), { year: 2026, week: 39 });
  assert.deepEqual(isoWeek('2027-01-01'), { year: 2026, week: 53 });
  assert.deepEqual(isoWeek('2026-01-01'), { year: 2026, week: 1 });
});

test('period keys, starts and labels', () => {
  assert.equal(periodKey('2026-09-22', 'day'), '2026-09-22');
  assert.equal(periodKey('2026-09-22', 'week'), '2026-W39');
  assert.equal(periodKey('2026-09-22', 'month'), '2026-09');
  assert.equal(periodKey('2026-09-22', 'year'), '2026');
  assert.throws(() => periodKey('2026-09-22', 'decade'), /Unknown period/);

  assert.equal(periodStart('2026-09-22', 'day'), '2026-09-22');
  assert.equal(periodStart('2026-09-22', 'week'), '2026-09-21');
  assert.equal(periodStart('2026-09-22', 'month'), '2026-09-01');
  assert.equal(periodStart('2026-09-22', 'year'), '2026-01-01');
  assert.throws(() => periodStart('2026-09-22', 'decade'), /Unknown period/);

  assert.equal(periodEnd('2026-09-22', 'day'), '2026-09-22');
  assert.equal(periodEnd('2026-09-22', 'week'), '2026-09-27');
  assert.equal(periodEnd('2026-09-22', 'month'), '2026-09-30');
  assert.equal(periodEnd('2026-02-10', 'month'), '2026-02-28');
  assert.equal(periodEnd('2024-02-10', 'month'), '2024-02-29');
  assert.equal(periodEnd('2026-09-22', 'year'), '2026-12-31');
  assert.throws(() => periodEnd('2026-09-22', 'decade'), /Unknown period/);

  assert.equal(previousPeriodStart('2026-09-22', 'day'), '2026-09-21');
  assert.equal(previousPeriodStart('2026-09-22', 'week'), '2026-09-14');
  assert.equal(previousPeriodStart('2026-09-22', 'month'), '2026-08-01');
  assert.equal(previousPeriodStart('2026-09-22', 'year'), '2025-01-01');
  assert.throws(() => previousPeriodStart('2026-09-22', 'decade'), /Unknown period/);

  assert.equal(periodLabel('2026-09-22', 'day'), '22.09');
  assert.equal(periodLabel('2026-09-22', 'day', 'long'), '22.09.2026');
  assert.equal(periodLabel('2026-W39', 'week'), 'W39');
  assert.equal(periodLabel('2026-W39', 'week', 'long'), 'Week 39, 2026');
  assert.equal(periodLabel('2026-09', 'month'), 'Sep 26');
  assert.equal(periodLabel('2026-09', 'month', 'long'), 'September 2026');
  assert.equal(periodLabel('2026', 'year'), '2026');
  assert.throws(() => periodLabel('2026', 'decade'), /Unknown period/);
});

test('period labels follow the language they are given', () => {
  const russian = {
    months: ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
      'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'],
    week: '{week}-я неделя, {year}',
    weekShort: 'Н{week}',
  };
  assert.equal(periodLabel('2026-09', 'month', 'long', russian), 'Сентябрь 2026');
  assert.equal(periodLabel('2026-09', 'month', 'short', russian), 'Сен 26');
  assert.equal(periodLabel('2026-W39', 'week', 'long', russian), '39-я неделя, 2026');
  assert.equal(periodLabel('2026-W39', 'week', 'short', russian), 'Н39');
  assert.equal(periodLabel('2026-09-22', 'day', 'long', russian), '22.09.2026', 'dates stay numeric');
  assert.equal(periodLabel('2026-09', 'month', 'long', {}), 'September 2026', 'English is the fallback');
  assert.equal(periodLabel('2026-09', 'month', 'long', { months: ['too', 'short'] }), 'September 2026');
});

test('scientific notation is refused instead of being mangled', () => {
  // The cleanup drops letters, so "1e15" used to come out as 115.00 without a word.
  assert.equal(parseAmount('1e15', 2), null);
  assert.equal(parseAmount('1E3', 2), null);
  assert.equal(parseAmount('2.5e-3', 2), null);
  assert.equal(parseAmount('12.50 €', 2), 1250, 'currency symbols are still tolerated');
  assert.equal(parseAmount('1 234,56', 2), 123456);
});
