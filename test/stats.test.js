import test from 'node:test';
import assert from 'node:assert/strict';
import {
  byCategory, elapsedSubPeriods, groupByPeriod, highlights, ofCurrency, overview, periodStarts,
  periodSummary, series, totals,
} from '../src/core/stats.js';

const categories = [
  { id: 'daily', name: 'Daily', kind: 'expense', color: '#4f46e5' },
  { id: 'food', name: 'Food', kind: 'expense', color: '#ea580c' },
  { id: 'pay', name: 'Pay', kind: 'income', color: '#16a34a' },
];

const entries = [
  { id: '1', date: '2026-09-22', amount: 1000, categoryId: 'daily', currency: 'EUR' },
  { id: '2', date: '2026-09-22', amount: 500, categoryId: 'food', currency: 'EUR' },
  { id: '3', date: '2026-09-15', amount: 2000, categoryId: 'food', currency: 'EUR' },
  { id: '4', date: '2026-08-10', amount: 3000, categoryId: 'daily', currency: 'EUR' },
  { id: '5', date: '2026-09-01', amount: 200000, categoryId: 'pay', currency: 'EUR' },
  { id: '6', date: '2026-09-22', amount: 700, categoryId: 'daily', currency: 'USD' },
];

test('totals split income and expenses', () => {
  assert.deepEqual(totals(entries, categories), { expense: 7200, income: 200000, net: 192800, count: 6 });
  assert.deepEqual(totals([], categories), { expense: 0, income: 0, net: 0, count: 0 });
});

test('entries are grouped by period', () => {
  assert.deepEqual([...groupByPeriod(entries, 'month').keys()], ['2026-09', '2026-08']);
  assert.equal(groupByPeriod(entries, 'day').get('2026-09-22').length, 3);
  assert.deepEqual([...groupByPeriod(entries, 'year').keys()], ['2026']);
});

test('a period counts the sub-periods that have already passed in it', () => {
  // 22.09.2026 is a Tuesday: two days into its week, and its month has reached
  // its fourth calendar week (the one that starts on 31.08 counts, because the
  // first two days of September fall in it).
  assert.equal(elapsedSubPeriods('week', '2026-09-22'), 2);
  assert.equal(elapsedSubPeriods('month', '2026-09-22'), 4);
  assert.equal(elapsedSubPeriods('year', '2026-09-22'), 9);
  // A day has nothing finer under it here, so it has no rate of its own.
  assert.equal(elapsedSubPeriods('day', '2026-09-22'), 0);
  // The first day of a period is one sub-period in, never zero.
  assert.equal(elapsedSubPeriods('week', '2026-09-21'), 1);
  assert.equal(elapsedSubPeriods('month', '2026-09-01'), 1);
  assert.equal(elapsedSubPeriods('year', '2026-01-01'), 1);
  assert.equal(elapsedSubPeriods('year', '2026-12-31'), 12);
});

test('the pace inside a period divides by the sub-periods that passed, not the ones with entries', () => {
  const week = periodSummary(entries, categories, 'week', '2026-09-22');
  // Everything in this week was spent on one of its two elapsed days. Counting
  // only the days that have entries would say 2200 a day; two days passed, so
  // the honest pace is half of that.
  assert.equal(week.current.expense, 2200);
  assert.equal(week.subPeriod, 'day');
  assert.equal(week.subPeriods, 2);
  assert.equal(week.rateExpense, 1100);

  const month = periodSummary(entries, categories, 'month', '2026-09-22');
  assert.equal(month.current.expense, 4200);
  assert.equal(month.subPeriod, 'week');
  assert.equal(month.rateExpense, Math.round(4200 / 4));
  assert.equal(month.rateIncome, Math.round(200000 / 4));

  const year = periodSummary(entries, categories, 'year', '2026-09-22');
  assert.equal(year.subPeriod, 'month');
  assert.equal(year.rateExpense, Math.round(7200 / 9));

  // A day has no sub-period, so it reports no rate - the card falls back to the
  // long-run average there.
  const day = periodSummary(entries, categories, 'day', '2026-09-22');
  assert.equal(day.subPeriod, null);
  assert.equal(day.subPeriods, 0);
  assert.equal(day.rateExpense, 0);

  // An empty period paces at nothing rather than dividing by zero.
  const empty = periodSummary([], categories, 'month', '2026-09-22');
  assert.equal(empty.rateExpense, 0);
  assert.equal(empty.rateIncome, 0);
});

test('periodSummary reports the current period and the average', () => {
  const day = periodSummary(entries, categories, 'day', '2026-09-22');
  assert.equal(day.current.expense, 2200);
  assert.equal(day.periodsWithData, 4);
  assert.equal(day.averageExpense, Math.round(7200 / 4));
  assert.equal(day.label, '22.09.2026');

  const month = periodSummary(entries, categories, 'month', '2026-09-22');
  assert.equal(month.current.expense, 4200);
  assert.equal(month.current.income, 200000);
  assert.equal(month.averageExpense, 3600);
  assert.equal(month.totalIncome, 200000);

  const empty = periodSummary([], categories, 'week', '2026-09-22');
  assert.equal(empty.averageExpense, 0);
  assert.equal(empty.averageIncome, 0);
  assert.equal(empty.current.count, 0);
});

test('overview covers day, week, month and year', () => {
  const summaries = overview(entries, categories, '2026-09-22');
  assert.deepEqual(summaries.map((summary) => summary.period), ['day', 'week', 'month', 'year']);
  assert.equal(summaries[3].current.expense, 7200);
});

test('periodStarts walks backwards through the calendar', () => {
  assert.deepEqual(periodStarts('day', 3, '2026-09-22'), ['2026-09-20', '2026-09-21', '2026-09-22']);
  assert.deepEqual(periodStarts('week', 2, '2026-09-22'), ['2026-09-14', '2026-09-21']);
  assert.deepEqual(periodStarts('month', 3, '2026-09-22'), ['2026-07-01', '2026-08-01', '2026-09-01']);
  assert.deepEqual(periodStarts('year', 2, '2026-09-22'), ['2025-01-01', '2026-01-01']);
});

test('series includes periods without entries', () => {
  const points = series(entries, categories, 'month', 3, '2026-09-22');
  assert.deepEqual(points.map((point) => point.key), ['2026-07', '2026-08', '2026-09']);
  assert.deepEqual(points.map((point) => point.expense), [0, 3000, 4200]);
  assert.equal(points[2].income, 200000);
  assert.equal(points[0].label, 'Jul 26');
  assert.equal(points[2].fullLabel, 'September 2026');
});

test('byCategory ranks expense categories', () => {
  const rows = byCategory(entries, categories);
  assert.deepEqual(rows.map((row) => row.id), ['daily', 'food']);
  assert.deepEqual(rows.map((row) => row.amount), [4700, 2500]);
  assert.equal(rows[0].share + rows[1].share, 100);
  assert.equal(rows[0].color, '#4f46e5');
  assert.deepEqual(byCategory([], categories), []);
});

test('ofCurrency filters and highlights summarise', () => {
  assert.equal(ofCurrency(entries, 'USD').length, 1);
  const result = highlights(entries, categories);
  assert.equal(result.largest.id, '4');
  assert.deepEqual(result.busiestDay, { date: '2026-08-10', amount: 3000 });
  assert.equal(result.daysWithSpending, 3);
  assert.deepEqual(highlights([], categories), { largest: null, busiestDay: null, daysWithSpending: 0 });
});
